/**
 * Evaluate an expression inside the running Electron renderer and print the JSON result.
 *
 * Usage:
 *   npx electron . --remote-debugging-port=9333     # in another shell
 *   node scripts/eval.mjs "await window.bigenv.installed.list()"
 */
const expression = process.argv[2];
const port = process.argv[3] ?? '9333';

if (!expression) {
  console.error('usage: node scripts/eval.mjs "<expression>" [port]');
  process.exit(1);
}

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

await send('Runtime.enable');
const evaluated = await send('Runtime.evaluate', {
  expression: `(async () => { ${expression} })()`,
  awaitPromise: true,
  returnByValue: true,
});

if (evaluated.result?.exceptionDetails) {
  console.error('error:', JSON.stringify(evaluated.result.exceptionDetails, null, 2));
  process.exit(2);
}
console.log(JSON.stringify(evaluated.result?.result?.value ?? null, null, 2));
socket.close();
