import fs from 'node:fs/promises';
import path from 'node:path';
import type { InstallRecord, ProjectInfo, ProjectLockEntry } from '../shared/types';
import { readJson, writeJsonAtomic } from './fsx';
import { createLogger } from './logger';
import type { Registry } from './registry';

const log = createLogger('projects');

export const LOCK_FILES = ['.bigenv.json', 'bigenv.json', '.vmr.lock'];

type LockMap = Record<string, string>;

function normalizeVersion(value: unknown, sdk: string): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.includes('@')) {
    const [head, tail] = trimmed.split('@');
    if (head === sdk && tail) return tail;
    return tail || null;
  }
  return trimmed;
}

export function parseLockContent(content: string): LockMap {
  const trimmed = content.trim();
  if (!trimmed) return {};
  try {
    const data = JSON.parse(trimmed) as unknown;
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const out: LockMap = {};
      for (const [sdk, value] of Object.entries(data as Record<string, unknown>)) {
        const version = normalizeVersion(value, sdk);
        if (version) out[sdk] = version;
      }
      return out;
    }
  } catch {
    /* fall through to line based format */
  }
  const out: LockMap = {};
  for (const line of trimmed.split(/\r?\n/)) {
    const match = line.trim().match(/^([\w.+-]+)\s*(?:@|=|:)\s*([\w.+-]+)$/);
    if (match) out[match[1]] = match[2];
  }
  return out;
}

export class ProjectService {
  constructor(private readonly registry: Registry) {}

  async findLockFile(startDir: string): Promise<string | null> {
    let current = path.resolve(startDir);
    for (let depth = 0; depth < 10; depth += 1) {
      for (const name of LOCK_FILES) {
        const candidate = path.join(current, name);
        try {
          const stat = await fs.stat(candidate);
          if (stat.isFile()) return candidate;
        } catch {
          /* keep looking */
        }
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return null;
  }

  async inspect(dir: string): Promise<ProjectInfo> {
    const resolved = path.resolve(dir);
    const lockFile = await this.findLockFile(resolved);
    const versions: LockMap = {};
    if (lockFile) {
      try {
        const content = await fs.readFile(lockFile, 'utf8');
        Object.assign(versions, parseLockContent(content));
      } catch (err) {
        log.warn('lock file unreadable', { lockFile, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return await this.describe(resolved, lockFile, versions);
  }

  private async describe(dir: string, lockFile: string | null, versions: LockMap): Promise<ProjectInfo> {
    const installed: InstallRecord[] = await this.registry.list();
    const entries: ProjectLockEntry[] = Object.entries(versions)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([sdk, version]) => {
        const record = installed.find((item) => item.sdk === sdk && item.version === version);
        return {
          sdk,
          version,
          installed: Boolean(record),
          path: record?.path ?? null,
        };
      });
    return { dir, lockFile, versions, entries };
  }

  async lock(dir: string, versions: LockMap): Promise<ProjectInfo> {
    const resolved = path.resolve(dir);
    const file = path.join(resolved, '.bigenv.json');
    const existing = await readJson<LockMap>(file);
    const next: LockMap = { ...(existing ?? {}) };
    for (const [sdk, version] of Object.entries(versions)) {
      if (version) next[sdk] = version;
      else delete next[sdk];
    }
    await writeJsonAtomic(file, next);
    log.info('project locked', { dir: resolved, count: Object.keys(next).length });
    return await this.describe(resolved, file, next);
  }

  async unlock(dir: string): Promise<ProjectInfo> {
    const resolved = path.resolve(dir);
    const lockFile = await this.findLockFile(resolved);
    if (lockFile) await fs.rm(lockFile, { force: true });
    return await this.inspect(resolved);
  }
}
