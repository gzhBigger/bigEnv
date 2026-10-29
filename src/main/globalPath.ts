import { spawn } from 'node:child_process';
import path from 'node:path';
import { createLogger } from './logger';
import { runCommand } from './util';

const log = createLogger('globalPath');

export type PathScope = 'user' | 'machine';

const REG_KEYS: Record<PathScope, string> = {
  user: 'HKCU\\Environment',
  machine: 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment',
};

export interface PathWriteResult {
  scope: PathScope;
  changed: boolean;
  value: string;
  error?: string;
}

function lower(value: string): string {
  return value.toLowerCase();
}

function trimSeparator(value: string): string {
  return value.replace(/[\\/]+$/, '');
}

/** Expand `%VAR%` references the way Windows does for REG_EXPAND_SZ values. */
export function expandEnv(value: string): string {
  return value.replace(/%([^%]+)%/g, (whole, name: string) => {
    const hit = Object.keys(process.env).find((key) => lower(key) === lower(name));
    return hit ? (process.env[hit] ?? whole) : whole;
  });
}

export function splitPathValue(value: string): string[] {
  return value
    .split(';')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function joinPathValue(entries: string[]): string {
  return entries.join(';');
}

/**
 * Matches entries that bigEnv owns: `<installRoot>\<sdk>\current[\<bin>]`,
 * the cli bin directory, and leftovers from an older install root.
 */
export function makeManagedMatcher(installRoot: string, binDir: string): (entry: string) => boolean {
  const root = lower(trimSeparator(expandEnv(installRoot)));
  const bin = lower(trimSeparator(expandEnv(binDir)));
  return (entry: string): boolean => {
    const normalized = lower(trimSeparator(expandEnv(entry)));
    if (!normalized) return false;
    if (normalized === bin) return true;
    const relative = normalized.startsWith(root + '\\') ? normalized.slice(root.length + 1) : null;
    if (relative && /^[^\\]+\\current(\\|$)/.test(relative)) return true;
    // An install root the user has since changed: still recognise our layout.
    return /[\\/]\.bigenv[\\/][^\\/]+[\\/]current([\\/]|$)/.test(normalized.replace(/\//g, '\\'));
  };
}

export async function readPathValue(scope: PathScope): Promise<string> {
  const result = await runCommand('reg', ['query', REG_KEYS[scope], '/v', 'Path'], { timeoutMs: 8000 });
  if (result.code !== 0) return '';
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = line.match(/^\s+Path\s+REG_(?:EXPAND_)?SZ\s{2,}(.*)$/i);
    if (match) return match[1];
    const loose = line.match(/^\s+Path\s+REG_(?:EXPAND_)?SZ\s+(.*)$/i);
    if (loose) return loose[1].trim();
  }
  return '';
}

/**
 * Broadcasts WM_SETTINGCHANGE so Explorer and newly started shells pick the value up.
 * Re-setting the same value through .NET is enough and avoids passing the long PATH on a command line.
 *
 * This is best-effort and deliberately not awaited: PowerShell takes seconds to cold start, and the
 * registry value is already updated. Newly launched shells read the registry on their own, so a slow
 * broadcast must not block the UI's "written" state.
 */
function broadcast(scope: PathScope): void {
  const target = scope === 'machine' ? 'Machine' : 'User';
  const script = `$v=[Environment]::GetEnvironmentVariable('Path','${target}'); if ($null -ne $v) { [Environment]::SetEnvironmentVariable('Path',$v,'${target}') }`;
  try {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      stdio: 'ignore',
      detached: true,
      windowsHide: true,
    });
    child.on('error', (error) => log.warn('environment broadcast failed to start', { scope, error: String(error) }));
    child.unref();
  } catch (error) {
    log.warn('environment broadcast failed', { scope, error: String(error) });
  }
}

export async function writePathValue(scope: PathScope, value: string): Promise<PathWriteResult> {
  if (value.length > 30000) {
    return { scope, changed: false, value, error: 'PATH 过长（超过 30000 字符），未写入' };
  }
  const add = await runCommand(
    'reg',
    ['add', REG_KEYS[scope], '/v', 'Path', '/t', 'REG_EXPAND_SZ', '/d', value, '/f'],
    { timeoutMs: 10000 },
  );
  if (add.code !== 0) {
    return {
      scope,
      changed: false,
      value,
      error: scope === 'machine' ? '写入系统 PATH 需要管理员权限' : add.stderr.trim() || '写入失败',
    };
  }
  broadcast(scope);
  return { scope, changed: true, value };
}

/** Remove every entry the matcher owns, preserving foreign entries byte for byte. */
export async function stripManaged(scope: PathScope, managed: (entry: string) => boolean): Promise<PathWriteResult> {
  const current = await readPathValue(scope);
  const entries = splitPathValue(current);
  const kept = entries.filter((entry) => !managed(entry));
  if (kept.length === entries.length) return { scope, changed: false, value: current };
  return await writePathValue(scope, joinPathValue(kept));
}

/** Prepend `entries` (and optionally `extra`) after dropping stale managed entries. */
export async function prependEntries(
  scope: PathScope,
  entries: string[],
  managed: (entry: string) => boolean,
): Promise<PathWriteResult> {
  const current = await readPathValue(scope);
  const kept = splitPathValue(current).filter((entry) => !managed(entry));
  const next: string[] = [];
  for (const entry of entries) {
    if (!next.some((item) => lower(trimSeparator(item)) === lower(trimSeparator(entry)))) next.push(entry);
  }
  for (const entry of kept) next.push(entry);
  const value = joinPathValue(next);
  if (value === current.trim()) return { scope, changed: false, value };
  return await writePathValue(scope, value);
}

/** Machine entries are consulted before user entries on Windows. */
export async function effectivePathDirs(): Promise<string[]> {
  const dirs: string[] = [];
  for (const scope of ['machine', 'user'] as PathScope[]) {
    const raw = await readPathValue(scope);
    for (const entry of splitPathValue(raw)) {
      const expanded = path.normalize(expandEnv(entry));
      if (!dirs.some((item) => lower(trimSeparator(item)) === lower(trimSeparator(expanded)))) dirs.push(expanded);
    }
  }
  return dirs;
}

export async function pathHasEntry(scope: PathScope, entry: string): Promise<boolean> {
  const raw = await readPathValue(scope);
  const target = lower(trimSeparator(entry));
  return splitPathValue(raw).some((item) => lower(trimSeparator(expandEnv(item))) === target);
}
