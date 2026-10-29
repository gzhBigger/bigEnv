import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';

export async function mapLimit<T, R>(items: readonly T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners = new Array(Math.min(Math.max(1, limit), items.length)).fill(null).map(async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function runCommand(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number; signal?: AbortSignal } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: process.platform === 'win32' && /\.(bat|cmd)$/i.test(command),
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const timer = options.timeoutMs ? setTimeout(() => child.kill(), options.timeoutMs) : null;
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
    if (options.signal) {
      options.signal.addEventListener('abort', () => child.kill(), { once: true });
    }
  });
}

export async function which(command: string): Promise<string | null> {
  const lookup = process.platform === 'win32' ? 'where' : 'which';
  try {
    const result = await runCommand(lookup, [command], { timeoutMs: 4000 });
    if (result.code !== 0) return null;
    const first = result.stdout.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0);
    return first ?? null;
  } catch {
    return null;
  }
}

export async function canExecute(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

export function stripTrailingSlash(value: string): string {
  return value.replace(/[\\/]+$/, '');
}

export function joinSegments(base: string, segments: string[]): string {
  if (segments.length === 0) return base;
  return path.join(base, ...segments);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}
