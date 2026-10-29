# Agent Note: bigEnv 桌面端的技术栈与主进程分层

Status: implemented

## Problem

目标是把 [version-manager](https://github.com/gvcgo/version-manager)（vmr，Go + Bubble Tea TUI）的能力搬到桌面上：浏览几十种 SDK 的版本、下载安装、切换当前版本、给 Shell 注入 PATH、按项目锁定版本、体检磁盘。vmr 本身是命令行程序，直接复用它的 TUI 不现实，需要一套新的 UI 与进程模型。

约束：本机只有一个 TS/Node 工具链（node 24、pnpm 11），没有 Rust、没有 .NET；下载与解压需要长任务、进度回调、可取消；要访问文件系统、创建 junction、拉起新终端，这些在浏览器沙箱里都做不到。

## Decision

用 **Electron 45 + React 19 + TypeScript**，主进程承担全部系统能力，渲染进程只做 UI。

- **主进程按职责拆模块**（`src/main/`）：`paths`（userData 下的数据目录与默认安装根）、`store`（settings.json）、`http`（undici + 可选 ProxyAgent + 断点/校验和下载）、`archive`（yauzl / tar）、`versions`（元数据拉取、缓存、版本比较、镜像改写）、`catalog`（把元数据翻译成可安装性判定）、`registry`（`<installRoot>/<sdk>/<version>` 扫描与 `current` 链接）、`jobs`（并发队列、进度、取消、失败清理）、`envManager`（环境脚本与 profile 注入）、`projects`（锁文件）、`health`（体检与清理）、`ipc`（通道注册）、`app`（AppRuntime 组合根）。
- **渲染进程与主进程的契约只有一处**：`src/shared/types.ts` 的 `Bridge` 接口。preload 用 `contextBridge` 暴露 `window.bigenv`，每个方法对应一个 `bigenv:*` `ipcMain.handle`；单向事件走四条通道（`bigenv:job` / `bigenv:installed` / `bigenv:catalog` / `bigenv:settings`）。
- **构建**：主进程/preload 用 esbuild 打成 CJS（`out/main.cjs`、`out/preload.cjs`），渲染进程用 Vite（`out/renderer`）。两者都走 `npm run build`，`npm run dev` 同时起 vite 与 esbuild watch 再拉 Electron。
- **窗口**：`titleBarStyle: 'hidden'` + `titleBarOverlay` 自绘标题栏；`contextIsolation: true`、`nodeIntegration: false`、`sandbox: false`（preload 需要 Node，但渲染进程仍无 Node）；生产模式由主进程注入 CSP，`index.html` 里不放 CSP meta（否则 dev 的 HMR 内联脚本被拦）。
- **界面信息架构（第二轮反馈后）**：取消独立的「已安装」页，已安装版本并入「SDK 目录」——卡片直接列出已装版本 chips，并提供「已安装」筛选；「项目环境」页管理 `settings.projects` 里登记的多个目录，用勾选式表格决定每个目录激活哪些 SDK（保存为目录下的 `.bigenv.json`，格式见 [环境注入与项目锁](../feature/2026-10-29-env-injection-and-project-lock.md)）；安装队列的悬浮面板可关闭，队列页可一键清空已完成记录。

## Alternatives considered

- **Tauri**：包体小、内存占用低，是 Electron 的正经替代。放弃原因是本机没有 Rust 工具链，且 vmr 的下载/解压/符号链接逻辑要在 Rust 侧重写一遍；团队现有能力集中在 TS，Electron 能直接复用 `undici`、`yauzl`、`tar` 这些已验证的库。
- **纯 Web（本地服务 + 浏览器）**：UI 迭代最快，但浏览器拿不到「在任意目录创建 junction」「拉起注入好环境的终端」「扫描安装根」这些能力，等于把核心价值削掉一半。
- **复用 vmr 的 TUI（打包 Go 二进制并嵌终端）**：等于做一个终端模拟器外壳，UI 与交互都无法演进，也拿不到结构化的已安装/任务状态。

## Consequences

- 代价：安装包约 120MB 起步（Electron 本身），需要 electron-builder 与签名流程；窗口/进程生命周期要自己管（单实例锁、`window-all-closed`、`before-quit` 释放 http client）。
- 收益：主进程就是一个 Node 服务，所有系统操作可直接复用成熟的 npm 库；渲染进程只依赖一个 `Bridge` 接口，后续可以用 mock bridge 在普通浏览器里做纯前端调试（`src/renderer/lib/mock.ts`）。
- 已知取舍：`sandbox: false` 换取 preload 的 Node 能力，安全性依赖 `contextIsolation` 与 CSP，不引入远程内容。
