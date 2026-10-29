/** Shared contracts between the Electron main process, the preload bridge and the renderer. */

export type InstallerKind =
  | 'unarchiver'
  | 'executable'
  | 'conda'
  | 'compile'
  | 'coursier'
  | 'rustup'
  | 'other';

export type MirrorMode = 'off' | 'cn';

export type PathMode = 'off' | 'user' | 'machine';

export interface Settings {
  /** Directory that holds `<sdk>/<version>` install trees. */
  installRoot: string;
  /** Base URL of the version metadata (vsources compatible). */
  metaBase: string;
  /** Rewrite download URLs to mainland-friendly mirrors. */
  mirror: MirrorMode;
  /** Optional HTTP/SOCKS proxy, e.g. http://127.0.0.1:7890 */
  proxy: string;
  /** Parallel install jobs. */
  concurrency: number;
  /** Show SDKs that have no Windows package in the catalog. */
  showUnsupported: boolean;
  /** Whether the PowerShell profile hook is installed. */
  shellEnabled: boolean;
  /** Where `<installRoot>\\<sdk>\\current` entries are published so every process can see them. */
  pathMode: PathMode;
  /** Project directories managed on the projects page (absolute paths). */
  projects: string[];
}

export interface SdkSummary {
  id: string;
  name: string;
  homepage: string;
  category: string;
  description: string;
  versionCount: number;
  latestVersion: string | null;
  latestLts: string | null;
  installable: boolean;
  unavailableReason?: string;
  installedVersions: string[];
  currentVersion: string | null;
}

export interface VersionOption {
  version: string;
  lts: string | null;
  sizeBytes: number | null;
  installer: InstallerKind;
  installable: boolean;
  unavailableReason?: string;
  installed: boolean;
  current: boolean;
  url: string | null;
  sha256: string | null;
}

export interface InstallRecord {
  sdk: string;
  version: string;
  path: string;
  sizeBytes: number;
  installedAt: string;
  installer: InstallerKind;
  /** Paths relative to the install root, e.g. ["bin"] or [] for the root itself. */
  binDirs: string[][];
  env: Record<string, string>;
  sourceUrl: string | null;
  current: boolean;
  /** False for directories that bigEnv did not create (no metadata file). */
  managed: boolean;
}

export type JobPhase =
  | 'queued'
  | 'downloading'
  | 'verifying'
  | 'extracting'
  | 'finalizing'
  | 'done'
  | 'error'
  | 'canceled';

export interface JobState {
  id: string;
  sdk: string;
  version: string;
  phase: JobPhase;
  /** 0..1, best effort. */
  progress: number;
  receivedBytes: number;
  totalBytes: number | null;
  /** Bytes per second (smoothed). */
  speed: number;
  message: string;
  startedAt: number;
  finishedAt?: number;
  error?: string;
  installPath?: string;
}

export interface EnvInjection {
  /** Absolute directories that should be prepended to PATH. */
  pathEntries: string[];
  /** Additional environment variables (absolute values). */
  vars: Record<string, string>;
}

export interface PathConflict {
  sdk: string;
  /** Directory that bigEnv prepends. */
  entry: string;
  /** Executable name that is shadowed, e.g. `node.exe`. */
  exe: string;
  /** Earlier PATH directory that wins the lookup. */
  shadowedBy: string;
}

export interface ShellInfo {
  envScriptPath: string;
  profilePath: string | null;
  enabled: boolean;
  pathEntries: string[];
  vars: Record<string, string>;
  pathMode: PathMode;
  /** Stable `<installRoot>\<sdk>\current` directories published to PATH. */
  globalEntries: string[];
  /** Scope that actually carries the entries, null when pathMode is off. */
  activeScope: 'user' | 'machine' | null;
  conflicts: PathConflict[];
  /** Directory holding the `bigenv.cmd` shim, always present. */
  cliBinDir: string;
  cliLauncher: string | null;
  /** Absolute path of the CLI script the shim points at. */
  cliScript: string;
}

export interface ProjectLockEntry {
  sdk: string;
  version: string;
  installed: boolean;
  path: string | null;
}

export interface ProjectInfo {
  dir: string;
  /** Directory name, used as the display label. */
  name: string;
  lockFile: string | null;
  versions: Record<string, string>;
  entries: ProjectLockEntry[];
}

export interface HealthInstall {
  sdk: string;
  version: string;
  sizeBytes: number;
  installedAt: string;
  orphan: boolean;
}

export interface HealthReport {
  installRoot: string;
  totalBytes: number;
  cacheBytes: number;
  installs: HealthInstall[];
  orphans: { sdk: string; version: string; path: string; sizeBytes: number }[];
  brokenCurrentLinks: string[];
}

export interface Bridge {
  catalog: {
    list(): Promise<SdkSummary[]>;
    versions(sdkId: string): Promise<VersionOption[]>;
    refresh(): Promise<void>;
  };
  installs: {
    start(sdkId: string, version: string): Promise<JobState>;
    cancel(jobId: string): Promise<void>;
    list(): Promise<JobState[]>;
    /** Drop finished (done/error/canceled) jobs from the queue. */
    clear(): Promise<void>;
  };
  installed: {
    list(): Promise<InstallRecord[]>;
    use(sdkId: string, version: string): Promise<void>;
    uninstall(sdkId: string, version: string): Promise<void>;
  };
  settings: {
    get(): Promise<Settings>;
    update(patch: Partial<Settings>): Promise<Settings>;
  };
  env: {
    info(): Promise<ShellInfo>;
    enable(): Promise<ShellInfo>;
    disable(): Promise<ShellInfo>;
    openTerminal(dir?: string): Promise<void>;
    setPathMode(mode: PathMode): Promise<ShellInfo>;
  };
  projects: {
    /** All managed projects, inspected (lock file contents included). */
    list(): Promise<ProjectInfo[]>;
    add(dir: string): Promise<ProjectInfo[]>;
    remove(dir: string): Promise<ProjectInfo[]>;
    inspect(dir: string): Promise<ProjectInfo>;
    /** Replace the project's lock file with exactly these entries. */
    save(dir: string, versions: Record<string, string>): Promise<ProjectInfo>;
    openTerminal(dir: string): Promise<void>;
  };
  system: {
    pickDirectory(): Promise<string | null>;
    openPath(target: string): Promise<void>;
    openExternal(url: string): Promise<void>;
  };
  health: {
    scan(): Promise<HealthReport>;
    clean(options: { cache?: boolean; orphans?: boolean }): Promise<HealthReport>;
  };
  events: {
    onJob(cb: (job: JobState) => void): () => void;
    onCatalog(cb: (sdk: SdkSummary) => void): () => void;
    onInstalled(cb: () => void): () => void;
    onSettings(cb: (settings: Settings) => void): () => void;
  };
  runtime: {
    version: string;
    platform: string;
    arch: string;
    dataRoot: string;
    electron: string;
  };
}
