import type { PathMode, ProjectInfo, Settings, ShellInfo } from '../shared/types';
import { app } from 'electron';
import { spawn } from 'node:child_process';
import { CatalogService, detectCapabilities, type Capabilities } from './catalog';
import { ELEVATION_FLAG } from './elevated';
import { EnvManager } from './envManager';
import { HealthService } from './health';
import { createHttpClient, type HttpClient } from './http';
import { JobQueue } from './jobs';
import { initLogger } from './logger';
import { McpService } from './mcp';
import { appPaths } from './paths';
import { ProjectService } from './projects';
import { Registry } from './registry';
import { UpdateService } from './updates';
import { getSettings, hasExplicitPathSdks, loadSettings, updateSettings } from './store';
import { mapLimit } from './util';
import { MetadataService } from './versions';
import fs from 'node:fs/promises';
import path from 'node:path';

export class AppRuntime {
  readonly registry = new Registry(() => getSettings().installRoot);
  readonly env: EnvManager;
  readonly projects: ProjectService;
  readonly health: HealthService;
  readonly jobs: JobQueue;
  readonly catalog: CatalogService;
  readonly metadata: MetadataService;
  readonly updates: UpdateService;
  readonly mcp: McpService;

  private http: HttpClient;
  private caps: Capabilities;

  private constructor(caps: Capabilities) {
    const settings = getSettings();
    this.caps = caps;
    this.http = createHttpClient(settings.proxy);
    this.metadata = new MetadataService(this.http, settings.metaBase, appPaths().metaDir);
    this.catalog = new CatalogService(this.metadata, caps);
    this.updates = new UpdateService(this.http);
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
        this.catalog.invalidateVersions();
        await this.env.refresh();
      },
    });
    this.catalog.setInstalledProvider(async () => await this.installedSnapshot());
    this.mcp = new McpService(this, app.getVersion());
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
    if (!hasExplicitPathSdks()) {
      // Settings from before per-SDK PATH selection: keep the old behaviour by publishing every active runtime.
      const index = await runtime.registry.index();
      const active = [...index.current.keys()];
      if (active.length > 0) await updateSettings({ pathSdks: active });
    }
    await runtime.env.refresh();
    // Users upgrading from the profile-injection era: drop env.ps1/env.cmd/env.sh and the
    // marker block in their PowerShell profile, since global PATH replaced that mechanism.
    await runtime.env.cleanupLegacyInjection().catch((err: unknown) => {
      console.warn('[app] legacy shell cleanup failed', err instanceof Error ? err.message : String(err));
    });
    if (getSettings().mcpEnabled) await runtime.mcp.start();
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

  async listProjects(): Promise<ProjectInfo[]> {
    const dirs = getSettings().projects;
    if (dirs.length === 0) return [];
    const inspected = await mapLimit(dirs, 6, async (dir) => {
      try {
        return await this.projects.inspect(dir);
      } catch {
        return null;
      }
    });
    return inspected.filter((item): item is ProjectInfo => item !== null);
  }

  async addProject(dirInput: string): Promise<ProjectInfo[]> {
    const dir = path.resolve(dirInput);
    const stat = await fs.stat(dir).catch(() => null);
    if (!stat || !stat.isDirectory()) throw new Error('目录不存在或不是文件夹');
    const current = getSettings().projects;
    if (!current.some((item) => item.toLowerCase() === dir.toLowerCase())) {
      await updateSettings({ projects: [...current, dir] });
    }
    return await this.listProjects();
  }

  async removeProject(dirInput: string): Promise<ProjectInfo[]> {
    const dir = path.resolve(dirInput);
    const current = getSettings().projects;
    const next = current.filter((item) => item.toLowerCase() !== dir.toLowerCase());
    if (next.length !== current.length) await updateSettings({ projects: next });
    return await this.listProjects();
  }

  async applySettings(patch: Partial<Settings>): Promise<Settings> {
    const previous = getSettings();
    const next = await updateSettings(patch);
    if (previous.metaBase !== next.metaBase || previous.proxy !== next.proxy) {
      this.http.dispose();
      this.http = createHttpClient(next.proxy);
      this.metadata.setSource(this.http, next.metaBase, appPaths().metaDir);
      this.updates.setClient(this.http);
      this.catalog.setCapabilities(this.caps);
    }
    if (previous.installRoot !== next.installRoot) {
      this.registry.invalidate();
      await this.registry.scan();
    }
    if (previous.pathMode !== next.pathMode && next.pathMode === 'off') {
      await this.env.setPathMode('off');
    }
    await this.env.refresh();
    if (previous.mcpEnabled !== next.mcpEnabled || previous.mcpPort !== next.mcpPort) {
      if (next.mcpEnabled) await this.mcp.start();
      else await this.mcp.stop();
    }
    return next;
  }

  /**
   * Publish or retract the global PATH entries, raising UAC when the target scope is
   * machine-wide. The intent is stored before the registry write so the elevated helper
   * can verify that the user still wants it, and rolled back if the write fails.
   */
  async setPathMode(mode: PathMode): Promise<ShellInfo> {
    const previous = getSettings().pathMode;
    await updateSettings({ pathMode: mode });
    try {
      // Leaving machine mode needs elevation too, because HKLM cannot be edited otherwise.
      if (previous === 'machine' && mode !== 'machine') {
        await this.applyMachinePathElevated('strip');
      }
      try {
        await this.env.setPathMode(mode);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (mode === 'machine' && /管理员权限/.test(message)) {
          await this.applyMachinePathElevated('apply');
        } else {
          throw error;
        }
      }
    } catch (error) {
      await updateSettings({ pathMode: previous });
      await this.env.setPathMode(previous).catch(() => undefined);
      throw error;
    }
    await this.applySettings({ pathMode: mode });
    return await this.env.info();
  }

  /**
   * Machine-scope PATH lives in HKLM, so writing it needs an elevated process.
   * The user already asked for it by clicking「系统 PATH」, so we raise the UAC prompt
   * with the packaged executable running as a one-shot helper, wait for it, then
   * drop the bigEnv entries from the user scope in this (non-elevated) process.
   */
  async applyMachinePathElevated(action: 'apply' | 'strip'): Promise<void> {
    const exe = process.execPath;
    const flag = `${ELEVATION_FLAG}=${action}`;
    const args = app.isPackaged ? [flag] : [app.getAppPath(), flag];
    const quotedExe = exe.replace(/'/g, "''");
    const quotedArgs = args.map((arg) => `'${arg.replace(/'/g, "''")}'`).join(', ');
    const script = `$p = Start-Process -FilePath '${quotedExe}' -ArgumentList ${quotedArgs} -Verb RunAs -Wait -PassThru; exit $p.ExitCode`;
    const code = await new Promise<number>((resolve, reject) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let stderr = '';
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      const timer = setTimeout(() => child.kill(), 180_000);
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on('close', (exitCode) => {
        clearTimeout(timer);
        if (exitCode === 0) resolve(0);
        else if (/canceled by the user|用户取消|操作被用户取消/i.test(stderr)) resolve(1223);
        else resolve(exitCode ?? 1);
      });
    });
    if (code === 1223) throw new Error('已取消管理员授权');
    if (code !== 0) throw new Error('以管理员身份写入系统 PATH 失败');
    // `apply` wrote HKLM; `strip` removed the old entries there. Either way the
    // user-scope entries are this process's responsibility.
    await this.env.stripPathScope('user');
  }

  async dispose(): Promise<void> {
    await this.mcp.stop().catch(() => undefined);
    this.http.dispose();
  }
}
