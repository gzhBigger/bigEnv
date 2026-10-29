# Agent Note: 设置页的即时开关与三级回退的更新检查

Status: implemented

## Problem

设置页的「显示不可安装的 SDK」「注入 PowerShell 配置」两个开关点了没反应（后者已在第九轮反馈后连同 profile 注入一起删除）：它们只改渲染进程里的 `draft`，切到别的页再回来，`draft` 从持久化的 `settings` 重新同步，看起来就像自己弹回去了。`shellEnabled` 真正落盘的路径是 `env:enable` / `env:disable`（写 profile 标记块 + `applySettings`），而开关根本没走这条路径；即使走了，`store.toggleShell()` 也只更新 `shell`，不刷新 `settings`，开关视觉仍然是旧值。

另一件事：用户装完之后想知道「有没有新版本」。没有发布页入口、也没有版本号对照，只能靠用户自己去 GitHub 找。

## Decision

**把设置项按「即时生效」和「需要保存」分成两类，并新增一个读 Releases 的更新检查入口。**

- 开关类（主题、显示不可安装的 SDK）点击即落盘：直接调 `applySettings`，成功后刷新 `settings` 并靠 `bigenv:settings` 广播同步其它窗口。（原先还有「注入 PowerShell 配置」开关走 `toggleShell`；该功能第九轮反馈后整体删除，设置页只剩一个开关。）
- 文本类（安装根目录、元数据源、镜像、代理、并发数）保留 `draft`：改动后页头出现「有未保存的修改」，点「保存」才一次性提交；没改动时保存按钮置灰。安装根目录变化会触发重扫与 PATH 重写，不适合每次按键都提交。
- `store.toggleShell()` 在 `env.enable()/disable()` 返回后重新 `bridge.settings.get()`，把 `shellEnabled` 写回 store；主进程 `env:enable/disable` 同时广播 `bigenv:settings`。
- 新增 `src/main/updates.ts`：`check(force)` 先读 6 小时缓存，再依次尝试 **GitHub Releases API → releases 页面 HTML → 仓库 `package.json` 的版本**，任一成功即返回 `UpdateInfo{ current, latest, status, available, setupUrl, portableUrl, pageUrl }`；全部失败给 `status:'error'` 与中文原因。
- HTML 回退用 `href="/owner/repo/releases/tag/<tag>"` 提取 tag（早期用 `/releases/tag/([^"\s<>]+)` 会误匹配页内的 `*name` 模板），无 tag 且页面含 `There aren't any releases` 时返回 `'none'`；资产链接从 `releases/expanded_assets/<tag>` 里取，`/setup|installer/i` 归 Setup、其余 `.exe` 归 portable。
- 设置页「版本与更新」卡片：当前/最新/状态、`检查更新`、有新版本时 `下载更新` + `打开发布页`；启动时 `init()` 自动检查一次。下载失败（没有可直接下载的资产）给出「请打开发布页手动选择」。
- 仓库地址更正为 `gzhBigger/bigEnv`（原 `gzh330205` 已改名，GitHub 301 到新地址）。

## Alternatives considered

- **所有设置项都即时保存**：安装根目录、元数据源这类参数一变就要重扫目录、重建 HTTP client、重写 PATH，边输入边提交会连续触发这些副作用，还会在输入框清空的瞬间把根目录设成空串。保留显式「保存」更稳。
- **只靠 GitHub API 检查更新**：本机 `api.github.com` 已经出现 403 限流，单靠 API 会让「检查更新」在没限流时能用、限流时直接报错。三级回退让它在限流与无 Release 两种情况下都有明确输出。
- **内置自动下载安装（静默升级）**：需要签名与安装器配合，未签名时 SmartScreen 会拦，体验反而更差；当前只做到「下载到本地并打开」，安装交给用户。
- **把版本号只放在「关于」卡片**：信息藏得太深，用户不会为了看版本去翻设置；放到「版本与更新」卡片第一行，顺带显示状态。

## Consequences

- 开关的语义变得一致：点一下就是最终状态，切页不会回弹；文本项则明确显示「有未保存的修改」，减少误以为已保存的情况。
- 更新检查多了一次 HTML 抓取回退，网络差时会稍慢（API 失败才走），但有 6 小时缓存兜底。
- 没有 Release 时状态显示「仓库还没有发布版本」，一旦推第一个 Release，同一套逻辑就能指出新版本并给出下载链接，不需要再改代码。
- 仍未做自动更新与签名，下载后的安装包由用户双击运行。
