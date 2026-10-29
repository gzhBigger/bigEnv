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
import { createLogger } from './logger';
import { appPaths } from './paths';
import type { Registry } from './registry';
import { which } from './util';

const log = createLogger('env');

const MARKER_START = '# >>> bigenv initialize >>>';
const MARKER_END = '# <<< bigenv initialize <<<';

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
    const sdks = [...bySdk.keys()].sort((a, b) => a.localeCompare(b));
    for (const sdk of sdks) {
      const candidates = bySdk.get(sdk)!;
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
  private async entryDirsBySdk(): Promise<{ sdk: string; dirs: string[] }[]> {
    const settings = this.getSettings();
    const records = await this.records();
    const out: { sdk: string; dirs: string[] }[] = [];
    const sdks = [...new Set(records.filter((record) => record.current).map((record) => record.sdk))].sort((a, b) =>
      a.localeCompare(b),
    );
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
    const groups = await this.entryDirsBySdk();
    return uniquePaths(groups.flatMap((group) => group.dirs));
  }

  async setPathMode(mode: PathMode): Promise<void> {
    const matcher = makeManagedMatcher(this.getSettings().installRoot, appPaths().binDir);
    if (mode === 'off') {
      for (const scope of ['user', 'machine'] as const) {
        const result = await stripManaged(scope, matcher);
        if (result.error) log.warn('path cleanup skipped', { scope, error: result.error });
      }
      log.info('global path disabled');
      return;
    }
    const entries = await this.globalEntries();
    const launcher = await this.ensureCliLauncher();
    const withCli = uniquePaths([path.dirname(launcher), ...entries]);
    for (const scope of ['machine', 'user'] as const) {
      if (scope !== mode) {
        const cleaned = await stripManaged(scope, matcher);
        if (cleaned.error) log.warn('path cleanup skipped', { scope, error: cleaned.error });
      }
    }
    const result = await prependEntries(mode, withCli, matcher);
    if (result.error) throw new Error(result.error);
    log.info('global path enabled', { mode, entries: withCli.length });
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
    const groups = await this.entryDirsBySdk();
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

  private scriptPaths(): { ps1: string; cmd: string; sh: string } {
    const dir = appPaths().envDir;
    return { ps1: path.join(dir, 'env.ps1'), cmd: path.join(dir, 'env.cmd'), sh: path.join(dir, 'env.sh') };
  }

  private async writeScripts(injection: EnvInjection): Promise<void> {
    const files = this.scriptPaths();
    const psLines = [
      '# 由 bigEnv 自动生成，请勿手动编辑。',
      `# ${new Date().toISOString()}`,
      ...psPathPrelude(injection.pathEntries),
    ];
    for (const [name, value] of Object.entries(injection.vars)) {
      psLines.push(`$env:${name} = ${psQuote(value)}`);
    }
    psLines.push('Remove-Variable __bigenv_paths -ErrorAction SilentlyContinue');
    psLines.push('Remove-Variable __bigenv_rest -ErrorAction SilentlyContinue');

    const cmdLines = ['@echo off', 'rem 由 bigEnv 自动生成，请勿手动编辑。'];
    if (injection.pathEntries.length > 0) {
      cmdLines.push(`set "PATH=${injection.pathEntries.join(';')};%PATH%"`);
    }
    for (const [name, value] of Object.entries(injection.vars)) {
      cmdLines.push(`set "${name}=${value}"`);
    }

    const shLines = ['# 由 bigEnv 自动生成，请勿手动编辑。'];
    if (injection.pathEntries.length > 0) {
      shLines.push(`export PATH="${injection.pathEntries.join(':')}:$PATH"`);
    }
    for (const [name, value] of Object.entries(injection.vars)) {
      shLines.push(`export ${name}="${value.replace(/"/g, '\\"')}"`);
    }

    await ensureDir(appPaths().envDir);
    await writeFileAtomic(files.ps1, `${psLines.join('\n')}\n`);
    await writeFileAtomic(files.cmd, `${cmdLines.join('\r\n')}\r\n`);
    await writeFileAtomic(files.sh, `${shLines.join('\n')}\n`);
    log.info('env scripts written', { paths: injection.pathEntries.length, vars: Object.keys(injection.vars).length });
  }

  private profileCandidates(): string[] {
    const documents = path.join(process.env.USERPROFILE ?? '', 'Documents');
    return [
      path.join(documents, 'PowerShell', 'Microsoft.PowerShell_profile.ps1'),
      path.join(documents, 'WindowsPowerShell', 'Microsoft.PowerShell_profile.ps1'),
    ];
  }

  private hookBlock(): string {
    const envScript = this.scriptPaths().ps1.replace(/\\/g, '/');
    return [
      MARKER_START,
      '# 由 bigEnv 自动生成。删除本段注释包裹的三行即可关闭自动注入。',
      `$__bigenvEnv = '${envScript.replace(/'/g, "''")}'`,
      'if (Test-Path -LiteralPath $__bigenvEnv) { . $__bigenvEnv }',
      'Remove-Variable __bigenvEnv -ErrorAction SilentlyContinue',
      MARKER_END,
    ].join('\n');
  }

  private stripHook(content: string): string {
    const start = content.indexOf(MARKER_START);
    if (start < 0) return content;
    const end = content.indexOf(MARKER_END, start);
    if (end < 0) return content;
    return content.slice(0, start) + content.slice(end + MARKER_END.length);
  }

  async info(): Promise<ShellInfo> {
    const injection = await this.computeInjection();
    const pathState = await this.pathInfo();
    const profiles = this.profileCandidates().filter((p) => p.length > 0);
    let profilePath: string | null = profiles[0] ?? null;
    let enabled = false;
    for (const profile of profiles) {
      try {
        const content = await fs.readFile(profile, 'utf8');
        if (content.includes(MARKER_START)) {
          enabled = true;
          profilePath = profile;
          break;
        }
      } catch {
        /* profile may not exist yet */
      }
    }
    return {
      envScriptPath: this.scriptPaths().ps1,
      profilePath,
      enabled,
      pathEntries: injection.pathEntries,
      vars: injection.vars,
      pathMode: pathState.mode,
      globalEntries: pathState.entries,
      activeScope: pathState.activeScope,
      conflicts: pathState.conflicts,
      cliBinDir: appPaths().binDir,
      cliLauncher: existsSync(this.cliLauncherPath()) ? this.cliLauncherPath() : null,
      cliScript: this.cliScriptPath(),
    };
  }

  async refresh(): Promise<ShellInfo> {
    const injection = await this.computeInjection();
    await this.writeScripts(injection);
    await this.ensureCliLauncher().catch((err: unknown) => {
      log.warn('cli launcher failed', err instanceof Error ? err.message : String(err));
    });
    const settings = this.getSettings();
    if (settings.shellEnabled) {
      await this.installHook().catch((err: unknown) => {
        log.warn('refresh hook failed', err instanceof Error ? err.message : String(err));
      });
    }
    if (settings.pathMode !== 'off') {
      await this.setPathMode(settings.pathMode).catch((err: unknown) => {
        log.warn('global path refresh failed', err instanceof Error ? err.message : String(err));
      });
    }
    return await this.info();
  }

  private async installHook(): Promise<void> {
    const block = this.hookBlock();
    for (const profile of this.profileCandidates()) {
      await ensureDir(path.dirname(profile));
      let content = '';
      try {
        content = await fs.readFile(profile, 'utf8');
      } catch {
        content = '';
      }
      const cleaned = this.stripHook(content).replace(/\s+$/, '');
      const next = cleaned.length > 0 ? `${cleaned}\n\n${block}\n` : `${block}\n`;
      await writeFileAtomic(profile, next);
    }
  }

  private async removeHook(): Promise<void> {
    for (const profile of this.profileCandidates()) {
      try {
        const content = await fs.readFile(profile, 'utf8');
        if (!content.includes(MARKER_START)) continue;
        const cleaned = this.stripHook(content).replace(/\s+$/, '');
        await writeFileAtomic(profile, cleaned.length > 0 ? `${cleaned}\n` : '');
      } catch {
        /* nothing to clean */
      }
    }
  }

  async enable(): Promise<ShellInfo> {
    await this.refresh();
    await this.installHook();
    log.info('shell hook enabled');
    return await this.info();
  }

  async disable(): Promise<ShellInfo> {
    await this.removeHook();
    log.info('shell hook disabled');
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
