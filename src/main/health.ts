import fs from 'node:fs/promises';
import path from 'node:path';
import type { HealthInstall, HealthReport, Settings } from '../shared/types';
import { dirSize, pathExists, readLinkTarget, removeDir } from './fsx';
import { createLogger } from './logger';
import { META_FILE, type Registry } from './registry';

const log = createLogger('health');

export class HealthService {
  constructor(
    private readonly registry: Registry,
    private readonly getSettings: () => Settings,
    private readonly paths: () => { downloadDir: string; tempDir: string },
  ) {}

  async scan(): Promise<HealthReport> {
    await this.registry.scan();
    const records = await this.registry.list();
    const installs: HealthInstall[] = records.map((record) => ({
      sdk: record.sdk,
      version: record.version,
      sizeBytes: record.sizeBytes,
      installedAt: record.installedAt,
      orphan: !record.managed,
    }));

    const root = this.getSettings().installRoot;
    const orphans: HealthReport['orphans'] = [];
    const brokenCurrentLinks: string[] = [];

    if (await pathExists(root)) {
      const sdkEntries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
      for (const sdkEntry of sdkEntries) {
        if (!sdkEntry.isDirectory() || sdkEntry.name.startsWith('.')) continue;
        const sdkPath = path.join(root, sdkEntry.name);
        const currentPath = path.join(sdkPath, 'current');
        const linkTarget = await readLinkTarget(currentPath);
        if (linkTarget) {
          const targetExists = await pathExists(linkTarget);
          if (!targetExists) brokenCurrentLinks.push(sdkEntry.name);
        }
        const versionEntries = await fs.readdir(sdkPath, { withFileTypes: true }).catch(() => []);
        for (const versionEntry of versionEntries) {
          if (!versionEntry.isDirectory() || versionEntry.name === 'current') continue;
          const dir = path.join(sdkPath, versionEntry.name);
          const meta = await pathExists(path.join(dir, META_FILE));
          if (!meta) {
            const size = await dirSize(dir);
            orphans.push({ sdk: sdkEntry.name, version: versionEntry.name, path: dir, sizeBytes: size });
          }
        }
      }
    }

    const { downloadDir, tempDir } = this.paths();
    const cacheBytes = (await dirSize(downloadDir)) + (await dirSize(tempDir));
    const totalBytes = installs.reduce((sum, item) => sum + item.sizeBytes, 0);
    log.info('health scan', { installs: installs.length, orphans: orphans.length, cacheBytes });
    return { installRoot: root, totalBytes, cacheBytes, installs, orphans, brokenCurrentLinks };
  }

  async clean(options: { cache?: boolean; orphans?: boolean }): Promise<HealthReport> {
    if (options.cache) {
      const { downloadDir, tempDir } = this.paths();
      for (const dir of [downloadDir, tempDir]) {
        const entries = await fs.readdir(dir).catch(() => []);
        for (const entry of entries) await removeDir(path.join(dir, entry));
      }
      log.info('cache cleaned');
    }
    if (options.orphans) {
      const report = await this.scan();
      for (const orphan of report.orphans) await removeDir(orphan.path);
      log.info('orphans removed', { count: report.orphans.length });
    }
    return await this.scan();
  }
}
