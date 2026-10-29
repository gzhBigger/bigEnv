import { createHash } from 'node:crypto';
import path from 'node:path';
import { parse as parseToml } from 'smol-toml';
import type { HttpClient } from './http';
import { readJson, writeJsonAtomic } from './fsx';
import { createLogger } from './logger';
import { platformArch, platformOs, type PlatformArch, type PlatformOs } from './paths';

const log = createLogger('versions');

export interface RawFileEntry {
  url?: string;
  arch?: string;
  os?: string;
  sum?: string;
  sum_type?: string;
  installer?: string;
  size?: number;
  lts?: string;
  extra?: Record<string, unknown>;
}

export type RawVersionMap = Record<string, RawFileEntry[]>;

export interface SdkListEntry {
  sha256?: string;
  homepage?: string;
  install_conf_sha256?: string;
}

export type SdkList = Record<string, SdkListEntry>;

export interface InstallConf {
  flagDirExcepted: boolean;
  flagFiles: Record<string, string[]>;
  binaryDirs: Record<string, string[][]>;
  envs: { name: string; value: string[]; version: string }[];
}

const EMPTY_CONF: InstallConf = { flagDirExcepted: false, flagFiles: {}, binaryDirs: {}, envs: [] };

export function parseInstallConf(text: string): InstallConf {
  const data = parseToml(text) as Record<string, unknown>;
  const flagFilesRaw = (data.flag_files ?? {}) as Record<string, unknown>;
  const binaryDirsRaw = (data.binary_dirs ?? {}) as Record<string, unknown>;
  const envsRaw = (data.additional_envs ?? []) as unknown;

  const flagFiles: Record<string, string[]> = {};
  for (const [os, value] of Object.entries(flagFilesRaw)) {
    if (Array.isArray(value)) flagFiles[os] = value.filter((item): item is string => typeof item === 'string');
  }

  const binaryDirs: Record<string, string[][]> = {};
  for (const [os, value] of Object.entries(binaryDirsRaw)) {
    if (!Array.isArray(value)) continue;
    binaryDirs[os] = value
      .filter((item): item is string[] => Array.isArray(item))
      .map((item) => item.map((segment) => String(segment)));
  }

  const envs: InstallConf['envs'] = [];
  if (Array.isArray(envsRaw)) {
    for (const item of envsRaw) {
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      const name = typeof record.Name === 'string' ? record.Name : null;
      if (!name) continue;
      const value = Array.isArray(record.Value) ? record.Value.map((v) => String(v)) : [];
      envs.push({ name, value, version: typeof record.Version === 'string' ? record.Version : '' });
    }
  }

  return {
    flagDirExcepted: data.flag_dir_excepted === true,
    flagFiles,
    binaryDirs,
    envs,
  };
}

export function selectConf(conf: InstallConf, os: PlatformOs): { flagFiles: string[]; binaryDirs: string[][]; envs: InstallConf['envs'] } {
  return {
    flagFiles: conf.flagFiles[os] ?? [],
    binaryDirs: conf.binaryDirs[os] ?? [],
    // vmr applies additional_envs on every platform.
    envs: conf.envs,
  };
}

const PRERELEASE = /(alpha|beta|rc|snapshot|nightly|dev|preview|pre|canary|edge|insider)/i;
const LABEL_WORDS = new Set(['latest', 'stable', 'lts', 'release']);

function tokens(version: string): string[] {
  return version
    .toLowerCase()
    .split(/[.+\-_ ~]/)
    .filter((part) => part.length > 0);
}

export function compareVersions(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  const len = Math.max(ta.length, tb.length);
  for (let i = 0; i < len; i += 1) {
    const x = ta[i];
    const y = tb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) {
      const diff = Number(x) - Number(y);
      if (diff !== 0) return diff;
      continue;
    }
    if (nx !== ny) return nx ? 1 : -1;
    if (x !== y) {
      const px = LABEL_WORDS.has(x);
      const py = LABEL_WORDS.has(y);
      if (px !== py) return px ? 1 : -1;
      return x < y ? -1 : 1;
    }
  }
  const preA = PRERELEASE.test(a);
  const preB = PRERELEASE.test(b);
  if (preA !== preB) return preA ? -1 : 1;
  return a.length - b.length;
}

export function sortVersionsDesc(versions: string[]): string[] {
  return [...versions].sort((a, b) => compareVersions(b, a));
}

export function pickFileForPlatform(files: RawFileEntry[] | undefined, os: PlatformOs, arch: PlatformArch): RawFileEntry | null {
  if (!files || files.length === 0) return null;
  const matchesOs = files.filter((item) => (item.os ?? 'any') === os || item.os === 'any');
  const pool = matchesOs.length > 0 ? matchesOs : files.filter((item) => item.os === undefined);
  const exact = pool.find((item) => (item.arch ?? 'any') === arch);
  if (exact) return exact;
  const any = pool.find((item) => (item.arch ?? 'any') === 'any');
  return any ?? pool[0] ?? null;
}

export function isLtsEntry(entry: RawFileEntry): boolean {
  return typeof entry.lts === 'string' && entry.lts.length > 0;
}

