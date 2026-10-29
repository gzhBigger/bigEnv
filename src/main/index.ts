import { app, BrowserWindow, session, shell } from 'electron';
import path from 'node:path';
import { AppRuntime } from './app';
import { registerIpc } from './ipc';
import { createLogger } from './logger';

const log = createLogger('main');
const isDev = !app.isPackaged;
let runtime: AppRuntime | null = null;
let mainWindow: BrowserWindow | null = null;

app.setName('bigEnv');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  void bootstrap();
}

async function bootstrap(): Promise<void> {
  await app.whenReady();

  try {
    runtime = await AppRuntime.create();
    registerIpc(runtime);
  } catch (error) {
    log.error('runtime bootstrap failed', error);
  }

  createWindow();

  if (!isDev) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src 'self'; connect-src 'self'",
          ],
        },
      });
    });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    backgroundColor: '#0b0f14',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0b0f14', symbolColor: '#c8d4e4', height: 44 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    void mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    void mainWindow.loadFile(path.join(app.getAppPath(), 'out', 'renderer', 'index.html'));
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  void runtime?.dispose();
});

process.on('uncaughtException', (error) => log.error('uncaught exception', error));
process.on('unhandledRejection', (reason) => log.error('unhandled rejection', reason));

if (isDev) log.info('starting in development mode');
