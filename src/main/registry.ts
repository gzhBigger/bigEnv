import fs from 'node:fs/promises';
import path from 'node:path';
import type { InstallRecord, InstallerKind } from '../shared/types';
import { createDirLink, dirSize, ensureDir, pathExists, readJson, readLinkTarget, removeDir, writeJsonAtomic } from './fsx';
import { createLogger } from './logger';

const log = createLogger('registry');

export const META_FILE = '.bigenv.json';
const CURRENT = 'current';

export interface StoredEnv {
  name: string;
  value: string[];
  version?: string;
}

export interface StoredInstall {
  sdk: string;
  version: string;
  installer: InstallerKind;
  binDirs: string[][];
  envs: StoredEnv[];
  sourceUrl: string | null;
  sha256?: string | null;
  installedAt: string;
  archive?: string | null;
}

export interface InstalledIndex {
  bySdk: Map<string, InstallRecord[]>;
  current: Map<string, string | null>;
}

function majorOf(version: string): number | null {
  const match = version.match(/\d+/);
  return match ? Number(match[0]) : null;
}

/** Evaluate vmr style version constraints such as `major<=8` / `major>=21`. */
function envApplies(spec: string | undefined, version: string): boolean {
  if (!spec) return true;
  const major = majorOf(version);
  if (major === null) return true;
  const match = spec.match(/major\s*(<=|>=|<|>|==|=)\s*(\d+)/);
  if (!match) return true;
  const [, op, raw] = match;
  const limit = Number(raw);
  switch (op) {
    case '<=':
      return major <= limit;
    case '>=':
      return major >= limit;
    case '<':
      return major < limit;
    case '>':
      return major > limit;
    default:
      return major === limit;
  }
}

export class Registry {
  private records = new Map<string, Map<string, InstallRecord>>();
  private currentMap = new Map<string, string | null>();
  private scannedAt = 0;

  constructor(private readonly installRoot: () => string) {}

  get root(): string {
    return this.installRoot();
  }

  sdkDir(sdk: string): string {
    return path.join(this.root, sdk);
  }

  installDir(sdk: string, version: string): string {
    return path.join(this.root, sdk, version);
  }

  currentLink(sdk: string): string {
    return path.join(this.root, sdk, CURRENT);
  }

  private async readMeta(sdk: string, version: string): Promise<StoredInstall | null> {
    const file = path.join(this.installDir(sdk, version), META_FILE);
    const meta = await readJson<StoredInstall>(file);
    if (!meta) return null;
    return meta;
  }

  private resolveRecord(sdk: string, version: string, meta: StoredInstall | null, current: string | null, size: number, mtime: Date): InstallRecord {
    const dir = this.installDir(sdk, version);
    const binDirs = meta?.binDirs ?? [[]];
    const env: Record<string, string> = {};
    for (const item of meta?.envs ?? []) {
      if (!envApplies(item.version, version)) continue;
      env[item.name] = item.value.length > 0 ? path.join(dir, ...item.value) : dir;
    }
    if (Object.keys(env).length === 0 && meta) {
      // Keep additional env vars discoverable even when the conf is silent.
      if (sdk === 'go') env.GOROOT = dir;
      if (sdk === 'jdk') env.JAVA_HOME = dir;
    }
    return {
      sdk,
      version,
      path: dir,
      sizeBytes: size,
      installedAt: meta?.installedAt ?? mtime.toISOString(),
      installer: meta?.installer ?? 'other',
      binDirs,
      env,
      sourceUrl: meta?.sourceUrl ?? null,
      current: current === version,
      managed: meta !== null,
    };
  }

  async scan(): Promise<void> {
    const root = this.root;
    const records = new Map<string, Map<string, InstallRecord>>();
    const currents = new Map<string, string | null>();
    if (await pathExists(root)) {
      const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        const sdk = entry.name;
        const sdkPath = path.join(root, sdk);
        const linkTarget = await readLinkTarget(path.join(sdkPath, CURRENT));
        const current = linkTarget ? path.basename(linkTarget) : null;
        currents.set(sdk, current);
        const versionEntries = await fs.readdir(sdkPath, { withFileTypes: true }).catch(() => []);
        const versions = new Map<string, InstallRecord>();
        for (const versionEntry of versionEntries) {
          if (!versionEntry.isDirectory() || versionEntry.name === CURRENT) continue;
          if (versionEntry.name.startsWith('.')) continue;
          const version = versionEntry.name;
          const dir = path.join(sdkPath, version);
          let stat;
          try {
            stat = await fs.stat(dir);
          } catch {
            continue;
          }
          const meta = await this.readMeta(sdk, version);
          const size = await dirSize(dir);
          versions.set(version, this.resolveRecord(sdk, version, meta, current, size, stat.mtime));
        }
        if (versions.size > 0) records.set(sdk, versions);
      }
    }
    this.records = records;
    this.currentMap = currents;
    this.scannedAt = Date.now();
    log.info('scan complete', { sdks: records.size });
  }

  async ensureScan(): Promise<void> {
    if (Date.now() - this.scannedAt < 15_000 && this.records.size > 0) return;
    await this.scan();
  }

  async list(): Promise<InstallRecord[]> {
    await this.ensureScan();
    const out: InstallRecord[] = [];
    for (const versions of this.records.values()) for (const record of versions.values()) out.push(record);
    return out.sort((a, b) => (a.sdk === b.sdk ? b.version.localeCompare(a.version) : a.sdk.localeCompare(b.sdk)));
  }

  async index(): Promise<InstalledIndex> {
    await this.ensureScan();
    const bySdk = new Map<string, InstallRecord[]>();
    for (const [sdk, versions] of this.records) bySdk.set(sdk, [...versions.values()]);
    return { bySdk, current: new Map(this.currentMap) };
  }

  async currentVersion(sdk: string): Promise<string | null> {
    const target = await readLinkTarget(this.currentLink(sdk));
    return target ? path.basename(target) : null;
  }

  async isInstalled(sdk: string, version: string): Promise<boolean> {
    return await pathExists(this.installDir(sdk, version));
  }

  async writeMeta(record: StoredInstall): Promise<void> {
    await writeJsonAtomic(path.join(this.installDir(record.sdk, record.version), META_FILE), record);
  }

  async use(sdk: string, version: string): Promise<void> {
    const dir = this.installDir(sdk, version);
    if (!(await pathExists(dir))) throw new Error(`${sdk} ${version} 尚未安装`);
    await createDirLink(this.currentLink(sdk), dir);
    this.currentMap.set(sdk, version);
    const versions = this.records.get(sdk);
    if (versions) {
      for (const [v, record] of versions) versions.set(v, { ...record, current: v === version });
    }
    log.info('switched version', { sdk, version });
  }

  async remove(sdk: string, version: string): Promise<void> {
    const current = await this.currentVersion(sdk);
    if (current === version) {
      const link = this.currentLink(sdk);
      await removeDir(link);
    }
    await removeDir(this.installDir(sdk, version));
    this.records.get(sdk)?.delete(version);
    if (this.records.get(sdk)?.size === 0) this.records.delete(sdk);
    log.info('uninstalled', { sdk, version });
  }

  async createInstallDir(sdk: string, version: string): Promise<string> {
    const dir = this.installDir(sdk, version);
    await ensureDir(path.dirname(dir));
    if (await pathExists(dir)) throw new Error(`${sdk} ${version} 已存在，请先卸载`);
    return dir;
  }

  invalidate(): void {
    this.scannedAt = 0;
  }
}
