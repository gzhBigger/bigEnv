import path from 'node:path';
import type { InstallerKind, SdkSummary, VersionOption } from '../shared/types';
import { archiveKind } from './archive';
import { createLogger } from './logger';
import { platformArch, platformOs, type PlatformArch, type PlatformOs } from './paths';
import { categoryOf, displayName, sdkMeta } from './sdkMeta';
import {
  MetadataService,
  compareVersions,
  isLtsEntry,
  pickFileForPlatform,
  rewriteDownloadUrl,
  selectConf,
  sortVersionsDesc,
  type InstallConf,
  type RawFileEntry,
  type RawVersionMap,
  type SdkList,
} from './versions';
import { mapLimit, which } from './util';

const log = createLogger('catalog');

export interface Capabilities {
  conda: boolean;
  condaPath: string | null;
}

export async function detectCapabilities(): Promise<Capabilities> {
  const condaPath = (await which('conda')) ?? (await which('conda.bat'));
  log.info('capabilities', { conda: Boolean(condaPath) });
  return { conda: Boolean(condaPath), condaPath };
}

export interface InstallPlan {
  sdk: string;
  version: string;
  installer: InstallerKind;
  url: string;
  downloadUrl: string;
  mirrored: boolean;
  mirrorNote?: string;
  sha256: string | null;
  sizeBytes: number | null;
  os: PlatformOs;
  arch: PlatformArch;
  fileName: string;
  flagFiles: string[];
  binaryDirs: string[][];
  envs: { name: string; value: string[]; version?: string }[];
  condaPackage: string | null;
}

export interface AssessResult {
  installable: boolean;
  reason?: string;
}

export function installerKindOf(raw: string | undefined): InstallerKind {
  switch ((raw ?? '').toLowerCase()) {
    case 'unarchiver':
      return 'unarchiver';
    case 'executable':
      return 'executable';
    case 'conda':
      return 'conda';
    case 'compile':
      return 'compile';
    case 'coursier':
      return 'coursier';
    case 'rustup':
      return 'rustup';
    default:
      return 'other';
  }
}

const EXECUTABLE_HINT = /(需要 .* 环境|手动安装|安装程序)/;

/** SDKs whose "executable" package is a single binary we can simply drop on disk. */
const SINGLE_BINARY_SDKS = new Set(['kubectl', 'bazel', 'agg', 'tinymist', 'typst-lsp', 'typst-preview', 'served', 'acast']);

export function assessEntry(entry: RawFileEntry | null, caps: Capabilities, sdk?: string): AssessResult {
  if (!entry) return { installable: false, reason: '当前平台没有可用的下载包' };
  const kind = installerKindOf(entry.installer);
  if (!entry.url) {
    if (kind === 'conda') {
      return caps.conda
        ? { installable: true }
        : { installable: false, reason: '需要 Conda 环境（未检测到 conda 命令）' };
    }
    return { installable: false, reason: '元数据缺少下载地址' };
  }
  if (kind === 'unarchiver') {
    if (!archiveKind(entry.url)) {
      const ext = path.extname(entry.url) || path.basename(entry.url);
      return { installable: false, reason: `暂不支持 ${ext} 压缩格式` };
    }
    return { installable: true };
  }
  if (kind === 'executable') {
    if (sdk && SINGLE_BINARY_SDKS.has(sdk)) return { installable: true };
    return { installable: false, reason: '该版本是官方安装程序，需手动运行安装' };
  }
  if (kind === 'conda') {
    return caps.conda
      ? { installable: true }
      : { installable: false, reason: '需要 Conda 环境（未检测到 conda 命令）' };
  }
  if (kind === 'rustup') return { installable: false, reason: '需要 rustup 手动安装' };
  if (kind === 'coursier') return { installable: false, reason: '需要 Coursier 手动安装' };
  if (kind === 'compile') return { installable: false, reason: '需要本地编译安装' };
  return { installable: false, reason: '未知安装方式' };
}

