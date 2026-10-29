import { BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron';
import type { Settings, ThemeMode, WindowState } from '../shared/types';
import type { AppRuntime } from './app';
import { createLogger } from './logger';
import { appPaths } from './paths';
import { getSettings, updateSettings } from './store';

const log = createLogger('ipc');

/** The window is frameless, so only the base colour has to follow the palette. */
export function applyWindowChrome(theme: ThemeMode): void {
  const dark = theme === 'dark' || (theme === 'system' && nativeTheme.shouldUseDarkColors);
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.setBackgroundColor(dark ? '#0a0e13' : '#f4f6fa');
  }
}

export function windowStateOf(win: BrowserWindow): WindowState {
  return { maximized: win.isMaximized(), focused: win.isFocused() };
}

/** Push the current maximize/focus state so the custom buttons can redraw. */
export function emitWindowState(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  win.webContents.send('bigenv:window:state', windowStateOf(win));
}

const SDK_PATTERN = /^[\w.+-]+$/;
const VERSION_PATTERN = /^[\w.+. -]+$/;

function assertSdk(value: unknown): string {
  if (typeof value !== 'string' || !SDK_PATTERN.test(value)) throw new Error('非法的 SDK 标识');
  return value;
}

function assertVersion(value: unknown): string {
  if (typeof value !== 'string' || !VERSION_PATTERN.test(value) || value.includes('..')) throw new Error('非法的版本号');
  return value;
}

