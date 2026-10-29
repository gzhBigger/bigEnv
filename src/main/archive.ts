import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import * as tar from 'tar';
import * as yauzl from 'yauzl';
import { createLogger } from './logger';
import { mapLimit } from './util';

const log = createLogger('archive');

export class UnsupportedArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedArchiveError';
  }
}

export type ArchiveKind = 'zip' | 'tar' | 'tgz';

export function archiveKind(file: string): ArchiveKind | null {
  const name = path.basename(file).toLowerCase();
  if (name.endsWith('.zip') || name.endsWith('.zipx')) return 'zip';
  if (name.endsWith('.tar.gz') || name.endsWith('.tgz') || name.endsWith('.tar.bz2') || name.endsWith('.tbz2')) return 'tgz';
  if (name.endsWith('.tar')) return 'tar';
  return null;
}

export function isSupportedArchive(file: string): boolean {
  return archiveKind(file) !== null;
}

/** Normalise an archive entry name and reject anything that could escape the destination. */
function safeEntryPath(destDir: string, rawName: string): string | null {
  const name = rawName.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!name) return null;
  if (/^[a-zA-Z]:/.test(name)) return null;
  const segments = name.split('/').filter((segment) => segment.length > 0 && segment !== '.');
  if (segments.some((segment) => segment === '..')) return null;
  const full = path.join(destDir, ...segments);
  const rel = path.relative(destDir, full);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return full;
}

async function extractZip(file: string, destDir: string, onEntry?: (count: number) => void): Promise<void> {
  // Entries are collected first with autoClose disabled: yauzl closes the archive as soon as the
  // last entry has been read, which would abort the streams we still have in flight.
  const zip = await yauzl.openPromise(file, { lazyEntries: true, autoClose: false, validateEntrySizes: false });
  let count = 0;
  try {
    const entries: yauzl.Entry[] = [];
    for await (const entry of zip.eachEntry()) entries.push(entry);

    const dirs: string[] = [];
    const files: Array<{ entry: yauzl.Entry; full: string; mode: number }> = [];
    for (const entry of entries) {
      const full = safeEntryPath(destDir, entry.fileName);
      if (!full) {
        log.warn('skipping unsafe archive entry', { name: entry.fileName });
        continue;
      }
      if (entry.fileName.endsWith('/')) {
        dirs.push(full);
        continue;
      }
      const mode = (entry.externalFileAttributes >>> 16) & 0o777;
      if ((mode & 0o170000) === 0o120000) {
        log.warn('skipping symlink entry', { name: entry.fileName });
        continue;
      }
      files.push({ entry, full, mode });
    }

    await Promise.all(dirs.map((dir) => fsp.mkdir(dir, { recursive: true })));

    await mapLimit(files, 8, async ({ entry, full, mode }) => {
      await fsp.mkdir(path.dirname(full), { recursive: true });
      const stream = await zip.openReadStreamPromise(entry);
      await pipeline(stream, fs.createWriteStream(full));
      if (process.platform !== 'win32' && (mode & 0o111) !== 0) {
        await fsp.chmod(full, mode).catch(() => undefined);
      }
      count += 1;
      if (count % 25 === 0) onEntry?.(count);
    });
  } finally {
    zip.close();
  }
  onEntry?.(count);
  log.info('zip extracted', { file, entries: count });
}

async function extractTar(file: string, destDir: string, onEntry?: (count: number) => void): Promise<void> {
  let count = 0;
  await tar.x({
    file,
    cwd: destDir,
    strict: false,
    preservePaths: false,
    filter: (entryPath) => {
      const normalised = entryPath.replace(/\\/g, '/');
      return !normalised.startsWith('/') && !normalised.split('/').includes('..');
    },
    onentry: () => {
      count += 1;
      if (count % 40 === 0) onEntry?.(count);
    },
  });
  onEntry?.(count);
  log.info('tar extracted', { file, entries: count });
}

export async function extractArchive(
  file: string,
  destDir: string,
  options: { onEntry?: (count: number) => void; signal?: AbortSignal } = {},
): Promise<void> {
  const kind = archiveKind(file);
  if (!kind) {
    throw new UnsupportedArchiveError(`暂不支持该压缩格式：${path.basename(file)}（当前支持 .zip / .tar / .tar.gz）`);
  }
  await fsp.mkdir(destDir, { recursive: true });
  if (options.signal?.aborted) throw new Error('已取消');
  if (kind === 'zip') await extractZip(file, destDir, options.onEntry);
  else await extractTar(file, destDir, options.onEntry);
}
