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
  VersionOption,
} from '../shared/types';
import { bridge } from './lib/bridge';

export type PageKey = 'overview' | 'catalog' | 'installed' | 'jobs' | 'projects' | 'environment' | 'health' | 'settings';

interface Toast {
  text: string;
  kind: 'ok' | 'err';
  id: number;
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
  selectedSdk: string | null;
  project: ProjectInfo | null;
  shell: ShellInfo | null;
  health: HealthReport | null;
  toast: Toast | null;
  busy: string | null;

  init(): Promise<void>;
  setPage(page: PageKey): void;
  openSdk(sdkId: string): void;
  closeSdk(): void;
  refreshCatalog(force?: boolean): Promise<void>;
  refreshInstalled(): Promise<void>;
  refreshJobs(): Promise<void>;
  startInstall(sdkId: string, version: string): Promise<void>;
  cancelJob(jobId: string): Promise<void>;
  useVersion(sdkId: string, version: string): Promise<void>;
  uninstall(sdkId: string, version: string): Promise<void>;
  saveSettings(patch: Partial<Settings>): Promise<void>;
  inspectProject(dir: string): Promise<void>;
  lockProject(versions: Record<string, string>): Promise<void>;
  loadShell(): Promise<void>;
  toggleShell(enabled: boolean): Promise<void>;
  setPathMode(mode: PathMode): Promise<void>;
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
  selectedSdk: null,
  project: null,
  shell: null,
  health: null,
  toast: null,
  busy: null,

  async init() {
    bridge.events.onJob((job) => {
      set((state) => {
        const index = state.jobs.findIndex((item) => item.id === job.id);
        const jobs = index >= 0 ? state.jobs.map((item) => (item.id === job.id ? job : item)) : [job, ...state.jobs];
        return { jobs };
      });
      if (job.phase === 'done' || job.phase === 'error') {
        void get().refreshInstalled();
        void get().refreshCatalog();
        set((state) => ({
          versions: { ...state.versions, [job.sdk]: [] },
        }));
      }
      if (job.phase === 'error') get().notify(`${job.sdk} ${job.version} 安装失败：${job.error ?? '未知错误'}`, 'err');
    });
    bridge.events.onInstalled(() => {
      void get().refreshInstalled();
      void get().refreshCatalog();
    });
    bridge.events.onSettings((settings) => set({ settings }));
    bridge.events.onCatalog((summary) =>
      set((state) => ({ catalog: state.catalog.map((item) => (item.id === summary.id ? summary : item)) })),
    );

    const [settings, installed, jobs] = await Promise.all([
      bridge.settings.get(),
      bridge.installed.list(),
      bridge.installs.list(),
    ]);
    set({ settings, installed, jobs });
    await get().refreshCatalog();
    void get().loadShell();
  },

  setPage(page) {
    set({ page });
    if (page === 'health' && !get().health) void get().scanHealth();
    if (page === 'environment') void get().loadShell();
  },

  openSdk(sdkId) {
    set({ selectedSdk: sdkId });
    void (async () => {
      set({ versionsLoading: sdkId });
      try {
        const versions = await bridge.catalog.versions(sdkId);
        set((state) => ({ versions: { ...state.versions, [sdkId]: versions } }));
      } catch (error) {
        get().notify(`读取版本失败：${(error as Error).message}`, 'err');
      } finally {
        set({ versionsLoading: null });
      }
    })();
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
      set((state) => ({ jobs: [job, ...state.jobs.filter((item) => item.id !== job.id)] }));
      set((state) => ({ versions: { ...state.versions, [sdkId]: [] } }));
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
      get().notify(`已删除 ${sdkId} ${version}`);
    } catch (error) {
      get().notify(`删除失败：${(error as Error).message}`, 'err');
    }
  },

  async saveSettings(patch) {
    set({ busy: 'settings' });
    try {
      const settings = await bridge.settings.update(patch);
      set({ settings });
      get().notify('设置已保存');
      await get().refreshCatalog();
    } catch (error) {
      get().notify(`保存失败：${(error as Error).message}`, 'err');
    } finally {
      set({ busy: null });
    }
  },

  async inspectProject(dir) {
    try {
      set({ project: await bridge.projects.inspect(dir) });
    } catch (error) {
      get().notify(`读取项目失败：${(error as Error).message}`, 'err');
    }
  },

  async lockProject(versions) {
    const project = get().project;
    if (!project) return;
    try {
      set({ project: await bridge.projects.lock(project.dir, versions) });
      get().notify('项目版本已锁定');
    } catch (error) {
      get().notify(`写入失败：${(error as Error).message}`, 'err');
    }
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
      set({ shell });
      get().notify(enabled ? '已注入 Shell 配置' : '已移除 Shell 配置');
    } catch (error) {
      get().notify(`操作失败：${(error as Error).message}`, 'err');
    }
  },

  async setPathMode(mode) {
    set({ busy: 'path' });
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
      get().notify(`写入 PATH 失败：${(error as Error).message}`, 'err');
    } finally {
      set({ busy: null });
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