export function isExecutableHint(reason: string | undefined): boolean {
  return typeof reason === 'string' && EXECUTABLE_HINT.test(reason);
}

export interface InstalledLookup {
  versions: Set<string>;
  current: string | null;
}

export type InstalledProvider = () => Promise<Map<string, InstalledLookup>>;

interface SummaryMeta {
  versionCount: number;
  latestVersion: string | null;
  latestLts: string | null;
  installable: boolean;
  reason?: string;
}

export class CatalogService {
  private summariesCache = new Map<string, SummaryMeta>();
  private versionsCache = new Map<string, VersionOption[]>();
  private caps: Capabilities;
  private installedProvider: InstalledProvider = async () => new Map();

  constructor(
    private readonly meta: MetadataService,
    caps: Capabilities,
  ) {
    this.caps = caps;
  }

  setCapabilities(caps: Capabilities): void {
    this.caps = caps;
    this.versionsCache.clear();
    this.summariesCache.clear();
  }

  setInstalledProvider(provider: InstalledProvider): void {
    this.installedProvider = provider;
  }

  /**
   * Drop the cached version lists so the next read reflects a fresh install/uninstall.
   *
   * `versions()` bakes `installed`/`current` into every row; without this a deleted version keeps
   * showing as "当前" and can never be reinstalled.
   */
  invalidateVersions(sdk?: string): void {
    if (sdk) this.versionsCache.delete(sdk);
    else this.versionsCache.clear();
  }

  private async installed(): Promise<Map<string, InstalledLookup>> {
    try {
      return await this.installedProvider();
    } catch (err) {
      log.warn('installed provider failed', err instanceof Error ? err.message : String(err));
      return new Map();
    }
  }

  private async sdkList(): Promise<SdkList> {
    return await this.meta.getSdkList();
  }

  private async summaryMetaFor(sdk: string, raw: RawVersionMap | null): Promise<SummaryMeta> {
    const cached = this.summariesCache.get(sdk);
    if (cached) return cached;
    const os = platformOs();
    const arch = platformArch();
    const result: SummaryMeta = {
      versionCount: 0,
      latestVersion: null,
      latestLts: null,
      installable: false,
      reason: '当前平台没有可用的下载包',
    };
    if (!raw) {
      result.reason = '元数据不可用';
      this.summariesCache.set(sdk, result);
      return result;
    }
    const versions = Object.keys(raw);
    const usable: { version: string; entry: RawFileEntry; assess: AssessResult }[] = [];
    for (const version of versions) {
      const entry = pickFileForPlatform(raw[version], os, arch);
      if (!entry) continue;
      const assess = assessEntry(entry, this.caps, sdk);
      usable.push({ version, entry, assess });
    }
    if (usable.length === 0) {
      this.summariesCache.set(sdk, result);
      return result;
    }
    const sorted = usable.sort((a, b) => compareVersions(b.version, a.version));
    const latest = sorted[0];
    const lts = sorted.find((item) => isLtsEntry(item.entry)) ?? null;
    const installable = sorted.find((item) => item.assess.installable) ?? null;
    result.versionCount = sorted.length;
    result.latestVersion = latest.version;
    result.latestLts = lts?.version ?? null;
    result.installable = Boolean(installable);
    result.reason = installable ? undefined : (latest.assess.reason ?? '暂不支持当前平台安装');
    this.summariesCache.set(sdk, result);
    return result;
  }

  async summaries(force = false): Promise<SdkSummary[]> {
    if (force) {
      this.summariesCache.clear();
      this.versionsCache.clear();
      this.meta.clear();
    }
    const list = await this.sdkList();
    const installed = await this.installed();
    const ids = Object.keys(list).sort((a, b) => a.localeCompare(b));
    const metas = await mapLimit(ids, 8, async (id) => {
      if (this.summariesCache.has(id)) return this.summariesCache.get(id)!;
      let raw: RawVersionMap | null = null;
      try {
        raw = await this.meta.getVersions(id, force);
      } catch (err) {
        log.warn('version metadata failed', { id, error: err instanceof Error ? err.message : String(err) });
      }
      return await this.summaryMetaFor(id, raw);
    });
    return ids.map((id, index) => this.buildSummary(id, list[id], metas[index], installed.get(id)));
  }

