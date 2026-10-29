import type { Settings } from '../shared/types';
import { CatalogService, detectCapabilities, type Capabilities } from './catalog';
import { EnvManager } from './envManager';
import { HealthService } from './health';
import { createHttpClient, type HttpClient } from './http';
import { JobQueue } from './jobs';
import { initLogger } from './logger';
import { appPaths } from './paths';
import { ProjectService } from './projects';
import { Registry } from './registry';
import { getSettings, loadSettings, updateSettings } from './store';
import { MetadataService } from './versions';

export class AppRuntime {
  readonly registry = new Registry(() => getSettings().installRoot);
  readonly env: EnvManager;
  readonly projects: ProjectService;
  readonly health: HealthService;
  readonly jobs: JobQueue;
  readonly catalog: CatalogService;
  readonly metadata: MetadataService;

  private http: HttpClient;
  private caps: Capabilities;

  private constructor(caps: Capabilities) {
    const settings = getSettings();
    this.caps = caps;
    this.http = createHttpClient(settings.proxy);
    this.metadata = new MetadataService(this.http, settings.metaBase, appPaths().metaDir);
    this.catalog = new CatalogService(this.metadata, caps);
    this.env = new EnvManager(this.registry, getSettings);
    this.projects = new ProjectService(this.registry);
    this.health = new HealthService(this.registry, getSettings, () => ({
      downloadDir: appPaths().downloadDir,
      tempDir: appPaths().tempDir,
    }));
    this.jobs = new JobQueue({
      registry: this.registry,
      catalog: this.catalog,
      getSettings,
      getPaths: () => ({ downloadDir: appPaths().downloadDir, tempDir: appPaths().tempDir }),
      onInstalledChange: async () => {
        this.registry.invalidate();
        await this.registry.scan();
        await this.env.refresh();
      },
    });
    this.catalog.setInstalledProvider(async () => await this.installedSnapshot());
  }

  private async installedSnapshot(): Promise<Map<string, { versions: Set<string>; current: string | null }>> {
    const index = await this.registry.index();
    const map = new Map<string, { versions: Set<string>; current: string | null }>();
    for (const [sdk, records] of index.bySdk) {
      map.set(sdk, { versions: new Set(records.map((record) => record.version)), current: index.current.get(sdk) ?? null });
    }
    return map;
  }

  static async create(): Promise<AppRuntime> {
    await loadSettings();
    initLogger(appPaths().logDir);
    const caps = await detectCapabilities();
    const runtime = new AppRuntime(caps);
    await runtime.registry.scan();
    await runtime.env.refresh();
    return runtime;
  }

  get capabilities(): Capabilities {
    return this.caps;
  }

  async refreshCapabilities(): Promise<void> {
    this.caps = await detectCapabilities();
    this.catalog.setCapabilities(this.caps);
    this.catalog.setInstalledProvider(async () => await this.installedSnapshot());
  }

  async applySettings(patch: Partial<Settings>): Promise<Settings> {
    const previous = getSettings();
    const next = await updateSettings(patch);
    if (previous.metaBase !== next.metaBase || previous.proxy !== next.proxy) {
      this.http.dispose();
      this.http = createHttpClient(next.proxy);
      this.metadata.setSource(this.http, next.metaBase, appPaths().metaDir);
      this.catalog.setCapabilities(this.caps);
    }
    if (previous.installRoot !== next.installRoot) {
      this.registry.invalidate();
      await this.registry.scan();
    }
    if (previous.shellEnabled && !next.shellEnabled) {
      await this.env.disable();
    }
    if (previous.pathMode !== next.pathMode && next.pathMode === 'off') {
      await this.env.setPathMode('off');
    }
    await this.env.refresh();
    return next;
  }

  async dispose(): Promise<void> {
    this.http.dispose();
  }
}
