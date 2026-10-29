import fs from 'node:fs/promises';
import path from 'node:path';
import type { InstallRecord, ProjectInfo, ProjectLockEntry } from '../shared/types';
import { readJson, writeJsonAtomic } from './fsx';
import { createLogger } from './logger';
import type { Registry } from './registry';

const log = createLogger('projects');

/** The lock file is owned by bigEnv; no third-party formats are read. */
export const LOCK_FILE = '.bigenv.json';

type LockMap = Record<string, string>;

/**
 * Lock files are a flat JSON object: `{ "node": "24.22.1", "go": "1.24.5" }`.
 * Values may carry a `sdk@` prefix from older hand-written files; it is stripped.
 */
export function parseLockContent(content: string, sdkHint?: string): LockMap {
  const trimmed = content.trim();
  if (!trimmed) return {};
  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch {
    return {};
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  const out: LockMap = {};
  for (const [sdk, value] of Object.entries(data as Record<string, unknown>)) {
    if (typeof value !== 'string') continue;
    let version = value.trim();
    if (!version) continue;
    if (version.includes('@')) {
      const [head, tail] = version.split('@');
      if (head === sdk || head === sdkHint) version = tail ?? '';
    }
    if (version) out[sdk] = version;
  }
  return out;
}

async function readLockFile(dir: string): Promise<{ file: string; versions: LockMap } | null> {
  const candidate = path.join(dir, LOCK_FILE);
  try {
    const stat = await fs.stat(candidate);
    if (!stat.isFile()) return null;
    const content = await fs.readFile(candidate, 'utf8');
    return { file: candidate, versions: parseLockContent(content) };
  } catch {
    return null;
  }
}

export class ProjectService {
  constructor(private readonly registry: Registry) {}

  /** Reads the lock file of exactly this directory (no parent walk). */
  async inspect(dir: string): Promise<ProjectInfo> {
    const resolved = path.resolve(dir);
    const lock = await readLockFile(resolved);
    if (!lock) {
      return { dir: resolved, name: path.basename(resolved), lockFile: null, versions: {}, entries: [] };
    }
    return await this.describe(resolved, lock.file, lock.versions);
  }

  private async describe(dir: string, lockFile: string | null, versions: LockMap): Promise<ProjectInfo> {
    const installed: InstallRecord[] = await this.registry.list();
    const entries: ProjectLockEntry[] = Object.entries(versions)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([sdk, version]) => {
        const record = installed.find((item) => item.sdk === sdk && item.version === version);
        return { sdk, version, installed: Boolean(record), path: record?.path ?? null };
      });
    return { dir, name: path.basename(dir), lockFile, versions, entries };
  }

  /** Replaces the lock file so it contains exactly the selected SDKs. */
  async save(dir: string, versions: LockMap): Promise<ProjectInfo> {
    const resolved = path.resolve(dir);
    const file = path.join(resolved, LOCK_FILE);
    const clean: LockMap = {};
    for (const [sdk, version] of Object.entries(versions)) {
      if (typeof sdk === 'string' && sdk && typeof version === 'string' && version) clean[sdk] = version;
    }
    if (Object.keys(clean).length === 0) {
      await fs.rm(file, { force: true });
      log.info('project lock cleared', { dir: resolved });
      return await this.inspect(resolved);
    }
    const existing = await readJson<unknown>(file);
    if (existing === undefined || existing === null) {
      /* keep the previous revision even when it was written by hand; only content matters */
    }
    await writeJsonAtomic(file, clean);
    log.info('project saved', { dir: resolved, count: Object.keys(clean).length });
    return await this.describe(resolved, file, clean);
  }
}
