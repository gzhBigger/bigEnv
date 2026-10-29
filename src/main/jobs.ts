import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { JobState, Settings } from '../shared/types';
import { extractArchive } from './archive';
import type { CatalogService, InstallPlan } from './catalog';
import { ensureDir, findRootDir, moveDir, removeDir } from './fsx';
import { createHttpClient, type HttpClient } from './http';
import { createLogger } from './logger';
import type { Registry } from './registry';
import { runCommand } from './util';

const log = createLogger('jobs');

export interface JobDeps {
  registry: Registry;
  catalog: CatalogService;
  getSettings: () => Settings;
  getPaths: () => { downloadDir: string; tempDir: string };
  onInstalledChange: () => Promise<void> | void;
}

const HISTORY_LIMIT = 30;

export class JobQueue {
  private readonly jobs = new Map<string, JobState>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly pending: string[] = [];
  private readonly listeners = new Set<(job: JobState) => void>();
  private readonly lastEmit = new Map<string, number>();
  private active = 0;

  constructor(private readonly deps: JobDeps) {}

  onChange(listener: (job: JobState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  list(): JobState[] {
    return [...this.jobs.values()].sort((a, b) => b.startedAt - a.startedAt);
  }

  get(id: string): JobState | undefined {
    return this.jobs.get(id);
  }

  async start(sdk: string, version: string): Promise<JobState> {
    for (const job of this.jobs.values()) {
      if (job.sdk === sdk && job.version === version && job.phase !== 'done' && job.phase !== 'error' && job.phase !== 'canceled') {
        throw new Error(`${sdk} ${version} 正在处理中`);
      }
    }
    const id = randomUUID();
    const job: JobState = {
      id,
      sdk,
      version,
      phase: 'queued',
      progress: 0,
      receivedBytes: 0,
      totalBytes: null,
      speed: 0,
      message: '排队中',
      startedAt: Date.now(),
    };
    this.jobs.set(id, job);
    this.pending.push(id);
    this.emit(job, true);
    this.trimHistory();
    this.pump();
    return job;
  }

  async cancel(id: string): Promise<void> {
    const job = this.jobs.get(id);
    if (!job) return;
    if (job.phase === 'queued') {
      const index = this.pending.indexOf(id);
      if (index >= 0) this.pending.splice(index, 1);
      this.patch(id, { phase: 'canceled', message: '已取消', finishedAt: Date.now() }, true);
      return;
    }
    this.controllers.get(id)?.abort(new Error('用户取消'));
    this.patch(id, { message: '正在取消…' }, true);
  }

  private trimHistory(): void {
    const finished = [...this.jobs.values()]
      .filter((job) => job.phase === 'done' || job.phase === 'error' || job.phase === 'canceled')
      .sort((a, b) => b.startedAt - a.startedAt);
    for (const job of finished.slice(HISTORY_LIMIT)) this.jobs.delete(job.id);
  }

  private emit(job: JobState, force = false): void {
    const now = Date.now();
    const last = this.lastEmit.get(job.id) ?? 0;
    if (!force && now - last < 220) return;
    this.lastEmit.set(job.id, now);
    for (const listener of this.listeners) listener({ ...job });
  }

  private patch(id: string, patch: Partial<JobState>, force = false): JobState | null {
    const job = this.jobs.get(id);
    if (!job) return null;
    Object.assign(job, patch);
    this.emit(job, force);
    return job;
  }

  private pump(): void {
    const limit = Math.max(1, Math.min(6, this.deps.getSettings().concurrency));
    while (this.active < limit && this.pending.length > 0) {
      const id = this.pending.shift()!;
      this.active += 1;
      void this.run(id).finally(() => {
        this.active -= 1;
        this.pump();
      });
    }
  }

  private async run(id: string): Promise<void> {
    const controller = new AbortController();
    this.controllers.set(id, controller);
    const settings = this.deps.getSettings();
    let client: HttpClient | null = null;
    let tempRoot: string | null = null;
    try {
      const job = this.jobs.get(id);
      if (!job) return;
      this.patch(id, { phase: 'downloading', message: '解析安装包…', progress: 0.01 }, true);
      const plan = await this.deps.catalog.plan(job.sdk, job.version, settings.mirror === 'cn');
      if (controller.signal.aborted) throw new Error('已取消');
      if (await this.deps.registry.isInstalled(plan.sdk, plan.version)) {
        throw new Error(`${plan.sdk} ${plan.version} 已安装`);
      }

      if (plan.installer === 'conda') {
        await this.installConda(plan, id, controller.signal);
      } else {
        client = createHttpClient(settings.proxy);
        tempRoot = await this.prepareTemp(id);
        const downloadDest = this.downloadPath(plan);
        this.patch(id, { message: plan.mirrored ? `下载中（镜像：${plan.mirrorNote ?? '加速'}）` : '下载中', phase: 'downloading' }, true);
        const result = await client.download({
          url: plan.downloadUrl,
          dest: downloadDest,
          sha256: plan.sha256,
          expectedBytes: plan.sizeBytes,
          signal: controller.signal,
          onProgress: (info) => {
            const fraction = info.total && info.total > 0 ? info.received / info.total : 0;
            this.patch(id, {
              phase: 'downloading',
              receivedBytes: info.received,
              totalBytes: info.total,
              speed: info.speed,
              progress: Math.min(0.8, 0.02 + fraction * 0.78),
              message: result0(plan, info.received, info.total),
            });
          },
          onPhase: (phase) => {
            this.patch(id, { phase: phase === 'verifying' ? 'verifying' : 'downloading', progress: phase === 'verifying' ? 0.82 : 0.02 }, true);
          },
        });
        if (controller.signal.aborted) throw new Error('已取消');
        const installDir = await this.deps.registry.createInstallDir(plan.sdk, plan.version);
        if (plan.installer === 'executable') {
          this.patch(id, { phase: 'finalizing', progress: 0.9, message: '写入可执行文件…' }, true);
          await ensureDir(installDir);
          const target = path.join(installDir, `${plan.sdk}.exe`);
          await fs.copyFile(downloadDest, target);
        } else {
          this.patch(id, { phase: 'extracting', progress: 0.84, message: '解压中…' }, true);
          const extractDir = path.join(tempRoot, 'extract');
          await extractArchive(downloadDest, extractDir, {
            signal: controller.signal,
            onEntry: (count) => {
              this.patch(id, { message: `解压中… 已写入 ${count} 个文件` });
            },
          });
          if (controller.signal.aborted) throw new Error('已取消');
          const root = await findRootDir(extractDir, plan.flagFiles);
          this.patch(id, { phase: 'finalizing', progress: 0.94, message: '写入安装目录…' }, true);
          await moveDir(root, installDir);
        }
        this.patch(id, { progress: 0.97, message: '记录安装信息…' }, true);
        await this.deps.registry.writeMeta({
          sdk: plan.sdk,
          version: plan.version,
          installer: plan.installer,
          binDirs: plan.binaryDirs,
          envs: plan.envs,
          sourceUrl: plan.url,
          sha256: plan.sha256,
          installedAt: new Date().toISOString(),
          archive: plan.fileName,
        });
        await this.activateIfNeeded(plan.sdk, plan.version);
        this.patch(
          id,
          {
            phase: 'done',
            progress: 1,
            speed: 0,
            finishedAt: Date.now(),
            message: result.skipped ? '安装完成（复用缓存）' : '安装完成',
            installPath: installDir,
          },
          true,
        );
        log.info('job done', { sdk: plan.sdk, version: plan.version });
        await this.deps.onInstalledChange();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const canceled = controller.signal.aborted || /已取消/.test(message);
      this.patch(
        id,
        {
          phase: canceled ? 'canceled' : 'error',
          message: canceled ? '已取消' : '安装失败',
          error: canceled ? undefined : message,
          finishedAt: Date.now(),
          speed: 0,
        },
        true,
      );
      log.warn('job failed', { id, message });
      if (!canceled) await this.cleanupFailed(id).catch(() => undefined);
    } finally {
      this.controllers.delete(id);
      client?.dispose();
      if (tempRoot) await removeDir(tempRoot).catch(() => undefined);
      this.trimHistory();
    }
  }

  private async activateIfNeeded(sdk: string, version: string): Promise<void> {
    const current = await this.deps.registry.currentVersion(sdk);
    if (!current) await this.deps.registry.use(sdk, version);
  }

  private async installConda(plan: InstallPlan, id: string, signal: AbortSignal): Promise<void> {
    this.patch(id, { phase: 'extracting', progress: 0.3, message: '通过 Conda 创建环境（可能需要几分钟）…' }, true);
    const installDir = await this.deps.registry.createInstallDir(plan.sdk, plan.version);
    const command = process.platform === 'win32' ? 'conda.bat' : 'conda';
    const args = ['create', '-q', '-y', '--prefix', installDir, '-c', 'conda-forge', `${plan.condaPackage ?? plan.sdk}=${plan.version}`];
    log.info('conda install', { args });
    const result = await runCommand(command, args, { timeoutMs: 30 * 60_000, signal });
    if (result.code !== 0) {
      throw new Error(`conda 安装失败：${result.stderr.trim() || result.stdout.trim() || `退出码 ${result.code}`}`);
    }
    await this.deps.registry.writeMeta({
      sdk: plan.sdk,
      version: plan.version,
      installer: 'conda',
      binDirs: plan.binaryDirs,
      envs: plan.envs,
      sourceUrl: plan.url,
      sha256: null,
      installedAt: new Date().toISOString(),
      archive: null,
    });
    await this.activateIfNeeded(plan.sdk, plan.version);
    this.patch(id, { phase: 'done', progress: 1, message: '安装完成（Conda）', finishedAt: Date.now(), installPath: installDir }, true);
    await this.deps.onInstalledChange();
  }

  private downloadPath(plan: InstallPlan): string {
    const { downloadDir } = this.deps.getPaths();
    const folder = `${plan.sdk}-${plan.version.replace(/[^\w.+-]/g, '_')}`;
    const name = plan.fileName || `${plan.sdk}.bin`;
    return path.join(downloadDir, folder, name);
  }

  private async prepareTemp(id: string): Promise<string> {
    const { tempDir } = this.deps.getPaths();
    const dir = path.join(tempDir, id);
    await removeDir(dir).catch(() => undefined);
    await ensureDir(dir);
    return dir;
  }

  private async cleanupFailed(id: string): Promise<void> {
    const job = this.jobs.get(id);
    if (!job) return;
    const dir = this.deps.registry.installDir(job.sdk, job.version);
    const existing = await fs.stat(dir).catch(() => null);
    if (existing?.isDirectory()) {
      const meta = await fs.stat(path.join(dir, '.bigenv.json')).catch(() => null);
      if (!meta) await removeDir(dir);
    }
  }
}

function result0(plan: InstallPlan, received: number, total: number | null): string {
  const mb = (value: number) => `${(value / 1024 / 1024).toFixed(1)} MB`;
  const suffix = plan.mirrored ? '（镜像加速）' : '';
  if (total && total > 0) return `下载中 ${mb(received)} / ${mb(total)}${suffix}`;
  return `下载中 ${mb(received)}${suffix}`;
}
