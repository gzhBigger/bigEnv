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

**A4. 选中态与点击即申请管理员权限（第六轮反馈后加入）**

- 用户看截图说「tab 最好支持选中状态，这样我能看到当前是什么模式」。按钮上其实有 `className={pathMode === id ? 'active' : ''}`，但样式表只定义了 `.tabbar button.on`（目录页在用 `.on`），所以选中态从第一版起就没生效过——只改 class 名，再补 `aria-pressed` 与 `role="group"`。
- 「系统 PATH 选的时候提示没有权限，这个能够点击的时候申请权限吗」：点击本身就是用户意图，不该先失败再让用户自己找管理员终端。现在 `bigenv:env:setPathMode` 遇到 `写入系统 PATH 需要管理员权限` 时，用 `Start-Process -Verb RunAs -Wait -PassThru` 拉起自己的升权副本。
- 升权副本靠参数区分：`--bigenv-elevated-path=apply|strip`，在 `index.ts` 里**早于单实例锁**分支（否则会被正在运行的实例顶掉），不开窗口、不注册 IPC，写完 HKLM 就用退出码回报（0 成功 / 1 失败 / 4 模式已变）。退出码 4 是防陈旧写：升权副本重新读 settings，只有当 `pathMode === 'machine'` 才落笔。
- 反过来，**离开** machine 模式也必须升权（HKLM 无法普通权限编辑）；`strip` 动作走同一个副本。
- 顺序问题被实测抓出来两次：① 先写 settings 还是先写注册表——升权副本会校验 settings，所以意图必须先落盘，失败再回滚；② 先清另一个 scope 还是先写目标 scope——原来先 strip 用户 scope，机器写失败后两边都没了，现在先写目标、成功后再清旧 scope。
- `.tabbar button.on` 现在用 accent 22% 混色 + 内描边 + 600 字重；系统 PATH 的 pending 文案追加「会弹出 Windows 管理员授权，请点「是」」。

**B. `bigenv` CLI（`src/cli/index.ts` → `out/cli.cjs` → 打包进 `resources/cli.cjs`）**

- 独立 Node 脚本，不 import electron，只读 `%APPDATA%\bigEnv\settings.json` 的 installRoot 与磁盘上的 `.bigenv.json`，所以能在任何进程里跑。
- `bigenv run -- <cmd>`：从 cwd 向上 12 层找 `.bigenv.json` / `bigenv.json` / `.vmr.lock`，按锁注入（缺版本只在 stderr 提示并跳过该 SDK），无锁则注入全部 current；这是给 AI agent / 构建脚本用的入口。
- `env [--json|--cmd|--ps]` 输出可被父进程消费的环境；`which <sdk>` 打印解析到的可执行文件；`list` 标 `*` 当前；`use <sdk@version>` 直接改 junction（rm + `fs.symlink(...,'junction')`）。
- `<userData>/bin/bigenv.cmd` 是启动器：`set "ELECTRON_RUN_AS_NODE=1"` + `"<process.execPath>" "<cli.cjs>" %*`，复用应用自带的 Electron 二进制当 Node 运行时，不要求用户另装 Node。选 `user`/`machine` 模式时把这个 bin 目录一并写进 PATH，所以 `bigenv` 命令本身也全局可用。

两者都不影响「关闭全局激活后一切回到原样」：`setPathMode('off')` 逐条删除托管条目，实测用户 PATH 与备份逐字节相等。

- **A5：删除 profile 注入（第九轮反馈后加入）**：用户指出「Shell 集成」与「全局环境」重复——已配环境变量就不必再注入 profile。确认两者最终都只是前置 PATH（已装 SDK 的 `.bigenv.json` 里 `envs` 为空时连 `GOROOT` 之类都没有），而 profile 只对交互式 PowerShell 生效、对 `cmd.exe`/IDE/AI agent 无效，故整体删除：设置项 `shellEnabled`、`Bridge.env.enable/disable`、`env:enable/disable` IPC、`Shell 集成` 页与导航、生成 `env.ps1/env.cmd/env.sh` 与写 profile 标记块的代码全部移除。为不把旧机器留在半改状态，`AppRuntime.create()` 调 `cleanupLegacyInjection()`：删除遗留的三个 env 脚本，并从两个 profile 里剥掉 `# >>> bigenv initialize >>>` 标记块；`settings.json` 里的 `shellEnabled` 在载入时被剔除并立即重写。保留 `computeInjection`/`openTerminal`，因为「项目环境 → 在此开终端」仍要靠它把锁里的版本注入子进程。

## Alternatives considered

