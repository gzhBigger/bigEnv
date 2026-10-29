// 生成品牌资源：
//   build/icon.png / build/icon.ico —— 应用图标（Windows 打包用）
//   build/logo.png               —— 横向品牌组合（README / 发布说明用）
// 用无边框透明窗口渲染内联 HTML 与 SVG，再交给 nativeImage 缩放。
// 用法：npx electron scripts/make-icon.mjs
import { app, BrowserWindow, nativeImage } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT_DIR = path.join(ROOT, 'build');
const SIZES = [256, 128, 64, 48, 32, 16];

const HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: 512px; height: 512px; background: transparent; overflow: hidden; }
  .tile {
    width: 512px; height: 512px; border-radius: 116px;
    background: linear-gradient(135deg, #1a2634 0%, #080d13 100%);
    position: relative;
  }
  .ring { position: absolute; inset: 14px; border-radius: 104px; border: 8px solid rgba(76,154,255,.32); }
  .bar { position: absolute; left: 112px; height: 58px; border-radius: 29px; }
  .b1 { top: 150px; width: 288px; background: linear-gradient(90deg, #8ec6ff, #4c9aff); }
  .b2 { top: 232px; width: 232px; background: linear-gradient(90deg, #5fb2ff, #3f8fe8); }
  .b3 { top: 314px; width: 168px; background: linear-gradient(90deg, #35d0a5, #17a97f); }
  .dot { position: absolute; left: 327px; top: 314px; width: 58px; height: 58px; border-radius: 50%; background: #35d0a5; }
  .dot::after { content: ''; position: absolute; left: 16px; top: 16px; width: 26px; height: 26px; border-radius: 50%; background: #08111a; }
</style></head><body><div class="tile"><div class="ring"></div>
  <div class="bar b1"></div><div class="bar b2"></div><div class="bar b3"></div><div class="dot"></div>
</div></body></html>`;

/** 把若干张 PNG 打包成 ICO（Vista+ 支持 PNG 压缩条目）。 */
export function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries = [];
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

async function render({ width, height, url, settle = 400 }) {
  const win = new BrowserWindow({
    width,
    height,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: true },
  });
  await win.loadURL(url);
  await new Promise((resolve) => setTimeout(resolve, settle));
  const shot = await win.webContents.capturePage();
  win.destroy();
  return shot;
}

app.on('window-all-closed', () => {
  // 默认行为是关掉最后一个窗口就退出；这里要在多张渲染之间保持进程存活。
});

async function main() {
  await app.whenReady();
  await mkdir(OUT_DIR, { recursive: true });

  const tile = await render({ width: 512, height: 512, url: 'data:text/html;charset=utf-8,' + encodeURIComponent(HTML) });
  const master = tile.getSize().width >= 512 ? tile : tile.resize({ width: 512, height: 512 });
  const masterPng = master.toPNG();

  const images = [];
  for (const size of SIZES) {
    const resized = size === 512 ? master : master.resize({ width: size, height: size, quality: 'best' });
    images.push({ size, png: resized.toPNG() });
  }

  await writeFile(path.join(OUT_DIR, 'icon.png'), masterPng);
  writeFileSync(path.join(OUT_DIR, 'icon.ico'), buildIco(images));

  try {
    const logo = await render({
      width: 760,
      height: 200,
      url: pathToFileURL(path.join(OUT_DIR, 'logo.svg')).toString(),
      settle: 700,
    });
    const logo2x = logo.resize({ width: 1520, height: 400, quality: 'best' });
    const logoPng = logo2x.toPNG();
    writeFileSync(path.join(OUT_DIR, 'logo.png'), logoPng);

    const mark = await render({
      width: 512,
      height: 512,
      url: pathToFileURL(path.join(OUT_DIR, 'logo-mark.svg')).toString(),
      settle: 700,
    });
    writeFileSync(path.join(OUT_DIR, 'logo-mark.png'), mark.toPNG());

    console.log(`[make-icon] icon.png ${masterPng.length}B, icon.ico ${images.length} sizes, logo.png ${logoPng.length}B`);
  } catch (err) {
    writeFileSync(path.join(OUT_DIR, 'logo-error.txt'), `${err?.stack ?? err}\n`, 'utf8');
    console.log(`[make-icon] icon.png ${masterPng.length}B, icon.ico ${images.length} sizes; logo render failed`);
  }
  app.quit();
}

main().catch(async (err) => {
  await writeFile(path.join(OUT_DIR, 'icon-error.txt'), `${err?.stack ?? err}\n`, 'utf8').catch(() => undefined);
  console.error('[make-icon] failed', err);
  app.exit(1);
});


