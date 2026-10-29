# Agent Note: Shell 注入用标记块与生成脚本，项目锁优先读 .bigenv.json

Status: implemented

> 后续变更（2026-10-29，第九轮反馈）：**profile 注入与 `env.ps1` 已整体删除**，本笔记的第 1 个需求改由「全局 PATH + `bigenv` CLI」承担，见 [全局 PATH 与 CLI](2026-10-29-global-path-and-cli.md)。原因：与全局环境页功能重复（两者最终都只是把 PATH 前置，而已装 SDK 的 `.bigenv.json` 里 `envs` 为空时连额外变量都没有），且 profile 只对交互式 PowerShell 生效。下面保留删除前的决策与理由，作为历史记录。

## Problem

两个相关但独立的需求：

1. 用户希望「打开终端就有 node/go 的正确版本」，但直接改系统 `PATH` 或用户环境变量会污染全局、难以回滚，也会影响其它工具。
2. 用户希望「一个项目固定用某几个版本」，进入项目目录时自动用锁里的版本，而不是手动切换。

## Decision

**Shell 注入不改系统环境变量**，而是生成脚本 + 可选 profile 标记块：

- `<userData>/env/env.ps1`、`env.cmd`、`env.sh` 每次安装/切换/删除后重写：把各 SDK 当前版本的 bin 目录前置到 PATH，再写入 SDK 的额外变量（`GOROOT` 等）。
- PowerShell profile 里写入由 `# >>> bigenv initialize >>>` / `# <<< bigenv initialize <<<` 包裹的一段，内容只有「如果 env.ps1 存在就 dot-source 它」。同时覆盖 `~/Documents/PowerShell/Microsoft.PowerShell_profile.ps1`（pwsh）与 `~/Documents/WindowsPowerShell/...`（Windows PowerShell 5.1）。
- 关闭注入 = 删掉标记块与脚本，「打开终端」则生成一次性 `open-terminal.ps1` 并 `cmd /c start` 一个 pwsh/powershell 进程，把 PATH 与环境变量只注入到那个子进程；不写 profile 也能用。
- 项目锁文件名固定 `.bigenv.json`（不再兼容 `bigenv.json` 之外的格式，见下）；内容只接受 JSON 对象 `{ "node": "24.22.1" }`，值允许写成 `sdk@version`（前缀与键同名时剥掉）。锁文件只从项目目录本身读取，**不向上查找**：项目在「项目环境」页登记，避免误把父目录的锁当成子项目的锁。
- 「项目环境」页管理多个项目目录（存于 `settings.projects`）：左侧列表，右侧按 SDK 勾选版本，保存时整体替换该项目的锁文件。打开终端时只注入**锁里列出的 SDK**（`resolveFor` 在传 overrides 时只遍历锁里的键），没勾选的一律不注入。
- 项目页动作：「在此开终端」（按锁注入 `openTerminal(dir, overrides)`）与「保存环境」（勾选结果整体写入），不做全局 `cd` hook。

> 后续补充：默认仍不改注册表，但新增了可选的全局 PATH 激活（写 `<installRoot>\<sdk>\current` 稳定目录）与独立的 `bigenv` CLI，见 [全局 PATH 激活与 CLI](2026-10-29-global-path-and-cli.md)。

## Alternatives considered

- **直接写用户级环境变量（`setx` / 注册表）**：实现最短，但卸载/换版本时要反向追踪，失败就留下脏 PATH；也无法表达「不同项目不同版本」。
- **全局 `cd` hook（改 PowerShell `prompt`/`cd` 函数自动切换）**：vmr 的 `HookForCdCommand` 就是这个思路，体验最好。放弃原因：要修改用户的 shell 函数定义，与用户已有的 prompt 框架（starship/oh-my-posh）冲突概率高，而且 Electron 无法感知用户在外部终端里的 `cd`。改成「点击按钮在该目录打开终端」，行为可预期。
- **用 `.tool-versions` / `.nvmrc` 等既有格式**：生态兼容性好，但一个文件只能表达一种运行时；`.bigenv.json` 的 JSON 对象天然是「多 SDK → 版本」映射，也方便未来加 hash/渠道字段。
- **继续兼容 vmr 的 `.vmr.lock`**（早期实现曾支持）：会让「谁的锁文件生效」变得模糊，且 vmr 的字符串格式没有版本范围/渠道概念。用户明确要求独立自主后删除该分支，读取逻辑只剩一种形状，报错也更直接。

## Consequences

- 代价：注入依赖 profile 被加载（用户若用 `-NoProfile` 或别的 shell 就不生效）；env 脚本每次安装/切换都要重写（已做原子写 + 去重）。
- 收益：零系统污染、可一键关闭；标记块让「谁写的这段配置」一眼可见；项目锁只有一种格式，读写与 CLI 共用同一套解析。
- 多项目：`settings.projects` 让每个目录各自持有一份锁；打开终端/`bigenv run` 都按锁裁剪 SDK 集合，不再默认把全部 current 注入进去。
- 坑：PowerShell 数组字面量不允许尾逗号，早期生成的 `env.ps1` 形如 `@('a',\n'b',)` 会直接 ParserError，把整个 profile 打断。修法是 `join(',\n')` 后再闭合括号，并用 `if (...Count -gt 0)` 守卫空数组。
