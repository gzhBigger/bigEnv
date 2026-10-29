import { app, shell } from 'electron';
import path from 'node:path';
import type { UpdateInfo } from '../shared/types';
import { HttpError, type HttpClient } from './http';
import { createLogger } from './logger';
import { appPaths } from './paths';
import { ensureDir, readJson, writeJsonAtomic } from './fsx';

const log = createLogger('updates');

/** The project itself, not the metadata mirror. */
// The account was renamed upstream; GitHub still redirects the old slug.
export const REPO = 'gzhBigger/bigEnv';
const RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const PACKAGE_RAW = `https://raw.githubusercontent.com/${REPO}/main/package.json`;
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;
const CACHE_FILE = 'update-check.json';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

interface GithubRelease {
  tag_name?: string;
  name?: string;
  body?: string;
  html_url?: string;
  published_at?: string;
  assets?: { name?: string; browser_download_url?: string; size?: number }[];
}

function parseVersion(raw: string): number[] {
  const match = raw.trim().replace(/^v/i, '').match(/\d+(?:\.\d+)*/);
  if (!match) return [];
  return match[0].split('.').map((part) => Number(part));
}

/** Numeric segment compare; missing segments count as zero, so 1.2 == 1.2.0. */
export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

interface CacheShape {
  checkedAt?: string;
  info?: UpdateInfo;
}

export class UpdateService {
  private info: UpdateInfo | null = null;

  constructor(private client: HttpClient) {}

  setClient(client: HttpClient): void {
    this.client = client;
  }

  current(): UpdateInfo | null {
    return this.info;
  }

  private async readCache(): Promise<UpdateInfo | null> {
    try {
      const file = path.join(appPaths().dataRoot, CACHE_FILE);
      const cached = await readJson<CacheShape>(file);
      if (!cached?.info || !cached.checkedAt) return null;
      if (Date.now() - Date.parse(cached.checkedAt) > CACHE_TTL_MS) return null;
      return cached.info;
    } catch {
      return null;
    }
  }

  private async writeCache(info: UpdateInfo): Promise<void> {
    try {
      await ensureDir(appPaths().dataRoot);
      await writeJsonAtomic(path.join(appPaths().dataRoot, CACHE_FILE), { checkedAt: info.checkedAt, info });
    } catch {
      /* a failed cache write must not break the check */
    }
  }

  /** Uses the cached answer unless `force`, so opening Settings is not a network call. */
  async check(force = false): Promise<UpdateInfo> {
    if (!force) {
      this.info ??= await this.readCache();
      if (this.info) return this.info;
    }
    const current = app.getVersion();
    const base: UpdateInfo = {
      current,
      latest: null,
      status: 'unknown',
      available: false,
      notes: null,
      pageUrl: RELEASES_PAGE,
      setupUrl: null,
      portableUrl: null,
      checkedAt: new Date().toISOString(),
    };

    let info: UpdateInfo;
    try {
      const release = await this.client.getJson<GithubRelease>(RELEASE_API, { timeoutMs: 15_000 });
      const latest = release.tag_name ?? release.name ?? null;
      const setup = release.assets?.find((asset) => /setup|installer/i.test(asset.name ?? ''));
      const portable = release.assets?.find((asset) => /portable|bigEnv.*\.exe$/i.test(asset.name ?? '') && !/setup|installer/i.test(asset.name ?? ''));
      info = {
        ...base,
        latest,
        status: latest ? (compareVersions(latest, current) > 0 ? 'available' : 'latest') : 'none',
        available: latest ? compareVersions(latest, current) > 0 : false,
        notes: release.body?.trim() ? release.body.trim().slice(0, 4000) : null,
        pageUrl: release.html_url ?? RELEASES_PAGE,
        setupUrl: setup?.browser_download_url ?? null,
        portableUrl: portable?.browser_download_url ?? null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // 403 is GitHub rate limiting, 404 means "no release yet". The HTML page has
      // neither limit, so scrape it before giving up on release information.
      log.warn('release api unavailable', { message });
      const scraped = await this.scrapeRelease();
      if (scraped === 'none') {
        info = { ...base, status: 'none' };
      } else if (scraped && typeof scraped === 'object') {
        info = { ...base, ...scraped };
      } else {
        try {
          const pkg = await this.client.getJson<{ version?: string }>(PACKAGE_RAW, { timeoutMs: 15_000 });
          const latest = pkg.version ?? null;
          info = {
            ...base,
            latest,
            status: latest ? (compareVersions(latest, current) > 0 ? 'available' : 'latest') : 'none',
            available: latest ? compareVersions(latest, current) > 0 : false,
          };
        } catch {
          info = {
            ...base,
            status: 'error',
            error: '暂时读不到发布信息（GitHub 限制了未登录请求，或仓库还没有 Release）。可以点“打开发布页”手动查看。',
          };
        }
      }
    }

    this.info = info;
    if (info.status !== 'error') await this.writeCache(info);
    return info;
  }

  /** Release pages are plain HTML; the tag and asset links are enough for a prompt. */
  private async scrapeRelease(): Promise<Partial<UpdateInfo> | 'none' | null> {
    try {
      const html = await this.client.getText(RELEASES_PAGE, { timeoutMs: 15_000 });
      const tagMatch = html.match(/href="\/[^"/]+\/[^"/]+\/releases\/tag\/([^"?#]+)"/);
      // GitHub serves the plain releases page when nothing has been published.
      if (!tagMatch) return /There aren[\u2019']?t any releases/i.test(html) ? 'none' : null;
      const latest = decodeURIComponent(tagMatch[1]);
      const pageUrl = `https://github.com/${REPO}/releases/tag/${encodeURIComponent(latest)}`;
      let setupUrl: string | null = null;
      let portableUrl: string | null = null;
      try {
        const assets = await this.client.getText(
          `https://github.com/${REPO}/releases/expanded_assets/${encodeURIComponent(latest)}`,
          { timeoutMs: 15_000 },
        );
        for (const match of assets.matchAll(/href="(\/[^"]*\/releases\/download\/[^"]+)"/g)) {
          const url = `https://github.com${match[1]}`;
          const name = decodeURIComponent(url.split('/').pop() ?? '');
          if (/setup|installer/i.test(name)) setupUrl ??= url;
          else if (/\.exe$/i.test(name)) portableUrl ??= url;
        }
      } catch {
        /* assets are optional; the page link still works */
      }
      return {
        latest,
        status: compareVersions(latest, app.getVersion()) > 0 ? 'available' : 'latest',
        available: compareVersions(latest, app.getVersion()) > 0,
        pageUrl,
        setupUrl,
        portableUrl,
      };
    } catch (error) {
      // A 404 release page simply means the project has not published anything yet.
      if (error instanceof HttpError && error.status === 404) return 'none';
      return null;
    }
  }

  /** Downloads the installer next to the cache and hands the path back for opening. */
  async download(): Promise<{ path: string }> {
    const info = this.info ?? (await this.check());
    const url = info.setupUrl ?? info.portableUrl;
    if (!url) throw new Error('这个版本没有提供可直接下载的安装包，请打开下载页手动选择');
    const fileName = decodeURIComponent(url.split('/').pop() ?? 'bigEnv-setup.exe').split('?')[0];
    const dest = path.join(appPaths().downloadDir, fileName);
    await ensureDir(appPaths().downloadDir);
    log.info('downloading update', { url, dest });
    await this.client.download({ url, dest });
    return { path: dest };
  }

  async openPage(): Promise<void> {
    const info = this.info ?? (await this.check());
    await shell.openExternal(info.pageUrl);
  }
}
