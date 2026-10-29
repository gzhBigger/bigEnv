# Agent Note: 直接消费 vsources 元数据，不移植 vmr 的 Lua 插件运行时

Status: implemented

## Problem

vmr 为每种 SDK 维护一个 Lua 插件（`plugins/*.lua`），在运行时抓官网/GitHub 的版本列表并生成下载条目。要做桌面版，有两条路：把 Lua 运行时（glua/`luapi`）搬进 Electron，或者换一种方式拿到版本元数据。

同时要决定磁盘布局：装在哪、怎么表达「当前版本」、怎么记录安装来源，才能既和 vmr 的语义兼容，又不依赖符号链接特权。

## Decision

**不引入 Lua。** 直接消费 vmr 官方数据仓库 [vsources](https://github.com/gvcgo/vsources) 的预计算结果：

- `sdk-list.version.json`：83 个 SDK 的清单（含 homepage 与 install conf 的 sha256）。
- `<sdk>.version.json`：`{ "<version>": [{ url, arch, os, sum, sum_type, installer, size, lts, extra }] }`，已按 darwin/linux/windows × amd64/arm64 预展开。
- `install/<sdk>.toml`：解压后如何定位根目录（`flag_files`）、PATH 要加哪些子目录（`binary_dirs`，空数组表示安装根自身）、要额外设置的变量（如 `GOROOT`、`JAVA_HOME`）。

元数据默认取 `https://raw.githubusercontent.com/gvcgo/vsources/main`，可切换 jsDelivr 与 gh-proxy 镜像；本地缓存 6 小时，失败时回退 stale 缓存，避免离线即空白。

**磁盘布局与 vmr 同构**：`<installRoot>/<sdk>/<version>/` 是实体，`<installRoot>/<sdk>/current` 用 Windows **junction**（`fs.symlink(target, 'dir', 'junction')`，免管理员权限）指向当前版本。每个版本目录写 `.bigenv.json`（`StoredInstall`：installer、binDirs、envs、sourceUrl、sha256、installedAt、archive）。没有 `.bigenv.json` 的目录标记为外部目录（`managed: false`），体检时算「残留」但不自动删。

**安装器覆盖范围按实测收敛**：Windows amd64 上 45 个 unarchiver、13 个 executable、17 个仅 conda、8 个无 Windows 包。
- `unarchiver`：实现 zip（yauzl）与 tar.gz/tar（`tar`）。xz/zst/7z 明确抛「暂不支持」，不静默失败。
- `executable`：只有真·单文件二进制（agg、bazel、kubectl、tinymist、typst-lsp、typst-preview 等）可以直接落地为 `<sdk>.exe`；其余是官方安装程序（cygwin、msys2、vscode、rustup、miniconda…），UI 标注「需手动运行安装」，不假装能托管。
- `conda`：只有检测到 `conda` 才显示可安装，调用 `conda create -q -y --prefix <dir> -c conda-forge <pkg>=<version>`；没有 conda 时给出原因而不是失败。

**镜像只在下载侧改写**（`MIRROR_RULES`）：nodejs.org → 华为云、go.dev/dl → golang.google.cn、flutter 的 storage.googleapis.com → storage.flutter-io.cn、github.com → gh-proxy 前缀。是否启用由设置里的 `mirror: 'cn' | 'off'` 控制，元数据侧与下载侧分开配置。

## Alternatives considered

- **移植 vmr 的 Lua 插件运行时**：能 100% 对齐 vmr 的「最新版本发现」能力（包括刚发布、尚未进 vsources 的版本）。放弃原因：Lua VM + 插件 API + 一堆 `go` 生态辅助函数（HTTP、正则、JSON）的移植量与维护成本远超一个通用安装引擎，而且插件一旦抓取失败，桌面端要自己写一遍重试与容错；vsources 本身就是 vmr 定期跑插件后的缓存产物，版本新鲜度只差一个同步周期。
- **自己为每个 SDK 写 TS 抓取器**：控制力最强，但要写 80+ 个抓取器，且每种 SDK 的发版 API 各不相同（GitHub Releases、官网目录页、JSON API），维护面最大。
- **每个 SDK 一个固定下载地址模板**：最省事，但大量工具没有稳定的 URL 模板（GitHub releases 带 tag 与文件名），一有变化就整包失效。

## Consequences

- 代价：版本列表的上游是 vsources，vmr 作者不更新时新版本不会出现；`size` 字段在部分 SDK 里是 `0`，UI 只能显示「—」；`sum` 偶有空值，此时下载只校验大小，不校验哈希。
- 收益：58 个 Windows 可安装 SDK 一次性覆盖，没有 Lua 运行时依赖；元数据可离线缓存；镜像、并发、校验都是自己的代码，行为可测。
- 验证：`fd`（zip，GitHub Releases）与 `lazygit 0.1.24`（tar.gz）两个真实包走通了 download → sha256 → 解压 → 定位根目录 → 写 meta → 建 junction → 注入 PATH 全链路；`fd --version` 在 `current` 链接与新的 PowerShell 会话里都返回正确版本。