interface CacheEntry<T> {
  fetchedAt: number;
  etag?: string;
  data: T;
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export class MetadataService {
  private sdkListCache: SdkList | null = null;
  private versionCache = new Map<string, RawVersionMap>();
  private confCache = new Map<string, InstallConf>();
  private inflight = new Map<string, Promise<unknown>>();

  private base: string;
  private cacheDir: string;

  constructor(
    private client: HttpClient,
    metaBase: string,
    cacheRoot: string,
  ) {
    this.base = metaBase.replace(/\/+$/, '');
    const hash = createHash('sha1').update(this.base).digest('hex').slice(0, 12);
    this.cacheDir = path.join(cacheRoot, hash);
  }

  get metaBase(): string {
    return this.base;
  }

  /** Point the service at another metadata source / HTTP client, dropping all in-memory data. */
  setSource(client: HttpClient, metaBase: string, cacheRoot: string): void {
    this.client = client;
    this.base = metaBase.replace(/\/+$/, '');
    const hash = createHash('sha1').update(this.base).digest('hex').slice(0, 12);
    this.cacheDir = path.join(cacheRoot, hash);
    this.clear();
  }

  private async readCache<T>(name: string): Promise<CacheEntry<T> | null> {
    return await readJson<CacheEntry<T>>(path.join(this.cacheDir, `${name}.json`));
  }

  private async writeCache<T>(name: string, data: T): Promise<void> {
    const entry: CacheEntry<T> = { fetchedAt: Date.now(), data };
    await writeJsonAtomic(path.join(this.cacheDir, `${name}.json`), entry);
  }

  private async withCache<T>(name: string, key: string, fetcher: () => Promise<T>, force: boolean): Promise<T> {
    const existing = this.inflight.get(key);
    if (existing && !force) return (await existing) as T;
    const task = (async () => {
      const cached = await this.readCache<T>(name);
      const fresh = cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS;
      if (cached && fresh && !force) return cached.data;
      try {
        const data = await fetcher();
        await this.writeCache(name, data);
        return data;
      } catch (err) {
        if (cached) {
          log.warn('metadata fetch failed, using cached copy', { name, error: err instanceof Error ? err.message : String(err) });
          return cached.data;
        }
        throw err;
      }
    })().finally(() => this.inflight.delete(key));
    this.inflight.set(key, task);
    return await task;
  }

  async getSdkList(force = false): Promise<SdkList> {
    if (this.sdkListCache && !force) return this.sdkListCache;
    const data = await this.withCache<SdkList>('sdk-list.version', 'sdk-list', async () => {
      const list = await this.client.getJson<SdkList>(`${this.base}/sdk-list.version.json`);
      if (!list || typeof list !== 'object') throw new Error('SDK 列表格式异常');
      return list;
    }, force);
    this.sdkListCache = data;
    return data;
  }

  async getVersions(sdk: string, force = false): Promise<RawVersionMap> {
    const hit = this.versionCache.get(sdk);
    if (hit && !force) return hit;
    const data = await this.withCache<RawVersionMap>(
      `${sdk}.version`,
      `versions:${sdk}`,
      async () => {
        const map = await this.client.getJson<RawVersionMap>(`${this.base}/${sdk}.version.json`);
        if (!map || typeof map !== 'object') throw new Error('版本列表格式异常');
        return map;
      },
      force,
    );
    this.versionCache.set(sdk, data);
    return data;
  }

  async getInstallConf(sdk: string): Promise<InstallConf> {
    const hit = this.confCache.get(sdk);
    if (hit) return hit;
    try {
      const text = await this.client.getText(`${this.base}/install/${sdk}.toml`);
      const conf = parseInstallConf(text);
      this.confCache.set(sdk, conf);
      return conf;
    } catch (err) {
      log.warn('install conf unavailable', { sdk, error: err instanceof Error ? err.message : String(err) });
      this.confCache.set(sdk, EMPTY_CONF);
      return EMPTY_CONF;
    }
  }

  clear(): void {
    this.sdkListCache = null;
    this.versionCache.clear();
    this.confCache.clear();
  }
}

export const MIRROR_RULES: { from: RegExp; to: string; note: string }[] = [
  { from: /^https:\/\/nodejs\.org\/download\/release\//, to: 'https://mirrors.huaweicloud.com/nodejs/', note: 'Node.js 华为云' },
  { from: /^https:\/\/nodejs\.org\/dist\//, to: 'https://mirrors.huaweicloud.com/nodejs/', note: 'Node.js 华为云' },
  { from: /^https:\/\/go\.dev\/dl\//, to: 'https://golang.google.cn/dl/', note: 'Go 国内镜像' },
  { from: /^https:\/\/storage\.googleapis\.com\/flutter_infra_release\//, to: 'https://storage.flutter-io.cn/flutter_infra_release/', note: 'Flutter 中国镜像' },
  { from: /^https:\/\/github\.com\//, to: 'https://gh-proxy.com/https://github.com/', note: 'GitHub 加速代理' },
];

export interface UrlRewrite {
  url: string;
  mirrored: boolean;
  note?: string;
}

export function rewriteDownloadUrl(url: string, enabled: boolean): UrlRewrite {
  if (!enabled) return { url, mirrored: false };
  for (const rule of MIRROR_RULES) {
    if (rule.from.test(url)) {
      return { url: url.replace(rule.from, rule.to), mirrored: true, note: rule.note };
    }
  }
  return { url, mirrored: false };
}

export function currentPlatform(): { os: PlatformOs; arch: PlatformArch } {
  return { os: platformOs(), arch: platformArch() };
}
