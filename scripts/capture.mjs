/**
 * Capture a PNG screenshot of the running Electron renderer through the DevTools protocol.
 *
 * Usage:
 *   npx electron . --remote-debugging-port=9333     # in another shell
 *   node scripts/capture.mjs [outfile] [port] [--eval "<js>"]
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const evalIndex = args.indexOf('--eval');
const expression = evalIndex >= 0 ? args[evalIndex + 1] : null;
if (evalIndex >= 0) args.splice(evalIndex, 2);

const outFile = args[0] ?? 'screenshot.png';
const port = args[1] ?? '9333';

const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = targets.find((item) => item.type === 'page');
if (!target) {
  console.error('no page target found; is Electron running with --remote-debugging-port?');
  process.exit(1);
}

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let nextId = 0;
const pending = new Map();
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  const resolver = message.id ? pending.get(message.id) : undefined;
  if (resolver) {
    pending.delete(message.id);
    resolver(message);
  }
});

function send(method, params = {}) {
  const id = ++nextId;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve) => pending.set(id, resolve));
}

await send('Page.enable');
await send('Runtime.enable');

if (expression) {
  const evaluated = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (evaluated.result?.exceptionDetails) {
    console.error('eval failed', JSON.stringify(evaluated.result.exceptionDetails));
  }
  await new Promise((resolve) => setTimeout(resolve, 700));
}

const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
if (!result.result?.data) {
  console.error('capture failed', JSON.stringify(result));
  process.exit(1);
}
const absolute = path.resolve(outFile);
await fs.mkdir(path.dirname(absolute), { recursive: true });
await fs.writeFile(absolute, Buffer.from(result.result.data, 'base64'));
console.log(`saved ${absolute}`);
socket.close();
