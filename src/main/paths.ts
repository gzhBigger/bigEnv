import { app } from 'electron';
import os from 'node:os';
import path from 'node:path';
import type { Settings } from '../shared/types';

export type PlatformOs = 'windows' | 'linux' | 'darwin';
export type PlatformArch = 'amd64' | 'arm64';

export function platformOs(): PlatformOs {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'darwin';
  return 'linux';
}

export function platformArch(): PlatformArch {
  return process.arch === 'arm64' ? 'arm64' : 'amd64';
}

export const DEFAULT_META_BASE = 'https://raw.githubusercontent.com/gvcgo/vsources/main';

export const META_BASE_OPTIONS: { id: string; label: string; base: string; note: string }[] = [
  {
    id: 'github',
    label: 'GitHub Raw（官方源）',
    base: DEFAULT_META_BASE,
    note: '与 vmr 相同的元数据源，国内偶发不稳定',
  },
  {
    id: 'jsdelivr',
    label: 'jsDelivr CDN（推荐国内）',
    base: 'https://cdn.jsdelivr.net/gh/gvcgo/vsources@main',
    note: 'CDN 加速，缓存约 12 小时',
  },
  {
    id: 'fastgit',
    label: 'ghproxy 镜像',
    base: 'https://gh-proxy.com/https://raw.githubusercontent.com/gvcgo/vsources/main',
    note: '第三方代理，稳定性取决于服务方',
  },
];

export interface AppPaths {
  dataRoot: string;
  logDir: string;
  metaDir: string;
  downloadDir: string;
  tempDir: string;
  envDir: string;
  /** Holds the `bigenv` CLI shim that can be published to PATH. */
  binDir: string;
  settingsFile: string;
}

let cached: AppPaths | null = null;

export function appPaths(): AppPaths {
  if (cached) return cached;
  const dataRoot = path.join(app.getPath('userData'));
  cached = {
    dataRoot,
    logDir: path.join(dataRoot, 'logs'),
    metaDir: path.join(dataRoot, 'meta'),
    downloadDir: path.join(dataRoot, 'downloads'),
    tempDir: path.join(dataRoot, 'temp'),
    envDir: path.join(dataRoot, 'env'),
    binDir: path.join(dataRoot, 'bin'),
    settingsFile: path.join(dataRoot, 'settings.json'),
  };
  return cached;
}

export function defaultInstallRoot(): string {
  return path.join(os.homedir(), '.bigenv');
}

export function defaultSettings(): Settings {
  return {
    installRoot: defaultInstallRoot(),
    metaBase: DEFAULT_META_BASE,
    mirror: 'off',
    proxy: '',
    concurrency: 2,
    showUnsupported: true,
    shellEnabled: false,
    pathMode: 'off',
    pathSdks: [],
    projects: [],
  };
}

/** Trailing separators confuse path.join and junction creation, so normalise them away. */
export function normalizeDir(input: string): string {
  const trimmed = input.trim().replace(/^"(.*)"$/, '$1');
  if (!trimmed) return trimmed;
  return path.resolve(trimmed);
}