  private buildSummary(id: string, listEntry: SdkList[string] | undefined, meta: SummaryMeta, installed: InstalledLookup | undefined): SdkSummary {
    const info = sdkMeta(id);
    return {
      id,
      name: displayName(id),
      homepage: listEntry?.homepage ?? '',
      category: categoryOf(id),
      description: info.description,
      versionCount: meta.versionCount,
      latestVersion: meta.latestVersion,
      latestLts: meta.latestLts,
      installable: meta.installable,
      unavailableReason: meta.installable ? undefined : meta.reason,
      installedVersions: installed ? sortVersionsDesc([...installed.versions]) : [],
      currentVersion: installed?.current ?? null,
    };
  }

  async versions(sdk: string, force = false): Promise<VersionOption[]> {
    if (!force) {
      const hit = this.versionsCache.get(sdk);
      if (hit) return hit;
    }
    const raw = await this.meta.getVersions(sdk, force);
    const os = platformOs();
    const arch = platformArch();
    const installed = (await this.installed()).get(sdk);
    const options: VersionOption[] = [];
    for (const version of sortVersionsDesc(Object.keys(raw))) {
      const entry = pickFileForPlatform(raw[version], os, arch);
      if (!entry) continue;
      const assess = assessEntry(entry, this.caps, sdk);
      options.push({
        version,
        lts: typeof entry.lts === 'string' && entry.lts.length > 0 ? entry.lts : null,
        sizeBytes: typeof entry.size === 'number' && entry.size > 0 ? entry.size : null,
        installer: installerKindOf(entry.installer),
        installable: assess.installable,
        unavailableReason: assess.reason,
        installed: installed?.versions.has(version) ?? false,
        current: installed?.current === version,
        url: entry.url ?? null,
        sha256: entry.sum_type === 'sha256' || !entry.sum_type ? (entry.sum ?? null) : null,
      });
    }
    this.versionsCache.set(sdk, options);
    return options;
  }

  async plan(sdk: string, version: string, mirrorEnabled: boolean): Promise<InstallPlan> {
    const raw = await this.meta.getVersions(sdk);
    const entry = pickFileForPlatform(raw[version], platformOs(), platformArch());
    const assess = assessEntry(entry, this.caps, sdk);
    if (!entry) throw new Error(`没有 ${sdk} ${version} 在当前平台的安装包`);
    if (!assess.installable) throw new Error(assess.reason ?? '该版本不可安装');
    const conf: InstallConf = await this.meta.getInstallConf(sdk);
    const selected = selectConf(conf, platformOs());
    const kind = installerKindOf(entry.installer);
    const rewritten = entry.url ? rewriteDownloadUrl(entry.url, mirrorEnabled) : { url: '', mirrored: false };
    const downloadUrl = kind === 'conda' ? '' : rewritten.url;
    const sha256 = entry.sum && (entry.sum_type === undefined || entry.sum_type === 'sha256') ? entry.sum : null;
    const fileName = downloadUrl ? path.basename(new URL(downloadUrl).pathname) : '';
    return {
      sdk,
      version,
      installer: kind,
      url: entry.url ?? '',
      downloadUrl,
      mirrored: rewritten.mirrored,
      mirrorNote: rewritten.note,
      sha256,
      sizeBytes: typeof entry.size === 'number' && entry.size > 0 ? entry.size : null,
      os: platformOs(),
      arch: platformArch(),
      fileName,
      flagFiles: selected.flagFiles,
      binaryDirs: selected.binaryDirs.length > 0 ? selected.binaryDirs : [[]],
      envs: selected.envs.map((item) => ({ name: item.name, value: item.value, version: item.version || undefined })),
      condaPackage: kind === 'conda' ? sdk : null,
    };
  }
}
