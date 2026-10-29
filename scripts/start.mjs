/**
 * Launch the built app with Electron, clearing ELECTRON_RUN_AS_NODE so it is not run as plain Node.
 * Build first: `npm run build`.
 */
import { spawn } from 'node:child_process';
import process from 'node:process';

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn('npx', ['electron', '.'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env,
});

child.on('exit', (code) => process.exit(code ?? 0));
