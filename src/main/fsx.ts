import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function isLink(target: string): Promise<boolean> {
  try {
    const st = await fs.lstat(target);
    return st.isSymbolicLink();
  } catch {
    return false;
  }
}

export async function removeDir(target: string): Promise<void> {
  if (!(await pathExists(target))) {
    if (await isLink(target)) await fs.unlink(target);
    return;
  }
  await fs.rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 });
}

/** Remove a directory entry without following junctions/symlinks into their target. */
export async function removeLink(target: string): Promise<void> {
  try {
    const st = await fs.lstat(target);
    if (st.isSymbolicLink()) await fs.unlink(target);
    else if (st.isDirectory()) await fs.rm(target, { recursive: true, force: true });
    else await fs.unlink(target);
  } catch {
    /* nothing to remove */
  }
}

export async function readJson<T>(file: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(file));
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(temp, file);
}

export async function writeFileAtomic(file: string, content: string): Promise<void> {
  await ensureDir(path.dirname(file));
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, content, 'utf8');
  await fs.rename(temp, file);
}

/** Recursively create a directory junction (Windows) or symlink (POSIX) at `link` -> `target`. */
export async function createDirLink(link: string, target: string): Promise<void> {
  await removeLink(link);
  await ensureDir(path.dirname(link));
  const type = process.platform === 'win32' ? 'junction' : 'dir';
  await fs.symlink(target, link, type);
}

export async function readLinkTarget(link: string): Promise<string | null> {
  try {
    return await fs.readlink(link);
  } catch {
    return null;
  }
}

/** Move a directory tree, falling back to copy+delete across volumes. */
export async function moveDir(from: string, to: string): Promise<void> {
  await ensureDir(path.dirname(to));
  try {
    await fs.rename(from, to);
    return;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'EXDEV' && code !== 'EPERM' && code !== 'ENOTEMPTY') throw err;
  }
  await fs.cp(from, to, { recursive: true, force: true, dereference: false });
  await fs.rm(from, { recursive: true, force: true, maxRetries: 3 });
}

const sizeCache = new Map<string, { size: number; mtimeMs: number }>();

async function dirSizeInner(dir: string): Promise<number> {
  let total = 0;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      total += await dirSizeInner(full);
    } else if (entry.isFile()) {
      try {
        const st = await fs.stat(full);
        total += st.size;
      } catch {
        /* file vanished */
      }
    }
  }
  return total;
}

export async function dirSize(dir: string): Promise<number> {
  let mtimeMs = 0;
  try {
    mtimeMs = (await fs.stat(dir)).mtimeMs;
  } catch {
    return 0;
  }
  const hit = sizeCache.get(dir);
  if (hit && hit.mtimeMs === mtimeMs) return hit.size;
  const size = await dirSizeInner(dir);
  sizeCache.set(dir, { size, mtimeMs });
  return size;
}

export function invalidateSize(dir: string): void {
  sizeCache.delete(dir);
}

/** Locate a directory that contains every flag entry, searching breadth-first from `root`. */
export async function findRootDir(root: string, flagFiles: string[]): Promise<string> {
  if (flagFiles.length === 0) {
    const entries = (await fs.readdir(root, { withFileTypes: true })).filter((e) => !e.name.startsWith('.') || e.name === '.bin');
    const dirs = entries.filter((e) => e.isDirectory());
    if (dirs.length === 1 && entries.length === 1) return path.join(root, dirs[0].name);
    return root;
  }
  const queue: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }];
  while (queue.length > 0) {
    const current = queue.shift()!;
    let names: string[] = [];
    try {
      names = await fs.readdir(current.dir);
    } catch {
      continue;
    }
    const set = new Set(names.map((n) => n.toLowerCase()));
    if (flagFiles.every((flag) => set.has(flag.toLowerCase()))) return current.dir;
    if (current.depth >= 4) continue;
    for (const name of names) {
      const full = path.join(current.dir, name);
      try {
        const st = await fs.lstat(full);
        if (st.isDirectory()) queue.push({ dir: full, depth: current.depth + 1 });
      } catch {
        /* skip */
      }
    }
  }
  return root;
}
