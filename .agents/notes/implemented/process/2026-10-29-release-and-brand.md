# Agent Note: 发版流程固化与「版本栈」品牌标志

Status: implemented

## Problem

项目迭代到 0.2.0 时出现了两个缺口：

1. 没有写下来的发布约定——版本号改哪里、产物叫什么、tag 与 GitHub Release 要不要建、应用内「检查更新」为什么一直显示「仓库还没有发布版本」，全靠口口相传。
2. 应用图标还是一个渐变字母 `b` 加绿点，只表示品牌首字母，不表达产品在做什么；侧边栏的标志还是 lucide 的终端图标，与图标不一致；侧边栏版本号写死成 `0.1.0`。

## Decision

**把发版流程写进仓库根目录的 `AGENTS.md`，并用「版本栈 + 当前圆点」作为统一标志。**

- 发版固定为十步：类型检查与笔记校验 → 改 `package.json` 的 `version`（语义化）→ 文档/笔记 → `pnpm dist` → 打包版冒烟（含 CLI）→ 提交 → `git tag vX.Y.Z` 并推送 → `gh release create` 上传两个 exe → 验证应用内更新检查。
- 版本号只有一个来源：`package.json`。主进程 `bigenv:runtime:*` 改用 `app.getVersion()`（原先读 `process.env.npm_package_version`，打包后该变量不存在，侧边栏会永远显示 `0.1.0`），侧边栏显示 `bridge.runtime.version`。
- 标志语义：三条圆角横杠代表同一 SDK 的多个已装版本，右下绿色圆点代表 `current` 指向的那个版本；配色沿用界面令牌（蓝 `#4c9aff` → 绿 `#35d0a5`）。源文件为 `build/logo-mark.svg`、`build/logo.svg`、`build/logo-mono.svg`，`pnpm icon` 用 Electron 离屏渲染成 `icon.png` / `icon.ico` / `logo.png` / `logo-mark.png`；应用内 `src/renderer/components/BrandMark.tsx` 与 SVG 同源。
- README 顶部放标志图；`AGENTS.md` 的第 6 节说明「改 SVG 必须重跑 `pnpm icon`」。

## Alternatives considered

- **继续用字母 `b` 做图标**：辨识度依赖字体渲染，小尺寸下发虚，也看不出「版本管理」这层含义；字母标在同类工具里太常见。
- **用 vmr 式的终端提示符 / 齿轮**：终端符号与「环境变量」有关，但与「多版本共存」无关；齿轮太泛，容易被当成设置工具。
- **直接内联 SVG 到 README 而不是 PNG**：GitHub 对 `<img src="*.svg">` 的处理不一致（部分场景会被安全策略挡掉），PNG 更稳；SVG 仍作为源文件保留。
- **在 `package.json` 里再维护一份 `productVersion`**：两处版本号必然漂移，应用内与安装包对不上；只保留 `version`。
- **靠 `latest.yml` 让客户端自更新**：需要签名与自动更新通道，当前未签名，SmartScreen 会拦；发布仍走「检查更新 → 下载 → 打开发布页」。

## Consequences

- 收益：发版有清单可循，漏建 Release 会被「检查更新显示没有发布版本」当场暴露；标志在 16px 到 512px 都能读，安装包、任务栏、README 与应用内一致；版本号不再有第二处来源。
- 代价：`pnpm icon` 依赖 Electron 离屏渲染（CI 上需要图形环境或 xvfb），并且每次改标志要同时改 SVG、`BrandMark.tsx` 与已生成的 PNG/ICO；发布仍需手工执行 tag 与 `gh release create`，没有自动化流水线。
- 待办：如果以后要自动化，优先把「打 tag + `gh release create`」搬进 GitHub Actions，用 `GITHUB_TOKEN` 上传 `release/*.exe`。