function assertDir(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error('非法的目录');
  return value;
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

export function registerIpc(runtime: AppRuntime): void {
  runtime.jobs.onChange((job) => broadcast('bigenv:job', job));

  ipcMain.handle('bigenv:catalog:list', async () => await runtime.catalog.summaries());
  ipcMain.handle('bigenv:catalog:versions', async (_event, sdk: unknown) => await runtime.catalog.versions(assertSdk(sdk)));
  ipcMain.handle('bigenv:catalog:refresh', async () => {
    await runtime.refreshCapabilities();
    const summaries = await runtime.catalog.summaries(true);
    for (const summary of summaries) broadcast('bigenv:catalog', summary);
    return summaries.length;
  });

  ipcMain.handle('bigenv:installs:start', async (_event, sdk: unknown, version: unknown) => {
    const job = await runtime.jobs.start(assertSdk(sdk), assertVersion(version));
    return job;
  });
  ipcMain.handle('bigenv:installs:cancel', async (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('非法任务');
    await runtime.jobs.cancel(id);
  });
  ipcMain.handle('bigenv:installs:list', async () => runtime.jobs.list());
  ipcMain.handle('bigenv:installs:clear', async () => {
    runtime.jobs.clear();
  });

  ipcMain.handle('bigenv:installed:list', async () => await runtime.registry.list());
  ipcMain.handle('bigenv:installed:use', async (_event, sdk: unknown, version: unknown) => {
    const target = assertSdk(sdk);
    await runtime.registry.use(target, assertVersion(version));
    runtime.catalog.invalidateVersions(target);
    await runtime.env.refresh();
    broadcast('bigenv:installed', null);
  });
  ipcMain.handle('bigenv:installed:uninstall', async (_event, sdk: unknown, version: unknown) => {
    const target = assertSdk(sdk);
    await runtime.registry.remove(target, assertVersion(version));
    runtime.catalog.invalidateVersions(target);
    await runtime.env.refresh();
    broadcast('bigenv:installed', null);
  });

  ipcMain.handle('bigenv:settings:get', async () => getSettings());
  ipcMain.handle('bigenv:settings:update', async (_event, patch: unknown) => {
    if (!patch || typeof patch !== 'object') throw new Error('非法设置');
    const settings = await runtime.applySettings(patch as Partial<Settings>);
    broadcast('bigenv:settings', settings);
    return settings;
  });

  ipcMain.handle('bigenv:env:info', async () => await runtime.env.info());
  ipcMain.handle('bigenv:env:openTerminal', async (_event, dir: unknown) => {
    const target = typeof dir === 'string' && dir.trim() ? dir : undefined;
    await runtime.env.openTerminal(target);
  });
  ipcMain.handle('bigenv:env:setPathMode', async (_event, mode: unknown) => {
    if (mode !== 'off' && mode !== 'user' && mode !== 'machine') throw new Error('非法的 PATH 模式');
    const previous = getSettings().pathMode;
    // Record the intent before writing: the elevated helper re-reads settings and refuses to
    // act when the mode changed meanwhile, so this is what makes UAC approval meaningful.
    broadcast('bigenv:settings', await updateSettings({ pathMode: mode }));
    try {
      // Leaving machine mode needs elevation too, because HKLM cannot be edited otherwise.
      if (previous === 'machine' && mode !== 'machine') {
        await runtime.applyMachinePathElevated('strip');
      }
      try {
        await runtime.env.setPathMode(mode);
      } catch (error) {
        // HKLM needs real elevation; the click itself is the user's intent, so raise UAC now
        // instead of bouncing a permission error back to the page.
        const message = error instanceof Error ? error.message : String(error);
        if (mode === 'machine' && /管理员权限/.test(message)) {
          await runtime.applyMachinePathElevated('apply');
        } else {
          throw error;
        }
      }
    } catch (error) {
      // Nothing was published: restore both the stored mode and the previous scope.
      broadcast('bigenv:settings', await updateSettings({ pathMode: previous }));
      await runtime.env.setPathMode(previous).catch(() => undefined);
      throw error;
    }
    broadcast('bigenv:settings', await runtime.applySettings({ pathMode: mode }));
    return await runtime.env.info();
  });

  ipcMain.handle('bigenv:env:setPathSdks', async (_event, sdks: unknown) => {
    if (!Array.isArray(sdks)) throw new Error('非法的 SDK 列表');
    const list = [...new Set(sdks.filter((item): item is string => typeof item === 'string').map(assertSdk))];
    const settings = await runtime.applySettings({ pathSdks: list });
    broadcast('bigenv:settings', settings);
    return await runtime.env.info();
  });

  const readVersions = (versions: unknown): Record<string, string> => {
    if (!versions || typeof versions !== 'object') throw new Error('非法的版本集合');
    const map: Record<string, string> = {};
    for (const [sdk, version] of Object.entries(versions as Record<string, unknown>)) {
      if (typeof version !== 'string' || !version) continue;
      map[assertSdk(sdk)] = assertVersion(version);
    }
    return map;
  };

  ipcMain.handle('bigenv:projects:list', async () => await runtime.listProjects());
  ipcMain.handle('bigenv:projects:add', async (_event, dir: unknown) => {
    const list = await runtime.addProject(assertDir(dir));
    broadcast('bigenv:settings', getSettings());
    return list;
  });
  ipcMain.handle('bigenv:projects:remove', async (_event, dir: unknown) => {
    const list = await runtime.removeProject(assertDir(dir));
    broadcast('bigenv:settings', getSettings());
    return list;
  });
  ipcMain.handle('bigenv:projects:inspect', async (_event, dir: unknown) => await runtime.projects.inspect(assertDir(dir)));
  ipcMain.handle('bigenv:projects:save', async (_event, dir: unknown, versions: unknown) => {
    const info = await runtime.projects.save(assertDir(dir), readVersions(versions));
    return info;
  });
  ipcMain.handle('bigenv:projects:openTerminal', async (_event, dir: unknown) => {
    const target = assertDir(dir);
    const info = await runtime.projects.inspect(target);
    const overrides = new Map<string, string>(Object.entries(info.versions));
    await runtime.env.openTerminal(target, overrides);
  });

  ipcMain.handle('bigenv:system:pickDirectory', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle('bigenv:system:openPath', async (_event, target: unknown) => {
    const dir = assertDir(target);
    const error = await shell.openPath(dir);
    if (error) throw new Error(error);
  });
  ipcMain.handle('bigenv:system:openExternal', async (_event, url: unknown) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) throw new Error('仅支持 http/https 链接');
    await shell.openExternal(url);
  });
  ipcMain.handle('bigenv:system:theme', async (_event, theme: unknown) => {
    if (theme !== 'system' && theme !== 'light' && theme !== 'dark') throw new Error('非法的主题');
    applyWindowChrome(theme);
  });
  // `system` mode must follow the OS live, not only when the user toggles the switch.
  nativeTheme.on('updated', () => {
    if (getSettings().theme === 'system') applyWindowChrome('system');
  });

  ipcMain.on('bigenv:window:control', (event, action: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    if (action === 'minimize') win.minimize();
    else if (action === 'toggle-maximize') {
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
    } else if (action === 'close') win.close();
  });
  ipcMain.on('bigenv:window:state:sync', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    event.returnValue = win ? windowStateOf(win) : { maximized: false, focused: false };
  });

  ipcMain.handle('bigenv:updates:check', async (_event, force: unknown) => await runtime.updates.check(force === true));
  ipcMain.handle('bigenv:updates:download', async () => (await runtime.updates.download()).path);
  ipcMain.handle('bigenv:updates:openPage', async () => await runtime.updates.openPage());

  ipcMain.handle('bigenv:health:scan', async () => await runtime.health.scan());
  ipcMain.handle('bigenv:health:clean', async (_event, options: unknown) => {
    const opts = (options ?? {}) as { cache?: boolean; orphans?: boolean };
    const report = await runtime.health.clean({ cache: opts.cache === true, orphans: opts.orphans === true });
    broadcast('bigenv:installed', null);
    return report;
  });

  ipcMain.on('bigenv:runtime:sync', (event) => {
    event.returnValue = {
      version: process.env.npm_package_version ?? '0.1.0',
      platform: process.platform,
      arch: process.arch,
      dataRoot: appPaths().dataRoot,
      electron: process.versions.electron ?? '',
    };
  });

  ipcMain.handle('bigenv:runtime:info', async () => ({
    version: process.env.npm_package_version ?? '0.1.0',
    platform: process.platform,
    arch: process.arch,
    dataRoot: appPaths().dataRoot,
    electron: process.versions.electron ?? '',
  }));

  log.info('ipc handlers registered');
}
