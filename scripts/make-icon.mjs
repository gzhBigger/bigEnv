// 生成应用图标：用无边框透明窗口渲染一张 512×512 的品牌图，
// 再用 nativeImage 缩放出多尺寸 PNG，最后打包成 Windows 需要的 ICO。
// 用法：npx electron scripts/make-icon.mjs
import { app, BrowserWindow, nativeImage } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT_DIR = path.join(ROOT, 'build');
const SIZES = [256, 128, 64, 48, 32, 16];

const HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: 512px; height: 512px; background: transparent; overflow: hidden; }
  .tile {
    width: 512px; height: 512px; border-radius: 112px;
    background: linear-gradient(150deg, #17222e 0%, #0a0f15 100%);
    box-shadow: inset 0 0 0 8px rgba(76, 154, 255, 0.35);
    display: flex; align-items: center; justify-content: center; position: relative;
  }
  .glyph {
    font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
    font-weight: 700; font-size: 330px; line-height: 1;
    background: linear-gradient(150deg, #6db3ff 10%, #35d0a5 90%);
    -webkit-background-clip: text; background-clip: text; color: transparent;
    transform: translateY(-14px);
  }
  .dot {
    position: absolute; right: 96px; bottom: 100px;
    width: 54px; height: 54px; border-radius: 50%; background: #35d0a5;
  }
</style></head><body><div class="tile"><div class="glyph">b</div><div class="dot"></div></div></body></html>`;

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

async function main() {
  await app.whenReady();
  const win = new BrowserWindow({
    width: 512,
    height: 512,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: true },
  });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(HTML));
  await new Promise((resolve) => setTimeout(resolve, 400));

  const shot = await win.webContents.capturePage();
  const master = shot.getSize().width >= 512 ? shot : shot.resize({ width: 512, height: 512 });
  const masterPng = master.toPNG();

  const images = [];
  for (const size of SIZES) {
    const resized = size === 512 ? master : master.resize({ width: size, height: size, quality: 'best' });
    images.push({ size, png: resized.toPNG() });
  }

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(path.join(OUT_DIR, 'icon.png'), masterPng);
  await writeFile(path.join(OUT_DIR, 'icon.ico'), buildIco(images));
  console.log(`[make-icon] wrote build/icon.png (${masterPng.length} bytes) and build/icon.ico (${images.length} sizes)`);
  win.destroy();
  app.quit();
}

main().catch((err) => {
  console.error('[make-icon] failed', err);
  app.exit(1);
});
