import { spawn } from 'node:child_process';
import { Socket } from 'node:net';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const root = fileURLToPath(new URL('..', import.meta.url));
const DEV_PORT = 5199;
const children = [];

function run(cmd, args, extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  // Some shells preset ELECTRON_RUN_AS_NODE; with it set, Electron boots as plain Node and the
  // main process crashes on `app.isPackaged`. Always clear it for the spawned children.
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(cmd, args, {
    cwd: root,
    shell: process.platform === 'win32',
    stdio: 'inherit',
    env,
  });
  children.push(child);
  child.on('exit', (code) => {
    if (code) {
      console.error(`[dev] ${cmd} exited with code ${code}`);
      shutdown(code);
    }
  });
  return child;
}

function shutdown(code = 0) {
  for (const child of children) {
    if (!child.killed) {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
    }
  }
  process.exit(code);
}

const probe = (port) =>
  new Promise((resolve) => {
    const socket = new Socket();
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, '127.0.0.1');
  });

async function waitForVite() {
  const start = Date.now();
  while (Date.now() - start < 60_000) {
    if (await probe(DEV_PORT)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('vite dev server did not start');
}

run('npx', ['vite', '--port', String(DEV_PORT), '--strictPort']);
run('node', ['scripts/build-main.mjs', '--watch']);

await waitForVite();
run('npx', ['electron', '.'], {
  VITE_DEV_SERVER_URL: `http://localhost:${DEV_PORT}`,
  NODE_ENV: 'development',
});

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
