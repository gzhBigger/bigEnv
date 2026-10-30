import { contextBridge, ipcRenderer } from 'electron';
import type {
  Bridge,
  InstallRecord,
  JobState,
  McpStatus,
  ProjectInfo,
  Settings,
  SdkSummary,
  WindowState,
} from '../shared/types';

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
    clear: () => invoke('bigenv:installs:clear'),
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
    openTerminal: (dir) => invoke('bigenv:env:openTerminal', dir),
    setPathMode: (mode) => invoke('bigenv:env:setPathMode', mode),
    setPathSdks: (sdks) => invoke('bigenv:env:setPathSdks', sdks),
  },
  projects: {
    list: () => invoke<ProjectInfo[]>('bigenv:projects:list'),
    add: (dir) => invoke<ProjectInfo[]>('bigenv:projects:add', dir),
    remove: (dir) => invoke<ProjectInfo[]>('bigenv:projects:remove', dir),
    inspect: (dir) => invoke<ProjectInfo>('bigenv:projects:inspect', dir),
    save: (dir, versions) => invoke<ProjectInfo>('bigenv:projects:save', dir, versions),
    openTerminal: (dir) => invoke('bigenv:projects:openTerminal', dir),
  },
  system: {
    pickDirectory: () => invoke<string | null>('bigenv:system:pickDirectory'),
    openPath: (target) => invoke('bigenv:system:openPath', target),
    openExternal: (url) => invoke('bigenv:system:openExternal', url),
    applyTheme: (theme) => invoke('bigenv:system:theme', theme),
  },
  window: {
    minimize: () => ipcRenderer.send('bigenv:window:control', 'minimize'),
    toggleMaximize: () => ipcRenderer.send('bigenv:window:control', 'toggle-maximize'),
    close: () => ipcRenderer.send('bigenv:window:control', 'close'),
    state: () => ipcRenderer.sendSync('bigenv:window:state:sync') as WindowState,
    onState: subscribe<WindowState>('bigenv:window:state'),
  },
  updates: {
    check: (force) => invoke('bigenv:updates:check', force === true),
    download: () => invoke<string>('bigenv:updates:download'),
    openPage: () => invoke('bigenv:updates:openPage'),
  },
  mcp: {
    status: () => invoke<McpStatus>('bigenv:mcp:status'),
    setEnabled: (enabled) => invoke<McpStatus>('bigenv:mcp:setEnabled', enabled),
    setPort: (port) => invoke<McpStatus>('bigenv:mcp:setPort', port),
    rotateToken: () => invoke<McpStatus>('bigenv:mcp:rotateToken'),
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
