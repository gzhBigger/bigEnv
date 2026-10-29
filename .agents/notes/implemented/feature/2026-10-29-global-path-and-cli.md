# Agent Note: 全局 PATH 激活走 current 稳定目录，另给一个读项目锁的 bigenv CLI

Status: implemented

## Problem

用户装好 node 后问：「一定要在软件里打开注入的 shell 吗？其他软件（IDE、AI agent）调用 cmd 能不能拿到这个版本？」

原方案只有两条路，都不满足：

- **PowerShell profile 注入**：只有交互式 PowerShell 会读 profile；`cmd.exe`、`CreateProcess` 直接调起子进程的 IDE/AI agent、计划任务都拿不到。而且注入脚本写的是**带版本号的目录**（`...\node\26.12.1`），每次切版本都要重写，已经打开的终端不会跟着变。
- **「打开终端」按钮**：只影响那一个子进程，外部程序无从触发。

同时机器上还有个现实约束：`D:\VMR SDKs\versions\node_versions\node` 由 vmr 写进了**系统** PATH，而用户 PATH 永远排在系统 PATH 之后。bigEnv 就算写用户 PATH，`node` 也会被 vmr 抢走——这不是能靠写对顺序解决的，只能显式暴露冲突。

## Decision

提供两条互补的激活路径，默认都不碰注册表：

**A. 全局 PATH（可选，`settings.pathMode = 'off' | 'user' | 'machine'`）**

- 写进 PATH 的必须是 `<installRoot>\<sdk>\current` 这个**稳定的 junction 目录**，以及它的 bin 子目录；绝不写带版本号的实体目录。切版本只改 junction 目标，PATH 与已打开终端的下一条命令立即生效。
- `off` 时对注册表零写入；选 `user` 写 `HKCU\Environment`，选 `machine` 写 `HKLM\...\Session Manager\Environment`（需要管理员，失败原样报错且不改 settings）。
- 写入前先 `stripManaged` 掉本工具在**两个** scope 里的旧条目（识别规则：位于 installRoot 下且以 `\current` 或 `\current\<bin>` 结尾，外加旧 root 的遗留、以及 `<userData>\bin` 启动器目录），再 prepend 到目标 scope，避免重复与跨 scope 打架。值用 `REG_EXPAND_SZ`，超过 30000 字符直接拒绝。
- 写完必须广播环境变更：只 `reg add` 不会通知已运行的进程，所以再用 `[Environment]::SetEnvironmentVariable('Path', <读回的值>, 'User'|'Machine')` 触发 `WM_SETTINGCHANGE`。
- **遮蔽检测**：按 `machine` 在前、`user` 在后的顺序展开整个 PATH，检查 bigEnv 托管的目录之前是否已有同名可执行文件（`SDK_EXE_HINTS` 优先，否则取目录里前三个 `.exe`）。命中就在 UI 用红字点名「`node.exe` 被更靠前的 `D:\VMR SDKs\...` 抢先，bigEnv 的 node 不会生效」——不静默失败，也不自动去改别人的 PATH。

**A2. 只发布勾选的 SDK（`settings.pathSdks: string[]`，第三轮反馈后加入）**

- 第一版把**所有** current 目录都写进 PATH，用户反驳得很直接：「path 的配置不是应该在 sdk 中吗……可以选择我们已安装的 SDK 进行 path 配置」。全局可见性变成了隐性副作用：装一个、全局多一个，还可能与已有工具链抢名字。
- 现在 PATH 条目 = `pathSdks ∩ 已安装且有 current` 的 `current` 目录；空列表时只发布 `<userData>\bin` 这一个 CLI 启动器目录，仍然能 `bigenv run`。
- 独立成「全局环境」页（`pages/GlobalEnv.tsx`，page key `globals`），按 SDK 逐行勾选并显示将会写入的路径；Shell 集成页只留 profile 注入与环境脚本，不再承载全局 PATH。
- 旧 settings 没有 `pathSdks` 键时（`hasExplicitPathSdks()` 为 false），启动时用当时激活的 SDK 播种一次，保持升级前后的 PATH 行为一致；用户之后取消勾选就是显式意图，不会再被覆盖。

**B. `bigenv` CLI（`src/cli/index.ts` → `out/cli.cjs` → 打包进 `resources/cli.cjs`）**

