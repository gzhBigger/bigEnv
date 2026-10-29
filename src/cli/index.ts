/* bigEnv CLI — runs without Electron, reads the same on-disk layout the desktop app writes. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

interface StoredEnv {
  name: string;
  value: string[];
  version?: string;
}

interface StoredInstall {
  sdk: string;
  version: string;
  binDirs: string[][];
  envs: StoredEnv[];
  installedAt?: string;
}

interface Install {
  sdk: string;
  version: string;
  dir: string;
  binDirs: string[][];
  env: Record<string, string>;
  current: boolean;
}

const LOCK_FILES = ['.bigenv.json', 'bigenv.json'];
const META_FILE = '.bigenv.json';

function dataRoot(): string {
  if (process.platform === 'win32') return path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'bigEnv');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'bigEnv');
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'bigEnv');
}

async function installRoot(): Promise<string> {
  try {
    const raw = await fsp.readFile(path.join(dataRoot(), 'settings.json'), 'utf8');
    const parsed = JSON.parse(raw) as { installRoot?: string };
    if (parsed.installRoot && parsed.installRoot.trim()) return parsed.installRoot.trim();
  } catch {
    /* fall back to default below */
  }
  return path.join(os.homedir(), '.bigenv');
}

function exists(target: string): boolean {
  try {
    fs.accessSync(target);
    return true;
  } catch {
    return false;
  }
}

async function readMeta(dir: string): Promise<StoredInstall | null> {
  try {
    return JSON.parse(await fsp.readFile(path.join(dir, META_FILE), 'utf8')) as StoredInstall;
  } catch {
    return null;
  }
}

async function currentTarget(sdkDir: string): Promise<string | null> {
  try {
    const link = path.join(sdkDir, 'current');
    const target = await fsp.readlink(link);
    return path.basename(path.resolve(sdkDir, target));
  } catch {
    return null;
  }
}

async function loadInstalls(root: string): Promise<Install[]> {
  let sdkDirs: string[] = [];
  try {
    const entries = await fsp.readdir(root, { withFileTypes: true });
    sdkDirs = entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(root, entry.name));
  } catch {
    return [];
  }
  const out: Install[] = [];
  for (const sdkDir of sdkDirs) {
    const sdk = path.basename(sdkDir);
    const current = await currentTarget(sdkDir);
    let versionDirs: string[] = [];
    try {
      const entries = await fsp.readdir(sdkDir, { withFileTypes: true });
      versionDirs = entries
        .filter((entry) => entry.isDirectory() && entry.name !== 'current')
        .map((entry) => path.join(sdkDir, entry.name));
    } catch {
      continue;
    }
    for (const dir of versionDirs) {
      const meta = await readMeta(dir);
      if (!meta) continue;
      const env: Record<string, string> = {};
      for (const spec of meta.envs ?? []) {
        if (!envApplies(spec.version, meta.version)) continue;
        env[spec.name] = spec.value.map((segment) => (path.isAbsolute(segment) ? segment : path.join(dir, segment))).join(';');
      }
      out.push({
        sdk,
        version: meta.version ?? path.basename(dir),
        dir,
        binDirs: meta.binDirs ?? [['']],
        env,
        current: current === path.basename(dir),
      });
    }
  }
  return out;
}

function majorOf(version: string): number | null {
  const match = version.match(/\d+/);
  return match ? Number(match[0]) : null;
}

function envApplies(spec: string | undefined, version: string): boolean {
  if (!spec) return true;
  const major = majorOf(version);
  if (major === null) return true;
  const match = spec.match(/major\s*(<=|>=|<|>|==|=)\s*(\d+)/);
  if (!match) return true;
  const limit = Number(match[2]);
  switch (match[1]) {
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

function parseLock(content: string): Record<string, string> {
  const trimmed = content.trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof value !== 'string') continue;
        const at = value.indexOf('@');
        if (at > 0) out[value.slice(0, at)] = value.slice(at + 1);
        else out[key] = value;
      }
      return out;
    }
  } catch {
    /* fall through to line format */
  }
  const out: Record<string, string> = {};
  for (const line of trimmed.split(/\r?\n/)) {
    const match = line.trim().match(/^([\w.+-]+)\s*@\s*([\w.+-]+)$/);
    if (match) out[match[1]] = match[2];
  }
  return out;
}

