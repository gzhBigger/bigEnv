# AGENTS.md

给在这个仓库里干活的 agent（以及新加入的人）看的工程约定。**先读这一页再动手**，尤其是「发版」和「踩过的坑」两节。

## 1. 项目是什么

bigEnv 是一个 Electron + React + TypeScript 的桌面端运行环境管理器：浏览 SDK 版本（数据来自 [gvcgo/vsources](https://github.com/gvcgo/vsources) 的预计算 JSON）→ 下载校验 → 解压安装到 `~/.bigenv/<sdk>/<version>` → 用 `<sdk>/current` junction 切换当前版本 → 按 SDK 决定是否写进用户/系统 PATH → 按项目目录读 `.bigenv.json` 注入子进程环境 → 体检与清理。

它**不**兼容 vmr 的 Lua 插件运行时，也不读 `.vmr.lock`；这是有意的取舍（见 `.agents/notes/`）。

## 2. 目录地图

```
src/
  main/          主进程（Node 侧）
    index.ts       app 生命周期、单实例锁、窗口、加载页面、CSP
    ipc.ts         全部 bigenv:* IPC handler、广播、窗口状态
    app.ts         AppRuntime：把下面这些服务装在一起并处理设置变更
    store.ts       settings.json 读写与 sanitize
    paths.ts       userData 下的目录布局、平台与架构映射
    http.ts        undici + 代理 + 断点续传 + sha256 校验
    archive.ts     zip（yauzl）/ tar.gz（tar）解压，防 zip-slip
    versions.ts    vsources 元数据解析、版本比较、镜像改写
    catalog.ts     SDK 目录聚合、安装计划、能力判定
    jobs.ts        安装队列（并发、取消、进度事件）
    registry.ts    安装记录扫描、.bigenv.json、current junction
    envManager.ts  全局 PATH 条目、项目终端注入、CLI 启动器
    globalPath.ts  HKCU/HKLM Path 读写与托管条目识别
    elevated.ts    需要管理员权限时的一次性升权副本
    projects.ts    多项目登记与锁文件读写
    health.ts      孤儿目录、失效链接、缓存统计
    updates.ts     GitHub Releases 检查（API → HTML → package.json 三级回退）
  preload/       contextBridge，暴露 window.bigenv
  renderer/      React 19 + zustand；lib/mock.ts 提供浏览器预览用的假 bridge
  cli/           bigenv CLI（不依赖 electron，打包后进 resources/cli.cjs）
  shared/        主进程与渲染进程共享的类型与常量
build/           图标与品牌资源（icon.png / icon.ico / logo*.svg / logo.png）
scripts/         构建、开发、截图与品牌资源生成脚本
.agents/notes/   决策笔记（见第 7 节）
docs/screenshots/ README 用截图
```

## 3. 常用命令

```powershell
pnpm install                 # 依赖（electron 二进制可能需要手动补装，见第 8 节）
pnpm dev                     # vite + esbuild watch + electron
pnpm typecheck               # node 与 web 两套 tsc，必须零错误
pnpm build                   # out/main.cjs、out/preload.cjs、out/cli.cjs、out/renderer
pnpm start                   # build 后启动打包前的应用
pnpm dist                    # build 后出 release/：portable + NSIS
pnpm icon                    # 重新生成 build/icon.{png,ico}、logo.png、logo-mark.png
pnpm verify-notes            # 笔记树与格式校验，提交前必跑
```

`pnpm` 实际会退化成 npm 脚本执行，两条命令等价。

## 4. 代码约定

- **类型只放 `src/shared/types.ts`**：Bridge 的契约改动必须同时改 preload 与 `lib/mock.ts`，否则浏览器预览和桌面版行为分叉。
- **IPC 命名**：`bigenv:<域>:<动作>`；新增通道时在 `preload` 与 `types.Bridge` 里同步声明，并在 `ipc.ts` 里做输入校验（`assertSdk` / `assertVersion` / `assertDir`）。
- **不要在主进程里 `shell: true` 拼字符串**：统一用 `util.runCommand`，它处理 Windows 的 `.cmd` 与超时。
- **CLI 不 import electron**：`src/cli/index.ts` 直接读磁盘与 `settings.json`，这样 `resources/cli.cjs` 能在任何 Node 环境跑。
- **渲染进程不直接调 `window.bigenv`**：一律经 `lib/bridge.ts`，这样浏览器里能落到 mock。
- **不要擅自改用户配置**：调试时打开过的 PATH 注入 / profile 开关，结束时必须恢复原状；改注册表前先备份 `%TEMP%`。
- **界面文案用中文**，代码与注释用英文。

## 5. 发版流程（每次发布都要照做）

1. **确认干净**：`git status` 无未提交改动；`pnpm typecheck`、`pnpm verify-notes` 全绿。
2. **改版本号**：`package.json` 的 `version` 用语义化版本（bug 修复 `0.2.x`，新功能 `0.x.0`）。应用内「关于」与侧边栏版本号都读 `package.json`，不需要另改。
3. **同步文档**：README 的功能/截图如受影响就更新；非平凡改动要在 `.agents/notes/` 留笔记（见第 7 节）。
4. **出包**：`pnpm dist`。产物在 `release/`：
   - `bigEnv <version>.exe`（portable，单文件）
   - `bigEnv Setup <version>.exe`（NSIS 安装器）
   - `win-unpacked/`、`latest.yml`、`*.blockmap`
5. **冒烟**：启动 `release\win-unpacked\bigEnv.exe`，确认能开窗、目录页有数据、CLI 可用：
   ```powershell
   $env:ELECTRON_RUN_AS_NODE="1"
   release\win-unpacked\bigEnv.exe release\win-unpacked\resources\cli.cjs list
   ```
6. **提交**：`git add -A`，提交信息用 `feat:` / `fix:` / `refactor:` / `docs:` / `build:` 前缀（参考 `git log`），一次发版一个提交。
7. **打 tag 并推送**：
   ```powershell
   git tag v0.2.0
   git push origin main
   git push origin v0.2.0
   ```
8. **创建 GitHub Release**（`gh` 已登录）：
   ```powershell
   gh release create v0.2.0 "release\bigEnv 0.2.0.exe" "release\bigEnv Setup 0.2.0.exe" `
     --title "bigEnv 0.2.0" --notes "本次变更……"
   ```
   应用内「检查更新」读的就是 Releases：**不建 Release，用户端永远显示「仓库还没有发布版本」**。
9. **验证更新检查**：设置页点「检查更新」应显示「已是最新版本」；或 `updates.check(true)` 返回 `status:'latest'`。

发版前三问：版本号改了吗？笔记与 README 同步了吗？Release 资产上传了吗？

## 6. 品牌资源

- 标志语义：三层版本栈 + 绿色「当前」圆点，对应 `<sdk>/<version>` 与 `current` 链接。
- 源文件：`build/logo-mark.svg`（应用图标构图）、`build/logo.svg`（横向组合）、`build/logo-mono.svg`（单色）。
- 重新生成：`pnpm icon`（用 Electron 离屏渲染 SVG，再缩放打包成 ICO）。改了 SVG 必须重跑，否则 `icon.ico` 还是旧的。
- 应用内标志是 `src/renderer/components/BrandMark.tsx`（内联 SVG），改图形时与 `logo-mark.svg` 保持一致。

## 7. 笔记与决策记录

非平凡改动（行为、架构、跨文件契约、发版流程、落盘/网络/配置格式）**先写或更新 `.agents/notes/` 里的笔记，再提交**：

- 进行中的方案放 `proposed/`，落地后移到 `implemented/`。
- 每篇要有 `Status:` 行与 `## Problem` / `## Decision` / `## Alternatives considered` / `## Consequences` 四段；被否方案要先写它最强的理由。
- 新方案取代旧决策时，同批在旧笔记开头标注「已被取代」并链到新笔记。
- 提交前 `pnpm verify-notes` 必须通过。

## 8. 踩过的坑（省时间用）

- **`ELECTRON_RUN_AS_NODE=1`**：本机 DSH 进程带这个变量，直接 `electron .` 会变成纯 Node 运行并报 `Cannot read properties of undefined (reading 'isPackaged')`。启动前 `$env:ELECTRON_RUN_AS_NODE=$null`；生成图标同理。
- **单实例锁**：残留 `bigEnv.exe` / `electron.exe` 会持有锁，新实例启动即静默退出。重启前 `Get-Process bigEnv,electron | Stop-Process -Force`。
- **打包 EBUSY**：`release\win-unpacked` 的文件句柄偶尔不释放，`Remove-Item` 失败时先 `Rename-Item release release-old` 再删，然后重跑 `pnpm dist`。
- **CDP 调试**：`electron . --remote-debugging-port=9333` 偶尔监听不上，换 9337 即可；截图与断言用 `scripts/capture.mjs` / `scripts/eval.mjs`（`eval.mjs` 的表达式必须自带 `return`）。
- **别杀自己**：按命令行筛进程时加 `$_.ProcessId -ne $PID`，否则 `Stop-Process` 会把执行命令的 shell 也杀掉（exit 4294967295）。
- **esbuild 的 `tree-sitter`**：`SDK_EXE_HINTS` 里 `tree-sitter` 作为对象键必须带引号，否则 `Expected "}" but found "-"`。
- **zsh/PowerShell 生成脚本**：数组字面量不要留尾逗号（`env.ps1` 曾因此整份 profile 解析失败）。
- **Windows 上 electron 二进制**：pnpm 的构建脚本白名单在 `pnpm-workspace.yaml` 的 `allowBuilds`；必要时手动跑 `node node_modules\electron\install.js`。

## 9. 已知限制

- 解压只支持 zip / tar.gz（xz、7z 会明确报「暂不支持」）。
- conda-only 的 SDK 需要本机已装 conda；官方安装程序型产物（vscode/msys2 等）不会静默安装。
- 未签名：Windows SmartScreen 会提示；没有自动更新，只有「检查更新 + 下载 + 打开发布页」。
- 主要面向 Windows；macOS/Linux 分支存在但未实机验证。
