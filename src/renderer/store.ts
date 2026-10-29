import { create } from 'zustand';
import type {
  HealthReport,
  InstallRecord,
  JobState,
  PathMode,
  ProjectInfo,
  SdkSummary,
  Settings,
  ShellInfo,
  ThemeMode,
  UpdateInfo,
  VersionOption,
} from '../shared/types';
import { bridge } from './lib/bridge';
import { applyTheme } from './lib/theme';

export type PageKey =
  | 'overview'
  | 'catalog'
  | 'jobs'
  | 'projects'
  | 'globals'
  | 'environment'
  | 'health'
  | 'settings';

interface Toast {
  text: string;
  kind: 'ok' | 'err';
  id: number;
}

/** IPC 抛出的错误会带上 `Error invoking remote method 'x': Error: ` 前缀，展示前剥掉。 */
function errorText(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

/** 注册表写入通常只要几百毫秒，但足够快时用户看不到"正在写入"；保底展示一段时间。 */
async function keepPending(startedAt: number, minMs = 520): Promise<void> {
  const remaining = minMs - (Date.now() - startedAt);
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
}

interface AppState {
  page: PageKey;
  settings: Settings | null;
  catalog: SdkSummary[];
  catalogLoading: boolean;
  installed: InstallRecord[];
  jobs: JobState[];
  versions: Record<string, VersionOption[]>;
  versionsLoading: string | null;
  versionsError: Record<string, string>;
  selectedSdk: string | null;
  projects: ProjectInfo[];
  projectDir: string | null;
  shell: ShellInfo | null;
  health: HealthReport | null;
  toast: Toast | null;
  busy: string | null;
  dockVisible: boolean;
  /** 正在提交的 PATH 模式，用于在按钮上显示进行中状态。 */
  pathModePending: PathMode | null;
  /** 正在提交的 SDK 勾选集合，用于让复选框先乐观切换再显示写入结果。 */
  pathSdksPending: string[] | null;
  pathError: string | null;
  /** GitHub 上的最新版本信息，undefined 表示还没查过。 */
  update: UpdateInfo | null;
  checkingUpdate: boolean;
  downloadingUpdate: boolean;

  init(): Promise<void>;
  setPage(page: PageKey): void;
  openSdk(sdkId: string): void;
  reloadVersions(sdkId: string): Promise<void>;
  closeSdk(): void;
  refreshCatalog(force?: boolean): Promise<void>;
  refreshInstalled(): Promise<void>;
  refreshJobs(): Promise<void>;
  startInstall(sdkId: string, version: string): Promise<void>;
  cancelJob(jobId: string): Promise<void>;
  clearJobs(): Promise<void>;
  hideDock(): void;
  useVersion(sdkId: string, version: string): Promise<void>;
  uninstall(sdkId: string, version: string): Promise<void>;
  saveSettings(patch: Partial<Settings>): Promise<void>;
  loadProjects(): Promise<void>;
  addProject(dir: string): Promise<void>;
  removeProject(dir: string): Promise<void>;
  saveProject(dir: string, versions: Record<string, string>): Promise<void>;
  loadShell(): Promise<void>;
  toggleShell(enabled: boolean): Promise<void>;
  setPathMode(mode: PathMode): Promise<void>;
  setPathSdks(sdks: string[]): Promise<void>;
  /** Switches the palette immediately, then persists it in settings.json. */
  setTheme(mode: ThemeMode): Promise<void>;
  checkUpdate(force?: boolean): Promise<void>;
  downloadUpdate(): Promise<void>;
  scanHealth(): Promise<void>;
  cleanHealth(options: { cache?: boolean; orphans?: boolean }): Promise<void>;
  notify(text: string, kind?: 'ok' | 'err'): void;
}

export const useApp = create<AppState>((set, get) => ({
  page: 'overview',
  settings: null,
  catalog: [],
  catalogLoading: false,
  installed: [],
  jobs: [],
  versions: {},
  versionsLoading: null,
  versionsError: {},
  selectedSdk: null,
  projects: [],
  projectDir: null,
  shell: null,
  health: null,
  toast: null,
  busy: null,
  dockVisible: false,
  pathModePending: null,
  pathSdksPending: null,
  pathError: null,
  update: null,
  checkingUpdate: false,
  downloadingUpdate: false,

  async init() {
    bridge.events.onJob((job) => {
      set((state) => {
        const index = state.jobs.findIndex((item) => item.id === job.id);
        const jobs = index >= 0 ? state.jobs.map((item) => (item.id === job.id ? job : item)) : [job, ...state.jobs];
        const active = job.phase === 'queued' || job.phase === 'downloading' || job.phase === 'verifying'
          || job.phase === 'extracting' || job.phase === 'finalizing';
        return { jobs, dockVisible: active ? true : state.dockVisible };
      });
      if (job.phase === 'done' || job.phase === 'error') {
        void get().refreshInstalled();
        void get().refreshCatalog();
        void get().loadProjects();
        // The version list embeds installed/current flags, so it has to be re-read after the job settles.
        if (job.phase === 'done') void get().reloadVersions(job.sdk);
      }
      if (job.phase === 'error') get().notify(`${job.sdk} ${job.version} 安装失败：${job.error ?? '未知错误'}`, 'err');
    });
    bridge.events.onInstalled(() => {
      void get().refreshInstalled();
      void get().refreshCatalog();
      const selected = get().selectedSdk;
      if (selected) void get().reloadVersions(selected);
    });
    bridge.events.onSettings((settings) => {
      applyTheme(settings.theme);
      set({ settings });
    });
    bridge.events.onCatalog((summary) =>
      set((state) => ({ catalog: state.catalog.map((item) => (item.id === summary.id ? summary : item)) })),
    );

    const [settings, installed, jobs] = await Promise.all([
      bridge.settings.get(),
      bridge.installed.list(),
      bridge.installs.list(),
    ]);
    set({
      settings,
      installed,
      jobs,
      dockVisible: jobs.some((job) => !['done', 'error', 'canceled'].includes(job.phase)),
    });
    // settings.json is the source of truth; the cached palette only covers the first paint.
    applyTheme(settings.theme);
    void bridge.system.applyTheme(settings.theme);
    await get().refreshCatalog();
    void get().loadShell();
    void get().loadProjects();
    // Silent startup check; the cached answer avoids hitting GitHub on every launch.
    void get().checkUpdate();
  },

  setPage(page) {
    set({ page });
    if (page === 'health' && !get().health) void get().scanHealth();
    if (page === 'environment') void get().loadShell();
  },

  openSdk(sdkId) {
    set({ selectedSdk: sdkId });
    void get().reloadVersions(sdkId);
  },

  async reloadVersions(sdkId) {
    set({ versionsLoading: sdkId });
    try {
      const versions = await bridge.catalog.versions(sdkId);
      set((state) => ({
        versions: { ...state.versions, [sdkId]: versions },
        versionsError: { ...state.versionsError, [sdkId]: '' },
      }));
    } catch (error) {
      const message = (error as Error).message;
      set((state) => ({
        versions: { ...state.versions, [sdkId]: [] },
        versionsError: { ...state.versionsError, [sdkId]: message },
      }));
      get().notify(`读取版本失败：${message}`, 'err');
    } finally {
      set({ versionsLoading: null });
    }
  },

  closeSdk() {
    set({ selectedSdk: null });
  },

  async refreshCatalog(force = false) {
    set({ catalogLoading: true });
    try {
      const catalog = await bridge.catalog.list();
      set({ catalog });
      if (force) await bridge.catalog.refresh();
    } catch (error) {
      get().notify(`同步 SDK 目录失败：${(error as Error).message}`, 'err');
    } finally {
      set({ catalogLoading: false });
    }
  },

  async refreshInstalled() {
    try {
      const installed = await bridge.installed.list();
      set({ installed });
    } catch {
      /* transient */
    }
  },

  async refreshJobs() {
    try {
      set({ jobs: await bridge.installs.list() });
    } catch {
      /* transient */
    }
  },

  async startInstall(sdkId, version) {
    try {
      const job = await bridge.installs.start(sdkId, version);
      set((state) => ({
        jobs: [job, ...state.jobs.filter((item) => item.id !== job.id)],
        // The queue dock owns progress now; keeping the drawer open just shows a stale, empty list.
        selectedSdk: null,
      }));
      get().notify(`已加入安装队列：${sdkId} ${version}`);
    } catch (error) {
      get().notify(`安装失败：${(error as Error).message}`, 'err');
    }
  },

  async cancelJob(jobId) {
    try {
      await bridge.installs.cancel(jobId);
      await get().refreshJobs();
    } catch (error) {
      get().notify(`取消失败：${(error as Error).message}`, 'err');
    }
  },

  async useVersion(sdkId, version) {
    try {
      await bridge.installed.use(sdkId, version);
      await get().refreshInstalled();
      await get().refreshCatalog();
      await get().reloadVersions(sdkId);
      get().notify(`已切换到 ${sdkId} ${version}`);
    } catch (error) {
      get().notify(`切换失败：${(error as Error).message}`, 'err');
    }
  },

  async uninstall(sdkId, version) {
    try {
      await bridge.installed.uninstall(sdkId, version);
      await get().refreshInstalled();
      await get().refreshCatalog();
      await get().reloadVersions(sdkId);
      await get().loadShell();
      get().notify(`已删除 ${sdkId} ${version}`);
    } catch (error) {
      get().notify(`删除失败：${(error as Error).message}`, 'err');
    }
  },

  async saveSettings(patch) {
    set({ busy: 'settings' });
    try {
      const settings = await bridge.settings.update(patch);
      applyTheme(settings.theme);
      set({ settings });
      get().notify('设置已保存');
      await get().refreshCatalog();
    } catch (error) {
      get().notify(`保存失败：${(error as Error).message}`, 'err');
    } finally {
      set({ busy: null });
    }
  },

  async loadProjects() {
    try {
      const projects = await bridge.projects.list();
      set((state) => {
        const projectDir = state.projectDir && projects.some((item) => item.dir === state.projectDir)
          ? state.projectDir
          : (projects[0]?.dir ?? null);
        return { projects, projectDir };
      });
    } catch {
      /* transient */
    }
  },

  async addProject(dir) {
    try {
      const projects = await bridge.projects.add(dir);
      set({ projects, projectDir: dir });
      get().notify('已加入项目列表');
    } catch (error) {
      get().notify(`添加失败：${(error as Error).message}`, 'err');
    }
  },

  async removeProject(dir) {
    try {
      const projects = await bridge.projects.remove(dir);
      set((state) => ({
        projects,
        projectDir: state.projectDir === dir ? (projects[0]?.dir ?? null) : state.projectDir,
      }));
      get().notify('已从项目列表移除');
    } catch (error) {
      get().notify(`移除失败：${(error as Error).message}`, 'err');
    }
  },

  async saveProject(dir, versions) {
    set({ busy: 'project' });
    try {
      const info = await bridge.projects.save(dir, versions);
      set((state) => ({
        projects: state.projects.map((item) => (item.dir === dir ? info : item)),
        projectDir: dir,
      }));
      get().notify(Object.keys(versions).length > 0 ? '该项目的运行环境已保存' : '已清空该项目的运行环境');
    } catch (error) {
      get().notify(`保存失败：${(error as Error).message}`, 'err');
    } finally {
      set({ busy: null });
    }
  },

  async clearJobs() {
    try {
      await bridge.installs.clear();
      await get().refreshJobs();
      set({ dockVisible: false });
    } catch (error) {
      get().notify(`清空失败：${(error as Error).message}`, 'err');
    }
  },

  hideDock() {
    set({ dockVisible: false });
  },

  async loadShell() {
    try {
      set({ shell: await bridge.env.info() });
    } catch {
      /* transient */
    }
  },

  async toggleShell(enabled) {
    try {
      const shell = enabled ? await bridge.env.enable() : await bridge.env.disable();
      // enable()/disable() persist the flag on the main side; mirror it into the store.
      set({ shell, settings: await bridge.settings.get() });
      get().notify(enabled ? '已注入 Shell 配置' : '已移除 Shell 配置');
    } catch (error) {
      get().notify(`操作失败：${(error as Error).message}`, 'err');
    }
  },

  async setPathMode(mode) {
    const startedAt = Date.now();
    set({ busy: 'path', pathModePending: mode, pathError: null });
    try {
      const shell = await bridge.env.setPathMode(mode);
      set({ shell });
      const settings = await bridge.settings.get();
      set({ settings });
      get().notify(
        mode === 'off'
          ? '已从全局 PATH 移除 bigEnv 条目'
          : `已写入${mode === 'machine' ? '系统' : '用户'} PATH（新开的终端生效）`,
      );
    } catch (error) {
      const message = errorText(error);
      set({ pathError: message });
      get().notify(`写入 PATH 失败：${message}`, 'err');
    } finally {
      await keepPending(startedAt);
      set({ busy: null, pathModePending: null });
    }
  },

  async setTheme(mode) {
    // Repaint first so the click feels instant; persistence follows.
    applyTheme(mode);
    set((state) => ({ settings: state.settings ? { ...state.settings, theme: mode } : state.settings }));
    try {
      const settings = await bridge.settings.update({ theme: mode });
      set({ settings });
      await bridge.system.applyTheme(settings.theme);
    } catch (error) {
      applyTheme(get().settings?.theme ?? 'system');
      get().notify(`主题保存失败：${errorText(error)}`, 'err');
    }
  },

  async checkUpdate(force = false) {
    if (get().checkingUpdate) return;
    set({ checkingUpdate: true });
    try {
      const update = await bridge.updates.check(force);
      set({ update });
      if (update.available) get().notify(`发现新版本 ${update.latest}`, 'ok');
      else if (force) {
        get().notify(update.status === 'none' ? '仓库还没有发布版本' : update.status === 'error' ? '检查更新失败，请稍后再试' : '已经是最新版本');
      }
    } catch (error) {
      get().notify(`检查更新失败：${errorText(error)}`, 'err');
    } finally {
      set({ checkingUpdate: false });
    }
  },

  async downloadUpdate() {
    if (get().downloadingUpdate) return;
    set({ downloadingUpdate: true });
    try {
      const file = await bridge.updates.download();
      get().notify('安装包已下载，正在打开…');
      await bridge.system.openPath(file);
    } catch (error) {
      get().notify(`下载失败：${errorText(error)}`, 'err');
    } finally {
      set({ downloadingUpdate: false });
    }
  },

  async setPathSdks(sdks) {
    const startedAt = Date.now();
    const mode = get().settings?.pathMode ?? 'off';
    set({ busy: 'path-sdks', pathSdksPending: sdks, pathError: null });
    try {
      const shell = await bridge.env.setPathSdks(sdks);
      set({ shell });
      set({ settings: await bridge.settings.get() });
      get().notify(
        mode === 'off'
          ? `已保存启用清单（${sdks.length} 个 SDK）；当前未启用全局 PATH，不会写入注册表`
          : `已写入${mode === 'machine' ? '系统' : '用户'} PATH：${shell.globalEntries.length} 个目录`,
      );
    } catch (error) {
      const message = errorText(error);
      set({ pathError: message });
      get().notify(`更新 PATH 条目失败：${message}`, 'err');
    } finally {
      await keepPending(startedAt);
      set({ busy: null, pathSdksPending: null });
    }
  },

  async scanHealth() {
    try {
      set({ health: await bridge.health.scan() });
    } catch (error) {
      get().notify(`体检失败：${(error as Error).message}`, 'err');
    }
  },

  async cleanHealth(options) {
    try {
      const health = await bridge.health.clean(options);
      set({ health });
      await get().refreshInstalled();
      get().notify('清理完成');
    } catch (error) {
      get().notify(`清理失败：${(error as Error).message}`, 'err');
    }
  },

  notify(text, kind = 'ok') {
    const id = Date.now();
    set({ toast: { text, kind, id } });
    window.setTimeout(() => {
      if (get().toast?.id === id) set({ toast: null });
    }, 3600);
  },
}));