- **只做 profile 注入，让用户自己 dot-source**：零风险，但对 cmd.exe 与 IDE 完全无效，等于没回答用户的问题。**后来连这个入口也删了**（A5）：它和全局 PATH 重复，而全局 PATH 覆盖面更大。
- **`setx` / 直接 `Environment.SetEnvironmentVariable` 写用户 PATH**：最短实现，但 `setx` 会截断到 1024 字符、把 `REG_EXPAND_SZ` 降级成 `REG_SZ`（`%USERPROFILE%` 之类展开变量被固化），且无法可靠识别并清理自己的旧条目。改用 `reg add` 保留类型，再用 SetEnvironmentVariable 仅做广播。
- **写进系统 PATH 并把 vmr 的条目挤下去**：能「赢」，但擅自改动另一个工具的安装痕迹，卸载 bigEnv 后用户的其它工具链可能坏掉。选择只报告冲突。
- **CLI 用 Go/Rust 编译成单文件**：对用户零依赖，但要引入第二套工具链与交叉编译。复用 Electron 自带的 Node 与 `ELECTRON_RUN_AS_NODE=1` 已足够，代价是启动多几十毫秒。
- **CLI 复用主进程（IPC 到已运行的 app）**：省去重复解析逻辑，但 app 没启动时 CLI 就不可用——而这正是 CI/agent 场景的常态。改为直接读磁盘状态，逻辑与主进程各自一份（`envApplies` 等少量规则重复，见 Consequences）。
- **默认把所有 current 都写进 PATH**：实现最短，但全局命名空间被安装动作悄悄改写，用户无法只暴露 node 而隐藏另一个同名工具；也已与「装完就有、删了还在」的 stale 感知冲突。改为显式勾选。
- **逐行复选框 + 点击后只转全局 busy**：第一版就是这样，被用户两次点名「看不到是否在执行」。复选框还让这一页看起来像批量表单。改为按钮 + 行级 pending + 保底展示时间。
- **同步 `await` PowerShell 广播**：语义上更"完成"，但冷启动 PowerShell 要 2–5s，把一次几百毫秒的注册表写入拖成 6 秒。广播只是通知，注册表值已经是事实，改为 fire-and-forget。
- **失败后让用户自己去「以管理员身份运行」**：能实现但把权限问题转嫁给用户；点击「系统 PATH」本身就是意图，改为当场弹 UAC。
- **把 machine 写操作放进主进程里的隐藏窗口 / `runas` 库**：前者要维护第二个渲染进程，后者是原生 C++ 依赖。用「自己的 exe + 参数」当升权副本，零依赖且天然复用同一份 Node 代码。
- **先清另一个 scope 再写目标 scope**：看起来"干净"，但目标写失败时两边条目都没了（实测把用户 PATH 清空过）。改为先写目标、成功再清旧 scope。
- **全局 `cd` hook 自动切版本**：见 [项目锁与临时环境注入](2026-10-29-env-injection-and-project-lock.md)，已否。

## Consequences

- 收益：`node`/`go` 这类运行时对 IDE、AI agent、`cmd.exe`、计划任务都可见；切版本不再需要重开终端；冲突可见而非静默失效。
- 收益（A2）：全局可见性变成逐 SDK 的显式选择，卸载某个版本不会留下悬空条目（`pathSdks` 里已不在本机安装的项在 UI 标为「已不在本机安装」并可一键移除）。
- 收益（A3）：每次写 PATH 都有可见的进行中 / 成功 / 失败三态，失败可原地重试；「启用 / 停用」按钮比复选框更明确地表达「这次点击会写注册表」。
- 收益（A4）：机器 PATH 不再要求用户预先用管理员身份重开应用——点一下、过一次 UAC 即可；选中态让「现在到底哪个 scope 生效」一眼可见。
- 代价（A4）：升权副本靠退出码通信，UI 只能拿到 0/1/4 三种结果，拿不到更细的失败原因（HKLM 写入的具体错误只在日志里）；每次切换 scope 都会弹一次 UAC，这是 Windows 的约束而非实现选择。
- 代价（A3）：广播不再 await，因此刚写完时若立刻在**已打开**的终端里查 PATH，可能还看不到新值；新开的终端不受影响。这是用旧终端即时感知换 UI 响应速度。
- 代价与边界：
  - 全局 PATH 是**显式选择**，默认 `off`；`machine` 需要管理员，非管理员时报错而不是降级成用户 PATH。
  - 已经运行的进程（包括已开的 IDE）不会重读 PATH，必须重启它们——UI 文案已写明。
  - `current` 是 junction，Windows 上少数工具（老版本 `robocopy`、某些按 realpath 缓存的包管理器）可能对链接目录挑剔，尚无实证问题。
  - CLI 与主进程各有一份「按 SDK 解析 PATH/环境变量」的逻辑（`src/cli/index.ts` 的 `envFor` 与 `src/main/envManager.ts` 的 `resolveFor`）。共享代码需要把 electron 依赖剥出去，暂时保留重复，改动时两处都要动。
  - PATH 条目识别依赖 `\current` 后缀这一形状；若将来布局改动（例如 per-project 链接），`makeManagedMatcher` 必须同步。
  - 卸载不自动清 PATH：用户需先切到 `off` 再卸载。这是有意的——卸载程序不该猜哪些条目是自己的。
