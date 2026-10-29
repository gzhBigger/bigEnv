import type {
  Bridge,
  HealthReport,
  InstallRecord,
  JobState,
  ProjectInfo,
  SdkSummary,
  Settings,
  ShellInfo,
  VersionOption,
} from '../../shared/types';

/** A self-contained fake bridge so the renderer can be developed in a plain browser. */

interface Seed {
  id: string;
  name: string;
  category: string;
  description: string;
  homepage: string;
  versions: [string, number, string?][];
}

const SEEDS: Seed[] = [
  {
    id: 'node',
    name: 'Node.js',
    category: '语言运行时',
    description: 'JavaScript 运行时，内置 npm，前端与工具链的默认底座。',
    homepage: 'https://nodejs.org',
    versions: [
      ['24.4.0', 302, 'Krypton'],
      ['22.17.0', 289, 'Jod'],
      ['20.19.4', 271, 'Iron'],
      ['18.20.8', 248, 'Hydrogen'],
    ],
  },
  {
    id: 'python',
    name: 'Python',
    category: '语言运行时',
    description: '通用脚本语言，科学计算与自动化场景的主力。',
    homepage: 'https://www.python.org',
    versions: [
      ['3.13.5', 28],
      ['3.12.10', 27],
      ['3.11.13', 26],
    ],
  },
  {
    id: 'go',
    name: 'Go',
    category: '语言运行时',
    description: '编译型并发语言，单文件可执行，云原生生态主流选择。',
    homepage: 'https://go.dev',
    versions: [
      ['1.24.5', 74],
      ['1.23.11', 70],
    ],
  },
  {
    id: 'jdk',
    name: 'JDK',
    category: 'JVM 生态',
    description: 'Adoptium Temurin 发行版，含 javac 与完整运行时。',
    homepage: 'https://adoptium.net',
    versions: [
      ['21.0.7', 196, 'LTS'],
      ['17.0.15', 189, 'LTS'],
      ['8.0.452', 174, 'LTS'],
    ],
  },
  {
    id: 'rust',
    name: 'Rust',
    category: '语言运行时',
    description: '系统级语言，含 cargo 与 rustfmt 工具链。',
    homepage: 'https://www.rust-lang.org',
    versions: [
      ['1.88.0', 246],
      ['1.86.0', 241],
    ],
  },
  {
    id: 'dotnet',
    name: '.NET SDK',
    category: '语言运行时',
    description: '跨平台 .NET 开发套件，含 CLI 与运行时。',
    homepage: 'https://dotnet.microsoft.com',
    versions: [
      ['9.0.303', 218, 'STS'],
      ['8.0.411', 205, 'LTS'],
    ],
  },
  {
    id: 'zig',
    name: 'Zig',
    category: 'C/C++ 与构建',
    description: '现代系统语言，自带 C/C++ 编译器与交叉编译能力。',
    homepage: 'https://ziglang.org',
    versions: [
      ['0.14.1', 48],
      ['0.13.0', 45],
    ],
  },
  {
    id: 'bun',
    name: 'Bun',
    category: '语言运行时',
    description: '一体化 JS 运行时、打包器与测试器，启动极快。',
    homepage: 'https://bun.sh',
    versions: [
      ['1.2.19', 92],
      ['1.1.45', 88],
    ],
  },
  {
    id: 'deno',
    name: 'Deno',
    category: '语言运行时',
    description: '默认安全的 TypeScript 运行时，内建格式化与测试。',
    homepage: 'https://deno.com',
    versions: [
      ['2.4.2', 41],
      ['2.3.7', 39],
    ],
  },
  {
    id: 'cmake',
    name: 'CMake',
    category: 'C/C++ 与构建',
    description: '跨平台构建系统生成器，C/C++ 项目的事实标准。',
    homepage: 'https://cmake.org',
    versions: [
      ['4.0.2', 52],
      ['3.31.8', 50],
    ],
  },
  {
    id: 'php',
    name: 'PHP',
    category: '语言运行时',
    description: 'Web 后端脚本语言，含 php-cli 与常用扩展。',
    homepage: 'https://www.php.net',
    versions: [
      ['8.4.10', 33],
      ['8.3.23', 32],
    ],
  },
  {
    id: 'flutter',
    name: 'Flutter',
    category: 'C/C++ 与构建',
    description: '跨平台 UI 框架，含 Dart SDK 与构建工具。',
    homepage: 'https://flutter.dev',
    versions: [
      ['3.32.5', 1024],
      ['3.29.3', 998],
    ],
  },
  {
    id: 'julia',
    name: 'Julia',
    category: '语言运行时',
    description: '面向科学计算的高性能动态语言。',
    homepage: 'https://julialang.org',
    versions: [
      ['1.11.6', 187],
      ['1.10.9', 179],
    ],
  },
  {
    id: 'ripgrep',
    name: 'ripgrep',
    category: '命令行工具',
    description: '极快的递归文本搜索工具，rg 命令来源。',
    homepage: 'https://github.com/BurntSushi/ripgrep',
    versions: [
      ['14.1.1', 4],
      ['14.1.0', 4],
    ],
  },
  {
    id: 'fd',
    name: 'fd',
    category: '命令行工具',
    description: '对用户友好的 find 替代品，支持正则与并行搜索。',
    homepage: 'https://github.com/sharkdp/fd',
    versions: [
      ['10.2.0', 3],
      ['9.0.0', 3],
    ],
  },
  {
    id: 'neovim',
    name: 'Neovim',
    category: '编辑器与文档',
    description: '可扩展的终端编辑器，Lua 配置与现代 UI 生态。',
    homepage: 'https://neovim.io',
    versions: [
      ['0.11.3', 26],
      ['0.10.4', 24],
    ],
  },
  {
    id: 'typst',
    name: 'Typst',
    category: '编辑器与文档',
    description: '现代排版系统，编译速度快，语法简洁。',
    homepage: 'https://typst.app',
    versions: [
      ['0.13.1', 34],
      ['0.12.0', 31],
    ],
  },
  {
    id: 'kubectl',
    name: 'kubectl',
    category: '命令行工具',
    description: 'Kubernetes 集群命令行客户端。',
    homepage: 'https://kubernetes.io/docs/tasks/tools/',
    versions: [
      ['1.33.2', 56],
      ['1.32.6', 54],
    ],
  },
  {
    id: 'miniconda',
    name: 'Miniconda',
    category: '语言运行时',
    description: '轻量 Conda 发行版，用于管理 Python 数据科学环境。',
    homepage: 'https://docs.conda.io/en/latest/miniconda.html',
    versions: [
      ['py312_25.5.1', 88],
      ['py311_25.1.1', 86],
    ],
  },
];

