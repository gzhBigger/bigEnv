# Agent Note: 本机 MCP 端点，让 AI 客户端操作 bigEnv

Status: implemented

## Problem

bigEnv 的能力都在界面上：安装、切换 current、写项目锁、体检清理。用户想让 AI（Claude Code、Cursor、其他 MCP 客户端）代劳这些动作时，只能让 AI 猜路径、直接改文件，既容易破坏 `.bigenv.json` 与 junction 的一致性，也绕过了下载校验和 PATH 刷新。

需要一个受控入口：AI 能查询目录、发起安装、切换版本、写项目锁、跑体检，但所有写操作仍走主进程现有的服务（`JobQueue`、`Registry`、`EnvManager`、`HealthService`），不重新实现一套文件操作。

## Decision

**在主进程起一个只监听 `127.0.0.1` 的 MCP（Model Context Protocol）端点，默认关闭，启用后需要 Bearer 令牌。**

- 传输用 Streamable HTTP（`/mcp`），**无状态**：每个 POST 现场创建一个 `McpServer` + `StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })`，请求结束即关闭。工具本身无会话状态，因此不需要维护 session map，也不受客户端重连影响。
- 绑定地址固定 `127.0.0.1`，不监听 `0.0.0.0`；令牌存在 `settings.mcpToken`，首次启用时用 `randomBytes(24).toString('hex')` 生成，校验用 `timingSafeEqual`。同时支持 `Authorization: Bearer <token>` 与 `x-bigenv-token`，方便不同客户端。
- 工具共 21 个，命名统一 `bigenv_*`：`list_sdks`、`sdk_versions`、`list_installed`、`which`、`install`、`job`、`wait_job`、`cancel_job`、`use`、`uninstall`、`env_info`、`set_path_mode`、`set_path_sdks`、`projects`、`project_save`、`project_add`、`project_remove`、`health`、`clean`、`check_updates`、`open_terminal`。
- 写操作复用既有服务并补上界面同款副作用：安装走 `jobs.start`；`use`/`uninstall` 后 `catalog.invalidateVersions()` + `env.refresh()`；项目写锁走 `projects.save`；清理走 `health.clean`。MCP 侧额外广播 `bigenv:installed` / `bigenv:settings`，让打开着的窗口立即刷新。
- `set_path_mode` 把 IPC handler 里那套「先落盘意图 → 需要时提权写 HKLM → 失败回滚」的逻辑提取成 `AppRuntime.setPathMode()`，IPC 与 MCP 共用，避免两套升权分支漂移。
- 设置页新增「AI 接入（MCP）」卡片：开关、端点、令牌（显示/复制/重新生成）、端口、可直接粘贴的 `mcpServers` JSON、工具数量。端口与开关改动通过 `applySettings` 触发重启，令牌即时生效（每次请求现读 settings）。
- 服务器 `instructions` 里写明推荐流程（列目录 → 选版本 → 安装 → 等待 → 切换），让 AI 不必靠猜工具顺序；破坏性工具标了 `destructiveHint`，只读工具标了 `readOnlyHint`。

## Alternatives considered

- **stdio MCP server（独立进程，`bigenv mcp`）**：对 Claude Desktop 这类只支持 stdio 的客户端更直接，但它没有 Electron 主进程里的 `JobQueue`、下载进度与 PATH 提升逻辑，要么把整条安装流水线搬进 CLI，要么让 CLI 通过 IPC 连回应用——两条路都比 HTTP 端点更重。保留为后续可加的薄代理：同一个端点，加一个 stdio→HTTP 转发即可。
- **不鉴权，靠 127.0.0.1 兜底**：本机任何进程（包括浏览器里的页面、其他工具）都能访问 localhost 端口。安装与删除是会破坏用户环境的写操作，必须有令牌；同时 CORS 回显来源，便于浏览器类客户端按需接入。
- **复用 vscode 式的 TCP + 自定义协议**：客户端生态不认，MCP 是现成的标准，`@modelcontextprotocol/sdk` 直接给出 server/transport。
- **每会话有状态（带 session id、支持服务端推送）**：当前没有任何需要服务器主动通知客户端的场景；无状态实现代码量小一个数量级，也不会因为客户端超时重连留下僵尸会话。
- **在 MCP 里直接下载/解压**：会绕过 `JobQueue` 的并发控制、进度事件、sha256 校验与失败清理，等于把安装器实现两遍。

## Consequences

- AI 客户端现在能完整驱动「装 → 等 → 切 → 写项目锁 → 体检」流程；安装与清理仍是主进程里的同一套代码，界面和 AI 看到的状态一致。
- 端点默认关闭，用户不打开就不存在监听端口；打开后令牌只存在本机 `settings.json`，重新生成会让旧配置立即失效。
- 无状态意味着不支持 `GET /mcp` 的 SSE 流与 server-initiated 消息，客户端如果强依赖流式通知会退化到轮询（当前工具都不需要）。
- 令牌等同本机安装目录写权限，UI 已提示不要外泄；如果以后要区分「只读 AI」与「可写 AI」，可以按工具拆分两个令牌。
- 提权写系统 PATH 仍会弹 UAC，MCP 调用无法代替用户点「是」；超时或拒绝时返回明确错误，模式回滚到调用前。