- 独立 Node 脚本，不 import electron，只读 `%APPDATA%\bigEnv\settings.json` 的 installRoot 与磁盘上的 `.bigenv.json`，所以能在任何进程里跑。
- `bigenv run -- <cmd>`：从 cwd 向上 12 层找 `.bigenv.json` / `bigenv.json` / `.vmr.lock`，按锁注入（缺版本只在 stderr 提示并跳过该 SDK），无锁则注入全部 current；这是给 AI agent / 构建脚本用的入口。
- `env [--json|--cmd|--ps]` 输出可被父进程消费的环境；`which <sdk>` 打印解析到的可执行文件；`list` 标 `*` 当前；`use <sdk@version>` 直接改 junction（rm + `fs.symlink(...,'junction')`）。
- `<userData>/bin/bigenv.cmd` 是启动器：`set "ELECTRON_RUN_AS_NODE=1"` + `"<process.execPath>" "<cli.cjs>" %*`，复用应用自带的 Electron 二进制当 Node 运行时，不要求用户另装 Node。选 `user`/`machine` 模式时把这个 bin 目录一并写进 PATH，所以 `bigenv` 命令本身也全局可用。

两者都不影响「关闭全局激活后一切回到原样」：`setPathMode('off')` 逐条删除托管条目，实测用户 PATH 与备份逐字节相等。

## Alternatives considered

- **只做 profile 注入，让用户自己 dot-source**：零风险，但对 cmd.exe 与 IDE 完全无效，等于没回答用户的问题。
- **`setx` / 直接 `Environment.SetEnvironmentVariable` 写用户 PATH**：最短实现，但 `setx` 会截断到 1024 字符、把 `REG_EXPAND_SZ` 降级成 `REG_SZ`（`%USERPROFILE%` 之类展开变量被固化），且无法可靠识别并清理自己的旧条目。改用 `reg add` 保留类型，再用 SetEnvironmentVariable 仅做广播。
- **写进系统 PATH 并把 vmr 的条目挤下去**：能「赢」，但擅自改动另一个工具的安装痕迹，卸载 bigEnv 后用户的其它工具链可能坏掉。选择只报告冲突。
- **CLI 用 Go/Rust 编译成单文件**：对用户零依赖，但要引入第二套工具链与交叉编译。复用 Electron 自带的 Node 与 `ELECTRON_RUN_AS_NODE=1` 已足够，代价是启动多几十毫秒。
- **CLI 复用主进程（IPC 到已运行的 app）**：省去重复解析逻辑，但 app 没启动时 CLI 就不可用——而这正是 CI/agent 场景的常态。改为直接读磁盘状态，逻辑与主进程各自一份（`envApplies` 等少量规则重复，见 Consequences）。
- **默认把所有 current 都写进 PATH**：实现最短，但全局命名空间被安装动作悄悄改写，用户无法只暴露 node 而隐藏另一个同名工具；也已与「装完就有、删了还在」的 stale 感知冲突。改为显式勾选。
- **全局 `cd` hook 自动切版本**：见 [Shell 注入与项目锁](2026-10-29-env-injection-and-project-lock.md)，已否。

## Consequences

- 收益：`node`/`go` 这类运行时对 IDE、AI agent、`cmd.exe`、计划任务都可见；切版本不再需要重开终端；冲突可见而非静默失效。
- 收益（A2）：全局可见性变成逐 SDK 的显式选择，卸载某个版本不会留下悬空条目（`pathSdks` 里已不在本机安装的项在 UI 标为「已不在本机安装」并可一键取消）。
- 代价与边界：
  - 全局 PATH 是**显式选择**，默认 `off`；`machine` 需要管理员，非管理员时报错而不是降级成用户 PATH。
  - 已经运行的进程（包括已开的 IDE）不会重读 PATH，必须重启它们——UI 文案已写明。
  - `current` 是 junction，Windows 上少数工具（老版本 `robocopy`、某些按 realpath 缓存的包管理器）可能对链接目录挑剔，尚无实证问题。
  - CLI 与主进程各有一份「按 SDK 解析 PATH/环境变量」的逻辑（`src/cli/index.ts` 的 `envFor` 与 `src/main/envManager.ts` 的 `resolveFor`）。共享代码需要把 electron 依赖剥出去，暂时保留重复，改动时两处都要动。
  - PATH 条目识别依赖 `\current` 后缀这一形状；若将来布局改动（例如 per-project 链接），`makeManagedMatcher` 必须同步。
  - 卸载不自动清 PATH：用户需先切到 `off` 再卸载。这是有意的——卸载程序不该猜哪些条目是自己的。