const DEFAULT_SETTINGS: Settings = {
  installRoot: 'C:\\Users\\dev\\.bigenv',
  metaBase: 'https://raw.githubusercontent.com/gvcgo/vsources/main',
  mirror: 'cn',
  proxy: '',
  concurrency: 2,
  showUnsupported: true,
  shellEnabled: true,
  pathMode: 'off',
};

function versionsOf(seed: Seed, installed: InstallRecord[]): VersionOption[] {
  return seed.versions.map(([version, sizeMb, lts]) => {
    const record = installed.find((item) => item.sdk === seed.id && item.version === version);
    return {
      version,
      lts: lts ?? null,
      sizeBytes: sizeMb * 1024 * 1024,
      installer: 'unarchiver',
      installable: true,
      installed: Boolean(record),
      current: Boolean(record?.current),
      url: `https://example.invalid/${seed.id}/${version}.zip`,
      sha256: null,
    };
  });
}

function installRecord(sdk: string, version: string, current: boolean): InstallRecord {
  return {
    sdk,
    version,
    path: `C:\\Users\\dev\\.bigenv\\${sdk}\\${version}`,
    sizeBytes: 240 * 1024 * 1024,
    installedAt: '2026-05-18T09:24:00.000Z',
    installer: 'unarchiver',
    binDirs: [[]],
    env: {},
    sourceUrl: null,
    current,
    managed: true,
  };
}

