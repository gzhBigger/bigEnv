import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ProxyAgent, fetch as undiciFetch, type Dispatcher } from 'undici';
import { ensureDir, pathExists } from './fsx';
import { createLogger } from './logger';

const log = createLogger('http');

export const USER_AGENT = 'bigEnv/0.1 (+https://github.com/gzh330205/bigEnv)';

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export interface ProgressInfo {
  received: number;
  total: number | null;
  speed: number;
}

export interface DownloadRequest {
  url: string;
  dest: string;
  sha256?: string | null;
  expectedBytes?: number | null;
  signal?: AbortSignal;
  onProgress?: (info: ProgressInfo) => void;
  onPhase?: (phase: 'downloading' | 'verifying') => void;
}

export interface HttpClient {
  readonly proxy: string;
  getText(url: string, init?: { timeoutMs?: number; signal?: AbortSignal }): Promise<string>;
  getJson<T>(url: string, init?: { timeoutMs?: number; signal?: AbortSignal }): Promise<T>;
  download(req: DownloadRequest): Promise<{ bytes: number; skipped: boolean }>;
  dispose(): void;
}

function normalizeProxy(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (/^socks/i.test(value)) {
    log.warn('SOCKS 代理暂不支持，已忽略', { proxy: value });
    return null;
  }
  if (/^https?:\/\//i.test(value)) return value;
  return `http://${value}`;
}

export function createHttpClient(proxyRaw: string): HttpClient {
  const proxy = normalizeProxy(proxyRaw);
  const dispatcher: Dispatcher | undefined = proxy ? new ProxyAgent(proxy) : undefined;
  if (proxy) log.info('using proxy', { proxy });

  async function request(url: string, init: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<Response> {
    const { timeoutMs = 30_000, signal } = init;
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      return (await undiciFetch(url, {
        dispatcher,
        signal: combined,
        redirect: 'follow',
        headers: { 'user-agent': USER_AGENT, accept: '*/*' },
      })) as unknown as Response;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (timeout.aborted) throw new HttpError(`请求超时（${Math.round(timeoutMs / 1000)}s）：${url}`);
      throw new HttpError(`网络请求失败：${message}`);
    }
  }

  async function getText(url: string, init?: { timeoutMs?: number; signal?: AbortSignal }): Promise<string> {
    const res = await request(url, init);
    if (!res.ok) throw new HttpError(`HTTP ${res.status}：${url}`, res.status);
    return await res.text();
  }

  async function getJson<T>(url: string, init?: { timeoutMs?: number; signal?: AbortSignal }): Promise<T> {
    const text = await getText(url, init);
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new HttpError(`返回内容不是合法 JSON：${url}`);
    }
  }

  async function sha256OfFile(file: string): Promise<string> {
    const hash = createHash('sha256');
    await pipeline(fs.createReadStream(file), hash);
    return hash.digest('hex');
  }

  async function download(req: DownloadRequest): Promise<{ bytes: number; skipped: boolean }> {
    const { url, dest, sha256, expectedBytes, signal, onProgress, onPhase } = req;
    await ensureDir(path.dirname(dest));

    if (await pathExists(dest)) {
      const stat = await fsp.stat(dest);
      const sizeOk = !expectedBytes || expectedBytes <= 0 || stat.size === expectedBytes;
      if (sizeOk) {
        if (!sha256) {
          log.info('using cached download', { dest, bytes: stat.size });
          return { bytes: stat.size, skipped: true };
        }
        onPhase?.('verifying');
        const digest = await sha256OfFile(dest);
        if (digest.toLowerCase() === sha256.toLowerCase()) {
          log.info('using cached download (checksum ok)', { dest });
          return { bytes: stat.size, skipped: true };
        }
        log.warn('cached download checksum mismatch, re-downloading', { dest });
        await fsp.rm(dest, { force: true });
      } else {
        await fsp.rm(dest, { force: true });
      }
    }

    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await downloadOnce({ url, dest, sha256, expectedBytes, signal, onProgress, onPhase });
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (signal?.aborted) throw lastError;
        if (err instanceof HttpError && err.status && err.status < 500 && err.status !== 429) throw lastError;
        if (attempt === 3) break;
        const wait = attempt * 1500;
        log.warn(`download failed (attempt ${attempt}), retrying in ${wait}ms`, lastError.message);
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
    }
    throw lastError ?? new Error('下载失败');
  }

  async function downloadOnce(req: DownloadRequest): Promise<{ bytes: number; skipped: boolean }> {
    const { url, dest, sha256, expectedBytes, signal, onProgress, onPhase } = req;
    onPhase?.('downloading');
    const res = await request(url, { timeoutMs: 120_000, signal });
    if (!res.ok) throw new HttpError(`下载失败 HTTP ${res.status}：${url}`, res.status);
    if (!res.body) throw new HttpError(`下载响应为空：${url}`);

    const lengthHeader = res.headers.get('content-length');
    const declared = lengthHeader ? Number(lengthHeader) : NaN;
    const totalBytes = Number.isFinite(declared) && declared > 0 ? declared : expectedBytes && expectedBytes > 0 ? expectedBytes : null;

    const temp = `${dest}.part`;
    await fsp.rm(temp, { force: true });
    const hash = createHash('sha256');
    let received = 0;
    let windowBytes = 0;
    let windowStart = Date.now();
    let speed = 0;

    const source = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
    source.on('data', (chunk: Buffer) => {
      received += chunk.length;
      windowBytes += chunk.length;
      hash.update(chunk);
      const now = Date.now();
      const elapsed = now - windowStart;
      if (elapsed >= 400) {
        speed = (windowBytes / elapsed) * 1000;
        windowBytes = 0;
        windowStart = now;
        onProgress?.({ received, total: totalBytes, speed });
      }
    });

    await pipeline(source, fs.createWriteStream(temp));
    onProgress?.({ received, total: totalBytes ?? received, speed });

    if (totalBytes && received !== totalBytes) {
      await fsp.rm(temp, { force: true });
      throw new HttpError(`下载内容不完整（${received}/${totalBytes} 字节）`);
    }

    const digest = hash.digest('hex');
    if (sha256) {
      onPhase?.('verifying');
      if (digest.toLowerCase() !== sha256.toLowerCase()) {
        await fsp.rm(temp, { force: true });
        throw new HttpError(`SHA-256 校验失败：期望 ${sha256}，实际 ${digest}`);
      }
    }
    await fsp.rename(temp, dest);
    log.info('downloaded', { url, dest, bytes: received });
    return { bytes: received, skipped: false };
  }

  return {
    proxy: proxy ?? '',
    getText,
    getJson,
    download,
    dispose() {
      void dispatcher?.close();
    },
  };
}