function findLock(start: string): { file: string; dir: string; versions: Record<string, string> } | null {
  let dir = path.resolve(start);
  for (let depth = 0; depth < 12; depth += 1) {
    for (const name of LOCK_FILES) {
      const file = path.join(dir, name);
      if (!exists(file)) continue;
      const versions = parseLock(fs.readFileSync(file, 'utf8'));
      if (Object.keys(versions).length > 0) return { file, dir, versions };
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function selectInstalls(installs: Install[], versions: Record<string, string> | null): Install[] {
  if (!versions || Object.keys(versions).length === 0) return installs.filter((item) => item.current);
  const picked: Install[] = [];
  for (const [sdk, version] of Object.entries(versions)) {
    const hit = installs.find((item) => item.sdk === sdk && item.version === version);
    if (hit) picked.push(hit);
    else process.stderr.write(`bigEnv: ${sdk}@${version} 未安装，已跳过\n`);
  }
  return picked;
}

function envFor(installs: Install[]): { pathEntries: string[]; vars: Record<string, string> } {
  const pathEntries: string[] = [];
  const vars: Record<string, string> = {};
  const seen = new Set<string>();
  for (const install of installs) {
    const segments = install.binDirs.length > 0 ? install.binDirs : [[]];
    for (const segment of segments) {
      const dir = segment.length === 0 ? install.dir : path.join(install.dir, ...segment);
      const key = process.platform === 'win32' ? dir.toLowerCase() : dir;
      if (seen.has(key)) continue;
      seen.add(key);
      pathEntries.push(dir);
    }
    Object.assign(vars, install.env);
  }
  return { pathEntries, vars };
}

function mergeEnv(installs: Install[]): NodeJS.ProcessEnv {
  const { pathEntries, vars } = envFor(installs);
  const env: NodeJS.ProcessEnv = { ...process.env, ...vars };
  const delimiter = process.platform === 'win32' ? ';' : ':';
  const rest = (process.env.PATH ?? '').split(delimiter).filter((entry) => entry && !pathEntries.includes(entry));
  env.PATH = [...pathEntries, ...rest].join(delimiter);
  return env;
}

function resolveExecutable(command: string, searchPath: string): string | null {
  if (command.includes('/') || command.includes('\\')) return exists(command) ? command : null;
  const dirs = searchPath.split(process.platform === 'win32' ? ';' : ':').filter(Boolean);
  const extensions = process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat', '.com'] : [''];
  for (const dir of dirs) {
    for (const ext of extensions) {
      const candidate = path.join(dir, command.endsWith(ext) && ext ? command : command + ext);
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}

function quoteCmd(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function runCommand(exe: string, args: string[], env: NodeJS.ProcessEnv, cwd: string): Promise<number> {
  const ext = path.extname(exe).toLowerCase();
  const options = { stdio: 'inherit' as const, env, cwd };
  const child =
    process.platform === 'win32' && (ext === '.cmd' || ext === '.bat')
      ? spawn('cmd.exe', ['/d', '/s', '/c', [quoteCmd(exe), ...args.map(quoteCmd)].join(' ')], {
          ...options,
          windowsVerbatimArguments: true,
        })
      : spawn(exe, args, options);
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

function help(): void {
  process.stdout.write(
    [
      'bigEnv CLI — 按项目锁或当前版本运行命令',
      '',
      '用法:',
      '  bigenv run [--dir <目录>] [--all] -- <命令> [参数...]',
      '  bigenv env [--json|--cmd|--ps]      输出环境（默认人类可读）',
      '  bigenv which <sdk>                  查看某 SDK 当前指向',
      '  bigenv list                         列出已安装版本',
      '  bigenv use <sdk@version>            切换当前版本（改 junction）',
      '  bigenv help                         显示本帮助',
      '',
      '说明: run 会向上查找 .bigenv.json / bigenv.json；',
      '     没有锁文件时注入全部 current 版本；--all 强制注入全部。',
    ].join('\n') + '\n',
  );
}

async function main(argv: string[]): Promise<number> {
  const [command = 'help', ...rest] = argv;
  const root = await installRoot();
  const installs = await loadInstalls(root);

  if (command === 'help' || command === '--help' || command === '-h') {
    help();
    return 0;
  }

  if (command === 'list') {
    if (installs.length === 0) process.stdout.write(`未安装任何版本（${root}）\n`);
    for (const install of installs.sort((a, b) => a.sdk.localeCompare(b.sdk) || a.version.localeCompare(b.version))) {
      process.stdout.write(`${install.current ? '*' : ' '} ${install.sdk.padEnd(14)} ${install.version.padEnd(16)} ${install.dir}\n`);
    }
    return 0;
  }

  if (command === 'which') {
    const sdk = rest[0];
    if (!sdk) {
      process.stderr.write('用法: bigenv which <sdk>\n');
      return 2;
    }
    const hit = installs.find((item) => item.sdk === sdk && item.current);
    if (!hit) {
      process.stderr.write(`${sdk} 没有激活版本\n`);
      return 1;
    }
    const { pathEntries } = envFor([hit]);
    process.stdout.write(`${sdk} ${hit.version}\n${pathEntries.join('\n')}\n`);
    return 0;
  }

  if (command === 'env') {
    const flag = rest[0] ?? '';
    const lock = findLock(process.cwd());
    const picked = selectInstalls(installs, lock?.versions ?? null);
    const { pathEntries, vars } = envFor(picked);
    const delimiter = process.platform === 'win32' ? ';' : ':';
    if (flag === '--json') {
      process.stdout.write(`${JSON.stringify({ installRoot: root, lock: lock?.file ?? null, pathEntries, vars }, null, 2)}\n`);
    } else if (flag === '--cmd') {
      process.stdout.write(`set "PATH=${pathEntries.join(';')};%PATH%"\n`);
      for (const [name, value] of Object.entries(vars)) process.stdout.write(`set "${name}=${value}"\n`);
    } else if (flag === '--ps') {
      process.stdout.write(`$env:PATH = '${pathEntries.join(';')};' + $env:PATH\n`);
      for (const [name, value] of Object.entries(vars)) process.stdout.write(`$env:${name} = '${value.replace(/'/g, "''")}'\n`);
    } else {
      process.stdout.write(`安装根: ${root}\n锁文件: ${lock?.file ?? '（无，使用 current）'}\n`);
      process.stdout.write(`PATH:\n${pathEntries.map((entry) => `  ${entry}`).join('\n') || '  （空）'}\n`);
      const names = Object.keys(vars);
      if (names.length > 0) process.stdout.write(`变量:\n${names.map((name) => `  ${name}=${vars[name]}`).join('\n')}\n`);
      process.stdout.write(`合并分隔符: ${delimiter}\n`);
    }
    return 0;
  }

  if (command === 'use') {
    const spec = rest[0] ?? '';
    const at = spec.lastIndexOf('@');
    if (at <= 0) {
      process.stderr.write('用法: bigenv use <sdk@version>\n');
      return 2;
    }
    const sdk = spec.slice(0, at);
    const version = spec.slice(at + 1);
    const target = path.join(root, sdk, version);
    if (!exists(target)) {
      process.stderr.write(`${sdk}@${version} 未安装（${target}）\n`);
      return 1;
    }
    const link = path.join(root, sdk, 'current');
    try {
      await fsp.rm(link, { recursive: true, force: true });
    } catch {
      /* nothing to replace */
    }
    await fsp.symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
    process.stdout.write(`${sdk} -> ${version}\n`);
    return 0;
  }

  if (command === 'run') {
    let dir = process.cwd();
    let forceAll = false;
    let index = 0;
    while (index < rest.length && rest[index] !== '--') {
      const token = rest[index];
      if (token === '--dir') {
        dir = path.resolve(rest[index + 1] ?? dir);
        index += 2;
      } else if (token === '--all') {
        forceAll = true;
        index += 1;
      } else {
        break;
      }
    }
    if (rest[index] === '--') index += 1;
    const commandArgs = rest.slice(index);
    if (commandArgs.length === 0) {
      process.stderr.write('用法: bigenv run -- <命令> [参数...]\n');
      return 2;
    }
    const lock = forceAll ? null : findLock(dir);
    const picked = selectInstalls(installs, lock?.versions ?? null);
    const env = mergeEnv(picked);
    const exe = resolveExecutable(commandArgs[0], env.PATH ?? '');
    if (!exe) {
      process.stderr.write(`找不到命令: ${commandArgs[0]}\n`);
      return 127;
    }
    return await runCommand(exe, commandArgs.slice(1), env, dir);
  }

  process.stderr.write(`未知命令: ${command}\n`);
  help();
  return 2;
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    process.stderr.write(`bigEnv CLI 出错: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