export function createMockBridge(): Bridge {
  let settings: Settings = { ...DEFAULT_SETTINGS };
  let installed: InstallRecord[] = [
    installRecord('node', '22.17.0', true),
    installRecord('go', '1.24.5', true),
    installRecord('python', '3.12.10', false),
  ];
  const jobs: JobState[] = [];
  const jobListeners = new Set<(job: JobState) => void>();
  const installedListeners = new Set<() => void>();
  const settingsListeners = new Set<(value: Settings) => void>();
  const catalogListeners = new Set<(summary: SdkSummary) => void>();
  let projectLock: Record<string, string> = { node: '22.17.0', go: '1.24.5' };

  const emitJob = (job: JobState): void => {
    for (const listener of jobListeners) listener({ ...job });
  };

  const notifyInstalled = (): void => {
    for (const listener of installedListeners) listener();
  };

  const summaries = (): SdkSummary[] =>
    SEEDS.map((seed) => {
      const records = installed.filter((item) => item.sdk === seed.id);
      return {
        id: seed.id,
        name: seed.name,
        homepage: seed.homepage,
        category: seed.category,
        description: seed.description,
        versionCount: seed.versions.length,
        latestVersion: seed.versions[0]?.[0] ?? null,
        latestLts: seed.versions.find((item) => item[2])?.[2] ?? null,
        installable: true,
        installedVersions: records.map((item) => item.version),
        currentVersion: records.find((item) => item.current)?.version ?? null,
      };
    });

  const health = (): HealthReport => ({
    installRoot: settings.installRoot,
    totalBytes: installed.reduce((sum, item) => sum + item.sizeBytes, 0),
    cacheBytes: 1180 * 1024 * 1024,
    installs: installed.map((item) => ({
      sdk: item.sdk,
      version: item.version,
      sizeBytes: item.sizeBytes,
      installedAt: item.installedAt,
      orphan: false,
    })),
    orphans: [
      { sdk: 'zig', version: '0.11.0', path: `${settings.installRoot}\\zig\\0.11.0`, sizeBytes: 46 * 1024 * 1024 },
    ],
    brokenCurrentLinks: [],
  });

  const envInfo = (): ShellInfo => ({
    envScriptPath: `${settings.installRoot}\\..\\bigenv\\env\\env.ps1`,
    profilePath: 'C:\\Users\\dev\\Documents\\PowerShell\\Microsoft.PowerShell_profile.ps1',
    enabled: settings.shellEnabled,
    pathEntries: installed.filter((item) => item.current).map((item) => item.path),
    vars: {},
    pathMode: settings.pathMode,
    globalEntries: installed.filter((item) => item.current).map((item) => `${settings.installRoot}\\${item.sdk}\\current`),
    activeScope: settings.pathMode === 'off' ? null : settings.pathMode,
    conflicts: [],
    cliBinDir: `${settings.installRoot}\\..\\bigenv\\bin`,
    cliLauncher: `${settings.installRoot}\\..\\bigenv\\bin\\bigenv.cmd`,
    cliScript: 'C:\\Program Files\\bigEnv\\resources\\cli.cjs',
  });

  const project = (): ProjectInfo => {
    const dir = 'D:\\workspace\\demo-shop';
    const entries = Object.entries(projectLock).map(([sdk, version]) => {
      const record = installed.find((item) => item.sdk === sdk && item.version === version);
      return { sdk, version, installed: Boolean(record), path: record?.path ?? null };
    });
    return { dir, lockFile: `${dir}\\.bigenv.json`, versions: { ...projectLock }, entries };
  };

  const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  const startJob = async (sdkId: string, version: string): Promise<JobState> => {
    const job: JobState = {
      id: `job-${Date.now()}`,
      sdk: sdkId,
      version,
      phase: 'queued',
      progress: 0,
      receivedBytes: 0,
      totalBytes: 240 * 1024 * 1024,
      speed: 0,
      message: '等待调度',
      startedAt: Date.now(),
    };
    jobs.unshift(job);
    emitJob(job);
    const phases: JobState['phase'][] = ['downloading', 'verifying', 'extracting', 'finalizing'];
    let index = 0;
    const tick = setInterval(() => {
      if (job.phase === 'canceled') {
        clearInterval(tick);
        return;
      }
      const phase = phases[index];
      if (!phase) {
        clearInterval(tick);
        job.phase = 'done';
        job.progress = 1;
        job.message = '已安装';
        job.finishedAt = Date.now();
        installed = installed.map((item) => (item.sdk === job.sdk ? { ...item, current: false } : item));
        if (!installed.some((item) => item.sdk === job.sdk && item.version === job.version)) {
          installed.push(installRecord(job.sdk, job.version, true));
        }
        emitJob(job);
        notifyInstalled();
        return;
      }
      job.phase = phase;
      index += 1;
      job.progress = Math.min(0.97, job.progress + 0.22 + Math.random() * 0.14);
      job.receivedBytes = Math.round((job.totalBytes ?? 0) * job.progress);
      job.speed = 6.4 * 1024 * 1024 + Math.random() * 3 * 1024 * 1024;
      job.message = phase === 'downloading' ? '下载安装包' : phase === 'extracting' ? '解压归档' : '处理文件';
      emitJob(job);
    }, 900);
    return { ...job };
  };

  return {
    catalog: {
      list: async () => {
        await delay(90);
        return summaries();
      },
      versions: async (sdkId) => {
        await delay(120);
        const seed = SEEDS.find((item) => item.id === sdkId);
        if (!seed) return [];
        return versionsOf(seed, installed);
      },
      refresh: async () => {
        await delay(600);
        for (const summary of summaries()) for (const listener of catalogListeners) listener(summary);
      },
    },
    installs: {
      start: startJob,
      cancel: async (jobId) => {
        const job = jobs.find((item) => item.id === jobId);
        if (!job) return;
        job.phase = 'canceled';
        job.message = '已取消';
        job.finishedAt = Date.now();
        emitJob(job);
      },
      list: async () => jobs.map((job) => ({ ...job })),
    },
    installed: {
      list: async () => {
        await delay(60);
        return installed.map((item) => ({ ...item }));
      },
      use: async (sdkId, version) => {
        installed = installed.map((item) => ({
          ...item,
          current: item.sdk === sdkId && item.version === version ? true : item.sdk === sdkId ? false : item.current,
        }));
        notifyInstalled();
      },
      uninstall: async (sdkId, version) => {
        installed = installed.filter((item) => !(item.sdk === sdkId && item.version === version));
        notifyInstalled();
      },
    },
    settings: {
      get: async () => ({ ...settings }),
      update: async (patch) => {
        settings = { ...settings, ...patch };
        for (const listener of settingsListeners) listener({ ...settings });
        return { ...settings };
      },
    },
    env: {
      info: async () => envInfo(),
      enable: async () => {
        settings = { ...settings, shellEnabled: true };
        return envInfo();
      },
      disable: async () => {
        settings = { ...settings, shellEnabled: false };
        return envInfo();
      },
      openTerminal: async () => {
        await delay(120);
      },
      setPathMode: async (mode) => {
        settings = { ...settings, pathMode: mode };
        await delay(150);
        return envInfo();
      },
    },
    projects: {
      inspect: async () => {
        await delay(80);
        return project();
      },
      lock: async (_dir, versions) => {
        projectLock = { ...versions };
        await delay(120);
        return project();
      },
    },
    system: {
      pickDirectory: async () => 'D:\\workspace\\demo-shop',
      openPath: async () => undefined,
      openExternal: async () => undefined,
    },
    health: {
      scan: async () => {
        await delay(200);
        return health();
      },
      clean: async () => {
        await delay(320);
        return health();
      },
    },
    events: {
      onJob: (cb) => {
        jobListeners.add(cb);
        return () => jobListeners.delete(cb);
      },
      onCatalog: (cb) => {
        catalogListeners.add(cb);
        return () => catalogListeners.delete(cb);
      },
      onInstalled: (cb) => {
        installedListeners.add(cb);
        return () => installedListeners.delete(cb);
      },
      onSettings: (cb) => {
        settingsListeners.add(cb);
        return () => settingsListeners.delete(cb);
      },
    },
    runtime: {
      version: '0.1.0',
      platform: 'win32',
      arch: 'x64',
      dataRoot: 'C:\\Users\\dev\\AppData\\Roaming\\bigEnv',
      electron: '45.1.0',
    },
  };
}
