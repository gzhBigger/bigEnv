import { contextBridge, ipcRenderer } from 'electron';
import type { Bridge, InstallRecord, JobState, Settings, SdkSummary } from '../shared/types';

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args) as Promise<T>;
}

function subscribe<T>(channel: string) {
  return (callback: (payload: T) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: T): void => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  };
}

const runtime = ipcRenderer.sendSync('bigenv:runtime:sync') as Bridge['runtime'] | undefined;

const bridge: Bridge = {
  catalog: {
    list: () => invoke<SdkSummary[]>('bigenv:catalog:list'),
    versions: (sdkId) => invoke('bigenv:catalog:versions', sdkId),
    refresh: async () => {
      await invoke('bigenv:catalog:refresh');
    },
  },
  installs: {
    start: (sdkId, version) => invoke<JobState>('bigenv:installs:start', sdkId, version),
    cancel: (jobId) => invoke('bigenv:installs:cancel', jobId),
    list: () => invoke<JobState[]>('bigenv:installs:list'),
  },
  installed: {
    list: () => invoke<InstallRecord[]>('bigenv:installed:list'),
    use: (sdkId, version) => invoke('bigenv:installed:use', sdkId, version),
    uninstall: (sdkId, version) => invoke('bigenv:installed:uninstall', sdkId, version),
  },
  settings: {
    get: () => invoke<Settings>('bigenv:settings:get'),
    update: (patch) => invoke<Settings>('bigenv:settings:update', patch),
  },
  env: {
    info: () => invoke('bigenv:env:info'),
    enable: () => invoke('bigenv:env:enable'),
    disable: () => invoke('bigenv:env:disable'),
    openTerminal: (dir) => invoke('bigenv:env:openTerminal', dir),
  },
  projects: {
    inspect: (dir) => invoke('bigenv:projects:inspect', dir),
    lock: (dir, versions) => invoke('bigenv:projects:lock', dir, versions),
  },
  system: {
    pickDirectory: () => invoke<string | null>('bigenv:system:pickDirectory'),
    openPath: (target) => invoke('bigenv:system:openPath', target),
    openExternal: (url) => invoke('bigenv:system:openExternal', url),
  },
  health: {
    scan: () => invoke('bigenv:health:scan'),
    clean: (options) => invoke('bigenv:health:clean', options),
  },
  events: {
    onJob: subscribe<JobState>('bigenv:job'),
    onCatalog: subscribe<SdkSummary>('bigenv:catalog'),
    onInstalled: subscribe<null>('bigenv:installed'),
    onSettings: subscribe<Settings>('bigenv:settings'),
  },
  runtime: runtime ?? {
    version: '0.1.0',
    platform: process.platform,
    arch: process.arch,
    dataRoot: '',
    electron: process.versions.electron ?? '',
  },
};

contextBridge.exposeInMainWorld('bigenv', bridge);
