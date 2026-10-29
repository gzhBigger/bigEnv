# Agent Note: 用 CDP 脚本验证 Electron 界面，并把 verify-notes 接进入口

Status: implemented

## Problem

Electron 界面无法只用单元测试证明：真实元数据能不能拉到、安装任务能不能跑完、环境脚本有没有语法错误，都要在真实窗口里点一遍看一遍。同时本仓库要求非平凡改动带 `.agents/notes/` 笔记，且笔记格式有脚本门禁。

另外本机 DSH 环境默认设置了 `ELECTRON_RUN_AS_NODE=1`，直接 `npx electron .` 会以纯 Node 启动主进程，报 `TypeError: Cannot read properties of undefined (reading 'isPackaged')`，很容易误判成代码错误。

## Decision

**用 DevTools Protocol 驱动真实窗口，而不是引入 Playwright/Spectron。**

- `scripts/capture.mjs`：连接 `--remote-debugging-port`，可选 `--eval "<js>"` 先执行一段页面脚本（点导航、开抽屉），再 `Page.captureScreenshot` 落 PNG。
- `scripts/eval.mjs`：在渲染进程里执行任意表达式并打印 JSON 结果，用来直接调 `window.bigenv.*`（例如启动安装、切 current、跑体检），从而在不写额外测试页的前提下验证主进程行为。
- 启动命令固定为：先 `$env:ELECTRON_RUN_AS_NODE=$null`，再 `npx electron . --remote-debugging-port=9333`。这条写进 README 的「验证」小节。
- `npm run verify-notes` 串起三个校验脚本（树、格式、归档），提交前必须通过。

## Alternatives considered

- **Playwright 的 Electron 支持**：API 完整、断言方便，但要额外装浏览器与测试运行器，且对这个项目来说「截图 + eval」已经能覆盖全部关键路径。放弃，保留后续如果要做回归测试时再引入。
- **直接 `webContents.capturePage()` 写一个隐藏命令**：要在主进程里加调试代码，验证工具反而污染生产代码；CDP 方案对主进程零侵入。
- **浏览器里跑 mock bridge 做视觉验证**：`src/renderer/lib/mock.ts` 已支持（`!window.bigenv` 时启用），适合调样式，但证明不了真实下载/解压/链接，只能作为补充。

## Consequences

- 代价：验证依赖手动起窗口与端口；截图是黑盒，断言只能靠 eval 的返回值。
- 收益：验证脚本只有两个小文件，无额外依赖；能在同一次会话里既看界面又打印结构化结果。
- 注意：截图目标若通过 `mcp__rea__capture_web_screenshot` 访问会被 `target_not_allowed` 拒绝（file:// 目标），所以自建 `capture.mjs` 是必须的。
