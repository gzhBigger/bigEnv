import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import type { EnvInjection, InstallRecord, PathConflict, PathMode, ShellInfo, Settings } from '../shared/types';
import { ensureDir, pathExists, writeFileAtomic } from './fsx';
import {
  effectivePathDirs,
  makeManagedMatcher,
  pathHasEntry,
  prependEntries,
  stripManaged,
} from './globalPath';
import type { PathScope } from './globalPath';
import { createLogger } from './logger';
import { appPaths } from './paths';
import type { Registry } from './registry';
import { which } from './util';

const log = createLogger('env');

/** Markers used by the removed profile-injection feature; kept only to clean up old installs. */
const LEGACY_BLOCK_START = '# >>> bigenv initialize >>>';
const LEGACY_BLOCK_END = '# <<< bigenv initialize <<<';


/** Primary executable per SDK, used for cheap shadowing checks. */
const SDK_EXE_HINTS: Record<string, string> = {
  node: 'node.exe',
  python: 'python.exe',
  go: 'go.exe',
  jdk: 'java.exe',
  rust: 'rustc.exe',
  dotnet: 'dotnet.exe',
  php: 'php.exe',
  bun: 'bun.exe',
  deno: 'deno.exe',
  zig: 'zig.exe',
  ruby: 'ruby.exe',
  lua: 'lua.exe',
  julia: 'julia.exe',
  kotlin: 'kotlin.exe',
  cmake: 'cmake.exe',
  ninja: 'ninja.exe',
  protoc: 'protoc.exe',
  kubectl: 'kubectl.exe',
  fd: 'fd.exe',
  ripgrep: 'rg.exe',
  fzf: 'fzf.exe',
  neovim: 'nvim.exe',
  'git-win': 'git.exe',
  'github-cli': 'gh.exe',
  elixir: 'elixir.bat',
  erlang: 'erl.exe',
  crystal: 'crystal.exe',
  dlang: 'dmd.exe',
  nim: 'nim.exe',
  v: 'v.exe',
  typst: 'typst.exe',
  wasmtime: 'wasmtime.exe',
  wasmedge: 'wasmedge.exe',
  upx: 'upx.exe',
  'tree-sitter': 'tree-sitter.exe',
  lazygit: 'lazygit.exe',
  lazydocker: 'lazydocker.exe',
  gsudo: 'gsudo.exe',
  msys2: 'msys2.exe',
};

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function uniquePaths(entries: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of entries) {
    const key = process.platform === 'win32' ? entry.toLowerCase() : entry;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

/** PowerShell prelude that puts bigEnv bins in front of PATH. No trailing commas: PowerShell rejects them. */
function psPathPrelude(entries: string[]): string[] {
  if (entries.length === 0) return [];
  return [
    '$__bigenv_paths = @(',
    entries.map((entry) => `  ${psQuote(entry)}`).join(',\n'),
    ')',
    'if ($__bigenv_paths.Count -gt 0) {',
    "  $__bigenv_rest = $env:PATH -split ';' | Where-Object { $_ -and ($__bigenv_paths -notcontains $_) }",
    "  $env:PATH = (($__bigenv_paths + $__bigenv_rest) -join ';')",
    '}',
  ];
}

export class EnvManager {
  constructor(
    private readonly registry: Registry,
    private readonly getSettings: () => Settings,
  ) {}

  private async records(): Promise<InstallRecord[]> {
    return await this.registry.list();
  }

  private resolveFor(records: InstallRecord[], overrides?: Map<string, string>): { paths: string[]; vars: Record<string, string> } {
    const bySdk = new Map<string, InstallRecord[]>();
    for (const record of records) {
      const list = bySdk.get(record.sdk) ?? [];
      list.push(record);
      bySdk.set(record.sdk, list);
    }
    const paths: string[] = [];
    const vars: Record<string, string> = {};
    const sdks = (overrides ? [...overrides.keys()] : [...bySdk.keys()]).sort((a, b) => a.localeCompare(b));
    for (const sdk of sdks) {
      const candidates = bySdk.get(sdk) ?? [];
      const wanted = overrides?.get(sdk);
      const record = wanted ? candidates.find((item) => item.version === wanted) : candidates.find((item) => item.current);
      if (!record) continue;
      for (const segments of record.binDirs) {
        paths.push(segments.length === 0 ? record.path : path.join(record.path, ...segments));
      }
      for (const [name, value] of Object.entries(record.env)) vars[name] = value;
    }
    return { paths: uniquePaths(paths), vars };
  }

  async computeInjection(overrides?: Map<string, string>): Promise<EnvInjection> {
    const { paths, vars } = this.resolveFor(await this.records(), overrides);
    return { pathEntries: paths, vars };
  }

  private cliScriptPath(): string {
    const packaged = path.join(process.resourcesPath, 'cli.cjs');
    if (existsSync(packaged)) return packaged;
    return path.join(app.getAppPath(), 'out', 'cli.cjs');
  }

  private cliLauncherPath(): string {
    return path.join(appPaths().binDir, 'bigenv.cmd');
  }

  /**
   * `bigenv` shim: keeps ELECTRON_RUN_AS_NODE scoped to the child process so the
   * packaged executable behaves like a plain Node runtime for the CLI script.
   */
  private async ensureCliLauncher(): Promise<string> {
    const launcher = this.cliLauncherPath();
    const script = this.cliScriptPath();
    const lines = [
      '@echo off',
      'setlocal',
      'set "ELECTRON_RUN_AS_NODE=1"',
      `"${process.execPath}" "${script}" %*`,
      'exit /b %ERRORLEVEL%',
    ];
    await ensureDir(path.dirname(launcher));
    await writeFileAtomic(launcher, `${lines.join('\r\n')}\r\n`);
    return launcher;
  }

  /** Directories of the active version, addressed through the stable `current` junction. */
  private async entryDirsBySdk(only?: ReadonlySet<string>): Promise<{ sdk: string; dirs: string[] }[]> {
    const settings = this.getSettings();
    const records = await this.records();
    const out: { sdk: string; dirs: string[] }[] = [];
    const sdks = [...new Set(records.filter((record) => record.current).map((record) => record.sdk))]
      .filter((sdk) => !only || only.has(sdk))
      .sort((a, b) => a.localeCompare(b));
    for (const sdk of sdks) {
      const record = records.find((item) => item.sdk === sdk && item.current);
      if (!record) continue;
      const base = path.join(settings.installRoot, sdk, 'current');
      const segments = record.binDirs.length > 0 ? record.binDirs : [[]];
      const dirs = uniquePaths(segments.map((seg) => (seg.length === 0 ? base : path.join(base, ...seg))));
      out.push({ sdk, dirs });
    }
    return out;
  }

  async globalEntries(): Promise<string[]> {
    const groups = await this.entryDirsBySdk(new Set(this.getSettings().pathSdks));
    return uniquePaths(groups.flatMap((group) => group.dirs));
  }

  /** Removes every bigEnv-owned entry from one registry scope. */
  async stripPathScope(scope: PathScope, options: { throwOnError?: boolean } = {}): Promise<void> {
    const matcher = makeManagedMatcher(this.getSettings().installRoot, appPaths().binDir);
    const result = await stripManaged(scope, matcher);
    if (!result.error) return;
    if (options.throwOnError) throw new Error(result.error);
    log.warn('path cleanup skipped', { scope, error: result.error });
  }

  /** Writes the current selection (launcher + enabled SDKs) into one registry scope. */
  async writePathScope(scope: PathScope): Promise<void> {
    const matcher = makeManagedMatcher(this.getSettings().installRoot, appPaths().binDir);
    const entries = await this.globalEntries();
    const launcher = await this.ensureCliLauncher();
    const withCli = uniquePaths([path.dirname(launcher), ...entries]);
    const result = await prependEntries(scope, withCli, matcher);
    if (result.error) throw new Error(result.error);
  }

  async setPathMode(mode: PathMode): Promise<void> {
    if (mode === 'off') {
      for (const scope of ['user', 'machine'] as const) {
        await this.stripPathScope(scope);
      }
      log.info('global path disabled');
      return;
    }
    // Publish into the target scope before cleaning the other one: if this write needs
    // elevation and fails, the previous scope must stay intact (no half-migrated PATH).
    await this.writePathScope(mode);
    for (const scope of ['machine', 'user'] as const) {
      if (scope !== mode) await this.stripPathScope(scope);
    }
    log.info('global path enabled', { mode });
  }

  async pathInfo(): Promise<{ mode: PathMode; entries: string[]; activeScope: 'user' | 'machine' | null; conflicts: PathConflict[] }> {
    const mode = this.getSettings().pathMode;
    const entries = await this.globalEntries();
    if (mode === 'off' || entries.length === 0) {
      return { mode, entries, activeScope: null, conflicts: [] };
    }
    const activeScope = (await pathHasEntry(mode, entries[0])) ? mode : null;
    const cacheKey = entries.join('|');
    if (this.conflictCache && this.conflictCache.key === cacheKey && Date.now() - this.conflictCache.at < 30_000) {
      return { mode, entries, activeScope, conflicts: this.conflictCache.value };
    }
    const conflicts = await this.detectConflicts(entries);
    this.conflictCache = { key: cacheKey, at: Date.now(), value: conflicts };
    return { mode, entries, activeScope, conflicts };
  }

  private conflictCache: { key: string; at: number; value: PathConflict[] } | null = null;

  private async detectConflicts(entries: string[]): Promise<PathConflict[]> {
    const settings = this.getSettings();
    const matcher = makeManagedMatcher(settings.installRoot, appPaths().binDir);
    const effective = await effectivePathDirs();
    const normalized = effective.map((dir) => path.normalize(dir).toLowerCase());
    const groups = await this.entryDirsBySdk(new Set(settings.pathSdks));
    const conflicts: PathConflict[] = [];
    for (const group of groups) {
      let found = false;
      for (const dir of group.dirs) {
        if (found) break;
        const index = normalized.indexOf(path.normalize(dir).toLowerCase());
        if (index < 0) continue;
        let names: string[] = [];
        const hint = SDK_EXE_HINTS[group.sdk];
        if (hint && existsSync(path.join(dir, hint))) {
          names = [hint];
        } else {
          try {
            names = (await fs.readdir(dir)).filter((name) => /\.exe$/i.test(name)).slice(0, 3);
          } catch {
            continue;
          }
        }
        for (const name of names) {
          const shadowedBy = effective.slice(0, index).find((candidate) => {
            if (matcher(candidate)) return false;
            return existsSync(path.join(candidate, name));
          });
          if (shadowedBy) {
            conflicts.push({ sdk: group.sdk, entry: dir, exe: name, shadowedBy });
            found = true;
            break;
          }
        }
      }
    }
    if (entries.length === 0) return [];
    return conflicts;
  }

  /**
   * Remove artifacts of the retired PowerShell-profile injection: the generated env scripts and
   * the marker block in any existing profile. Global PATH is the only global mechanism now.
   */
  async cleanupLegacyInjection(): Promise<void> {
    const envDir = appPaths().envDir;
    for (const file of ['env.ps1', 'env.cmd', 'env.sh']) {
      await fs.rm(path.join(envDir, file), { force: true }).catch(() => undefined);
    }
    const documents = path.join(process.env.USERPROFILE ?? '', 'Documents');
    const profiles = [
      path.join(documents, 'PowerShell', 'Microsoft.PowerShell_profile.ps1'),
      path.join(documents, 'WindowsPowerShell', 'Microsoft.PowerShell_profile.ps1'),
    ];
    for (const profile of profiles) {
      try {
        const content = await fs.readFile(profile, 'utf8');
        if (!content.includes(LEGACY_BLOCK_START)) continue;
        const start = content.indexOf(LEGACY_BLOCK_START);
        const end = content.indexOf(LEGACY_BLOCK_END, start);
        const cleaned = (start + end > start ? content.slice(0, start) + content.slice(end + LEGACY_BLOCK_END.length) : content).trimEnd();
        await writeFileAtomic(profile, cleaned.length > 0 ? `${cleaned}\n` : '');
        log.info('legacy profile block removed', { profile });
      } catch {
        /* profile missing or unreadable */
      }
    }
  }

  async info(): Promise<ShellInfo> {
    const pathState = await this.pathInfo();
    return {
      pathMode: pathState.mode,
      pathSdks: this.getSettings().pathSdks,
      globalEntries: pathState.entries,
      activeScope: pathState.activeScope,
      conflicts: pathState.conflicts,
      cliBinDir: appPaths().binDir,
      cliLauncher: existsSync(this.cliLauncherPath()) ? this.cliLauncherPath() : null,
      cliScript: this.cliScriptPath(),
    };
  }

  async refresh(): Promise<ShellInfo> {
    await this.ensureCliLauncher().catch((err: unknown) => {
      log.warn('cli launcher failed', err instanceof Error ? err.message : String(err));
    });
    const settings = this.getSettings();
    if (settings.pathMode !== 'off') {
      await this.setPathMode(settings.pathMode).catch((err: unknown) => {
        log.warn('global path refresh failed', err instanceof Error ? err.message : String(err));
      });
    }
    return await this.info();
  }

  async openTerminal(dir?: string, overrides?: Map<string, string>): Promise<void> {
    const injection = await this.computeInjection(overrides);
    const target = dir && (await pathExists(dir)) ? dir : process.env.USERPROFILE ?? process.cwd();
    const scriptFile = path.join(appPaths().envDir, 'open-terminal.ps1');
    const lines = [
      '# 由 bigEnv 生成的临时启动脚本',
      '$ErrorActionPreference = \'SilentlyContinue\'',
    ];
    if (injection.pathEntries.length > 0) {
      lines.push(...psPathPrelude(injection.pathEntries));
    }
    for (const [name, value] of Object.entries(injection.vars)) {
      lines.push(`$env:${name} = ${psQuote(value)}`);
    }
    lines.push(`Set-Location -LiteralPath ${psQuote(target)}`);
    lines.push('Write-Host "bigEnv 环境已就绪：$(Get-Location)" -ForegroundColor Green');
    lines.push('Remove-Variable __bigenv_rest -ErrorAction SilentlyContinue');
    lines.push('Remove-Variable __bigenv_paths -ErrorAction SilentlyContinue');
    await ensureDir(path.dirname(scriptFile));
    await writeFileAtomic(scriptFile, `${lines.join('\n')}\n`);

    const shellExe = (await which('pwsh')) ? 'pwsh.exe' : 'powershell.exe';
    const args = ['/c', 'start', '""', shellExe, '-NoExit', '-NoLogo', '-ExecutionPolicy', 'Bypass', '-File', scriptFile];
    await new Promise<void>((resolve, reject) => {
      const child = spawn('cmd.exe', args, { detached: true, stdio: 'ignore', windowsHide: true, cwd: target });
      child.on('error', reject);
      child.on('spawn', () => {
        child.unref();
        resolve();
      });
    });
    log.info('terminal opened', { dir: target, sdks: Object.keys(injection.vars).length });
  }
}