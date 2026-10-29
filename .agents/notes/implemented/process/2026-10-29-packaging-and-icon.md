# Agent Note: 用 electron-builder 出 Windows 双产物，图标由 Electron 自己渲染

Status: implemented

## Problem

开发态能跑不等于能交付：用户手上没有可运行的入口，也没有 Node/pnpm 环境去 `pnpm dev`。需要产出「双击就能跑」的东西，并且在没有真实用户帮你点按钮的情况下先自己验收一遍。

同时这个应用原先是 Electron 默认图标，安装包与任务栏里都是 Electron 的 logo，不像一个能交付的桌面软件。

## Decision

**用 electron-builder 一次产出两种 Windows 形态，并把图标生成也变成仓库脚本。**

- `pnpm dist` = `build`（esbuild + vite）→ `electron-builder --win`，输出到 `release/`：
  - `bigEnv <version>.exe`：portable 单文件，自解压到临时目录运行，不写注册表、不需要安装。
  - `bigEnv Setup <version>.exe`：NSIS 安装包，`oneClick:false` + `allowToChangeInstallationDirectory:true`，装到用户目录、带卸载器与开始菜单快捷方式。
  - `win-unpacked/`：免安装目录版，用于排查「安装包坏了还是应用坏了」。
- `build/` 目录只放图标资产；`package.json` 的 `build.files` 显式声明 `out/**/*`、`package.json`、`build/icon.png`，避免把 `src`、`node_modules` 里没被 bundle 的东西塞进 asar。
- 主窗口 `icon` 取 `app.getAppPath()/build/icon.png`，dev 与 packaged 走同一条路径；exe 图标由 `build/icon.ico` 提供。
- 图标不引第三方绘图库：`scripts/make-icon.mjs` 起一个 512×512 的透明无边框 `BrowserWindow`（`offscreen:true`），加载一段内联 HTML（深色圆角底 + `background-clip:text` 的渐变 "b" + 绿色圆点），`capturePage()` 拿到主图，再用 `nativeImage.resize` 生成 256/128/64/48/32/16 六档 PNG，手工按 ICO 头结构（PNG 压缩条目）打包成 `build/icon.ico`。
- 不配置代码签名：本仓库没有证书，`electron-builder` 会跳过签名并打印 warning，产物在 SmartScreen 前会提示「未知发布者」。

## Alternatives considered

- **只给 `win-unpacked/` + 压缩包**：最省事，但要用户自己解压、自己找 exe，且杀软对未签名 zip 里的 exe 更敏感。portable 单文件已经把「自解压」这一步做掉了，没必要让用户手工做。
- **Squirrel.Windows / MSIX**：前者已停止维护且 electron-builder 支持不佳；MSIX 要证书与 Windows SDK，本地无法验证。
- **把图标做成 SVG 直接交给 electron-builder**：builder 要求 `.ico`/`.png`，不认 SVG；引入 `sharp` 或 ImageMagick 又增加原生依赖与构建环境要求。用 Electron 自己渲染，既不增依赖，又能直接用 CSS 做渐变文字。
- **用 PowerShell + System.Drawing 画图标**：能写字但排版与抗锯齿差，且 Windows-only 脚本不够干净。

## Consequences

- 收益：交付物是单个 106 MB 的 portable exe 或 117 MB 的 NSIS 安装包；图标与窗口/任务栏/exe 资源一致。
- 代价：`release/` 被 `.gitignore` 排除，产物不进版本库，需要单独传递；每次 `dist` 都要重新下载 Electron 发行包（可用 `ELECTRON_MIRROR`/`ELECTRON_BUILDER_BINARIES_MIRROR` 指向 npmmirror）。
- 验证事实：`win-unpacked` 与 portable 都能加载 83 个 SDK、安装 `fd 10.5.0` 并生成 `current` junction；NSIS 用 `/S /D=<临时目录>` 静默安装后文件齐全，卸载后目录、开始菜单、桌面快捷方式与 `HKCU` 卸载项均无残留。
- 未覆盖：没有自动更新（未接 electron-updater）、没有签名、macOS/Linux 产物未构建过；`latest.yml`/`blockmap` 已被生成，后续接更新通道时可以直接复用。
