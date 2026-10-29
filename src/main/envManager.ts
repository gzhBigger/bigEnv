import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { EnvInjection, InstallRecord, ShellInfo, Settings } from '../shared/types';
import { ensureDir, pathExists, writeFileAtomic } from './fsx';
import { createLogger } from './logger';
import { appPaths } from './paths';
import type { Registry } from './registry';
import { which } from './util';

const log = createLogger('env');

const MARKER_START = '# >>> bigenv initialize >>>';
const MARKER_END = '# <<< bigenv initialize <<<';

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
    };
  }

  async refresh(): Promise<ShellInfo> {
    const injection = await this.computeInjection();
    await this.writeScripts(injection);
    const settings = this.getSettings();
    if (settings.shellEnabled) {
      await this.installHook().catch((err: unknown) => {
        log.warn('refresh hook failed', err instanceof Error ? err.message : String(err));
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
