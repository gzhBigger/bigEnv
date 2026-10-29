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

**A3. 行内按钮与即时反馈（第五轮反馈后加入）**

- 用户两次反馈同一件事：「我点击以后没法看到是否在执行」「这个勾选能改成按钮吗」。根因不是写入慢到不可接受，而是**没有任何中间态**：点下去要等注册表读改写 + 广播结束才重渲染，界面上按钮和状态都不动。
- 复选框换成按钮：未启用显示主色「启用」，已启用显示「停用」，行尾再跟一个状态 tag（`已发布` / `仅记录` / `未发布` / `写入中`）。勾选框在深色卡片里太像表单，按钮把「这是一次动作」表达得更直白。
- `store.ts` 里 `pathModePending` / `pathSdksPending` / `pathError` 三个字段驱动 pending 与错误：写入时行 tag 变成带 spinner 的「写入中」，目标行半透明（`.env-row.pending`），同一时刻其它按钮 `disabled`，避免并发写注册表。
- 保底展示：`keepPending(startedAt)` 让 pending 至少存在 520ms。实测一次写入约 0.9–1.1s，去掉保底后 250ms 内就结束，用户会以为点击没被接收。
- 错误本地化：IPC 抛出的错误带 `Error invoking remote method 'bigenv:env:setPathMode': Error: ` 前缀，`errorText()` 剥掉后在卡片里显示红字「PATH 写入失败：写入系统 PATH 需要管理员权限」并给「重试」按钮（闭包记录上一次动作），不再依赖一闪而过的 toast。
- 顺带解决一个真正的延迟源：`WM_SETTINGCHANGE` 的广播原来 `await` 一个 `powershell.exe -NoProfile` 冷启动，实测单次 2–5s，把「写入完成」硬生生拖到 6s。现在广播是 best-effort：`spawn(..., { detached: true, stdio: 'ignore' }).unref()` 后立即返回，注册表值已经写好，新开的 shell 自己会读。

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
- **逐行复选框 + 点击后只转全局 busy**：第一版就是这样，被用户两次点名「看不到是否在执行」。复选框还让这一页看起来像批量表单。改为按钮 + 行级 pending + 保底展示时间。
- **同步 `await` PowerShell 广播**：语义上更"完成"，但冷启动 PowerShell 要 2–5s，把一次几百毫秒的注册表写入拖成 6 秒。广播只是通知，注册表值已经是事实，改为 fire-and-forget。
- **全局 `cd` hook 自动切版本**：见 [Shell 注入与项目锁](2026-10-29-env-injection-and-project-lock.md)，已否。

## Consequences

- 收益：`node`/`go` 这类运行时对 IDE、AI agent、`cmd.exe`、计划任务都可见；切版本不再需要重开终端；冲突可见而非静默失效。
- 收益（A2）：全局可见性变成逐 SDK 的显式选择，卸载某个版本不会留下悬空条目（`pathSdks` 里已不在本机安装的项在 UI 标为「已不在本机安装」并可一键移除）。
- 收益（A3）：每次写 PATH 都有可见的进行中 / 成功 / 失败三态，失败可原地重试；「启用 / 停用」按钮比复选框更明确地表达「这次点击会写注册表」。
- 代价（A3）：广播不再 await，因此刚写完时若立刻在**已打开**的终端里查 PATH，可能还看不到新值；新开的终端不受影响。这是用旧终端即时感知换 UI 响应速度。
- 代价与边界：
  - 全局 PATH 是**显式选择**，默认 `off`；`machine` 需要管理员，非管理员时报错而不是降级成用户 PATH。
  - 已经运行的进程（包括已开的 IDE）不会重读 PATH，必须重启它们——UI 文案已写明。
  - `current` 是 junction，Windows 上少数工具（老版本 `robocopy`、某些按 realpath 缓存的包管理器）可能对链接目录挑剔，尚无实证问题。
  - CLI 与主进程各有一份「按 SDK 解析 PATH/环境变量」的逻辑（`src/cli/index.ts` 的 `envFor` 与 `src/main/envManager.ts` 的 `resolveFor`）。共享代码需要把 electron 依赖剥出去，暂时保留重复，改动时两处都要动。
  - PATH 条目识别依赖 `\current` 后缀这一形状；若将来布局改动（例如 per-project 链接），`makeManagedMatcher` 必须同步。
  - 卸载不自动清 PATH：用户需先切到 `off` 再卸载。这是有意的——卸载程序不该猜哪些条目是自己的。
