import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { BrowserWindow } from 'electron';
import { z } from 'zod';
import type { JobState, McpStatus, PathMode, Settings } from '../shared/types';
import type { AppRuntime } from './app';
import { createLogger } from './logger';
import { getSettings, updateSettings } from './store';

const log = createLogger('mcp');

const BIND_HOST = '127.0.0.1';
const ENDPOINT = '/mcp';
/** Number of tools registered below; surfaced to the UI so users can sanity-check the endpoint. */
// Keep in sync with the registerTool calls in buildServer (tools/list returns this many).
const TOOL_COUNT = 21;

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

function ok(value: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function fail(error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: 'text', text: `错误：${message}` }], isError: true };
}

function newToken(): string {
  return randomBytes(24).toString('hex');
}

/** Constant-time compare that tolerates different lengths. */
function sameToken(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

function summarizeJob(job: JobState): Record<string, unknown> {
  return {
    id: job.id,
    sdk: job.sdk,
    version: job.version,
    phase: job.phase,
    progress: Number(job.progress.toFixed(3)),
    error: job.error ?? null,
    installPath: job.installPath ?? null,
    receivedBytes: job.receivedBytes,
    totalBytes: job.totalBytes,
  };
}

function compactSummary(sdk: {
  id: string;
  name: string;
  category: string;
  versionCount: number;
  latestVersion: string | null;
  latestLts: string | null;
  installable: boolean;
  unavailableReason?: string;
  installedVersions: string[];
  currentVersion: string | null;
}): Record<string, unknown> {
  return {
    id: sdk.id,
    name: sdk.name,
    category: sdk.category,
    versionCount: sdk.versionCount,
    latestVersion: sdk.latestVersion,
    latestLts: sdk.latestLts,
    installedVersions: sdk.installedVersions,
    currentVersion: sdk.currentVersion,
    installable: sdk.installable,
    ...(sdk.unavailableReason ? { unavailableReason: sdk.unavailableReason } : {}),
  };
}

/**
 * One MCP server instance per HTTP request: the tools are stateless, so a fresh
 * server + transport keeps the endpoint free of session bookkeeping while still
 * speaking the streamable-HTTP protocol that clients such as Claude Code and
 * Cursor understand.
 */
function buildServer(runtime: AppRuntime, version: string): McpServer {
  const server = new McpServer(
    { name: 'bigenv', version },
    {
      instructions:
        'bigEnv 管理本机的多语言运行环境（SDK 版本）。\n' +
        '常用流程：先 bigenv_list_sdks 找到 SDK id，再 bigenv_sdk_versions 选版本，' +
        'bigenv_install 安装并用 bigenv_wait_job 等它完成，最后 bigenv_use 切到该版本。\n' +
        '项目级环境用 bigenv_project_save 写 .bigenv.json，之后 terminal 里跑 bigenv run -- <cmd> 即可按锁注入。\n' +
        '只想让全局命令生效时用 bigenv_set_path_sdks 勾选 SDK（需要 bigenv_set_path_mode 设为 user 或 machine）。\n' +
        '所有写操作都会真实改动本机文件与注册表，执行前请向用户确认。',
    },
  );

  server.registerTool(
    'bigenv_list_sdks',
    {
      title: '列出可用 SDK',
      description: '列出 bigEnv 目录中的 SDK（可搜索、只看已安装）。每个条目含最新版本、已装版本与当前版本。',
      inputSchema: {
        query: z.string().optional().describe('按名称/id/描述模糊搜索'),
        installedOnly: z.boolean().optional().describe('只看本机已安装的 SDK'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, installedOnly }) => {
      try {
        const list = await runtime.catalog.summaries();
        const needle = query?.trim().toLowerCase();
        const filtered = list.filter((sdk) => {
          if (installedOnly && sdk.installedVersions.length === 0) return false;
          if (!needle) return true;
          return `${sdk.id} ${sdk.name} ${sdk.description}`.toLowerCase().includes(needle);
        });
        return ok({ total: list.length, matched: filtered.length, sdks: filtered.map(compactSummary) });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'bigenv_sdk_versions',
    {
      title: '查看 SDK 版本',
      description: '列出某个 SDK 可安装的版本（新的在前），含 LTS、安装器类型、是否已安装/当前版本。',
      inputSchema: {
        sdk: z.string().describe('SDK id，例如 node、go、jdk'),
        limit: z.number().int().min(1).max(500).optional().describe('返回条数，默认 40'),
        installedOnly: z.boolean().optional().describe('只返回已安装的版本'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ sdk, limit, installedOnly }) => {
      try {
        const versions = await runtime.catalog.versions(sdk);
        const rows = versions
          .filter((option) => (installedOnly ? option.installed : true))
          .slice(0, limit ?? 40)
          .map((option) => ({
            version: option.version,
            lts: option.lts,
            sizeBytes: option.sizeBytes,
            installer: option.installer,
            installed: option.installed,
            current: option.current,
            installable: option.installable,
            ...(option.unavailableReason ? { unavailableReason: option.unavailableReason } : {}),
          }));
        return ok({ sdk, total: versions.length, returned: rows.length, versions: rows });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'bigenv_list_installed',
    {
      title: '列出已安装版本',
      description: '列出本机已安装的所有 SDK 版本，含路径、大小、是否为当前版本。',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const records = await runtime.registry.list();
        return ok({
          total: records.length,
          installs: records.map((record) => ({
            sdk: record.sdk,
            version: record.version,
            path: record.path,
            sizeBytes: record.sizeBytes,
            current: record.current,
            installer: record.installer,
            installedAt: record.installedAt,
          })),
        });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'bigenv_which',
    {
      title: '查询当前版本',
      description: '返回某个 SDK 当前激活的版本与安装路径。',
      inputSchema: { sdk: z.string().describe('SDK id') },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ sdk }) => {
      try {
        const current = await runtime.registry.currentVersion(sdk);
        if (!current) return fail(new Error(`${sdk} 没有激活任何版本`));
        const dir = runtime.registry.installDir(sdk, current);
        return ok({ sdk, version: current, path: dir });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'bigenv_install',
    {
      title: '安装 SDK 版本',
      description: '下载并安装指定版本，返回任务信息；用 bigenv_wait_job 等它结束。安装成功后不会自动切换，需要时调用 bigenv_use。',
      inputSchema: {
        sdk: z.string().describe('SDK id'),
        version: z.string().describe('要安装的版本号'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ sdk, version }) => {
      try {
        const job = await runtime.jobs.start(sdk, version);
        broadcast('bigenv:job', job);
        return ok({ job: summarizeJob(job) });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'bigenv_job',
    {
      title: '查询安装任务',
      description: '按 id 查询安装任务状态；不传 id 时列出全部任务。',
      inputSchema: { id: z.string().optional().describe('任务 id') },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ id }) => {
      try {
        const jobs = runtime.jobs.list();
        if (!id) return ok({ jobs: jobs.map(summarizeJob) });
        const job = jobs.find((item) => item.id === id);
        if (!job) return fail(new Error(`没有找到任务 ${id}`));
        return ok({ job: summarizeJob(job) });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'bigenv_wait_job',
    {
      title: '等待安装任务',
      description: '轮询任务直到完成/失败/取消或超时，适合在安装后直接等待结果。',
      inputSchema: {
        id: z.string().describe('任务 id'),
        timeoutSeconds: z.number().int().min(1).max(600).optional().describe('默认 120 秒'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ id, timeoutSeconds }) => {
      const deadline = Date.now() + (timeoutSeconds ?? 120) * 1000;
      try {
        for (;;) {
          const job = runtime.jobs.list().find((item) => item.id === id);
          if (!job) return fail(new Error(`没有找到任务 ${id}`));
          if (job.phase === 'done' || job.phase === 'error' || job.phase === 'canceled') {
            return ok({ job: summarizeJob(job) });
          }
          if (Date.now() > deadline) return ok({ timeout: true, job: summarizeJob(job) });
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'bigenv_cancel_job',
    {
      title: '取消安装任务',
      description: '取消排队或进行中的安装任务。',
      inputSchema: { id: z.string().describe('任务 id') },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async ({ id }) => {
      try {
        await runtime.jobs.cancel(id);
        return ok({ canceled: id });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'bigenv_use',
    {
      title: '切换当前版本',
      description: '把某个已安装版本设为 current（更新 <sdk>/current 链接并刷新全局 PATH）。',
      inputSchema: {
        sdk: z.string().describe('SDK id'),
        version: z.string().describe('已安装的版本号'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ sdk, version }) => {
      try {
        await runtime.registry.use(sdk, version);
        runtime.catalog.invalidateVersions(sdk);
        await runtime.env.refresh();
        broadcast('bigenv:installed', null);
        return ok({ sdk, version, current: true });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'bigenv_uninstall',
    {
      title: '删除已安装版本',
      description: '删除某个已安装版本；如果它正是 current，会同时移除 current 链接。不可恢复。',
      inputSchema: {
        sdk: z.string().describe('SDK id'),
        version: z.string().describe('版本号'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async ({ sdk, version }) => {
      try {
        await runtime.registry.remove(sdk, version);
        runtime.catalog.invalidateVersions(sdk);
        await runtime.env.refresh();
        broadcast('bigenv:installed', null);
        return ok({ sdk, version, removed: true });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'bigenv_env_info',
    {
      title: '查看环境状态',
      description: '查看全局 PATH 模式、参与发布的 SDK、实际写入的目录、遮蔽冲突与 CLI 启动器路径。',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      try {
        return ok(await runtime.env.info());
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'bigenv_set_path_mode',
    {
      title: '设置全局 PATH 范围',
      description: 'off 关闭；user 写入当前用户 PATH；machine 写入系统 PATH（会弹出 UAC 授权）。',
      inputSchema: { mode: z.enum(['off', 'user', 'machine']).describe('PATH 生效范围') },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ mode }) => {
      try {
        broadcast('bigenv:settings', await updateSettings({ pathMode: mode as PathMode }));
        const info = await runtime.setPathMode(mode as PathMode);
        broadcast('bigenv:settings', getSettings());
        return ok(info);
      } catch (error) {
        broadcast('bigenv:settings', getSettings());
        return fail(error);
      }
    },
  );

  server.registerTool(
    'bigenv_set_path_sdks',
    {
      title: '选择进 PATH 的 SDK',
      description: '设置哪些 SDK 的 <sdk>/current 会写进全局 PATH（只影响 mode 非 off 时实际写入的条目）。',
      inputSchema: {
        sdks: z.array(z.string()).describe('SDK id 列表，传空数组表示都不发布'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ sdks }) => {
      try {
        const settings: Settings = await runtime.applySettings({ pathSdks: sdks });
        broadcast('bigenv:settings', settings);
        return ok(await runtime.env.info());
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'bigenv_projects',
    {
      title: '项目环境',
      description: '不传目录时列出所有已登记项目；传目录时读取该项目目录下的 .bigenv.json。',
      inputSchema: {
        dir: z.string().optional().describe('项目目录绝对路径'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ dir }) => {
      try {
        if (dir) return ok(await runtime.projects.inspect(dir));
        return ok({ projects: await runtime.listProjects() });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'bigenv_project_save',
    {
      title: '写入项目锁',
      description: '把 {sdk: version} 整体写入项目根目录的 .bigenv.json；空对象会删除该文件。',
      inputSchema: {
        dir: z.string().describe('项目目录绝对路径'),
        versions: z.record(z.string(), z.string()).describe('SDK 到版本的映射'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ dir, versions }) => {
      try {
        const info = await runtime.projects.save(dir, versions);
        broadcast('bigenv:installed', null);
        return ok(info);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'bigenv_project_add',
    {
      title: '登记项目目录',
      description: '把一个目录加入项目环境列表（供界面上管理）。',
      inputSchema: { dir: z.string().describe('项目目录绝对路径') },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ dir }) => {
      try {
        const projects = await runtime.addProject(dir);
        broadcast('bigenv:settings', getSettings());
        return ok({ projects });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'bigenv_project_remove',
    {
      title: '移除项目登记',
      description: '从项目列表移除目录（不会删除该目录里的 .bigenv.json）。',
      inputSchema: { dir: z.string().describe('项目目录绝对路径') },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ dir }) => {
      try {
        const projects = await runtime.removeProject(dir);
        broadcast('bigenv:settings', getSettings());
        return ok({ projects });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'bigenv_health',
    {
      title: '体检扫描',
      description: '统计已安装版本占用、缓存占用、孤儿目录与失效的 current 链接。',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      try {
        return ok(await runtime.health.scan());
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'bigenv_clean',
    {
      title: '清理磁盘',
      description: '清理下载缓存和/或孤儿版本目录（没有元数据的目录）。会删除文件，执行前请确认。',
      inputSchema: {
        cache: z.boolean().optional().describe('清空 downloads/temp 缓存'),
        orphans: z.boolean().optional().describe('删除孤儿版本目录'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async ({ cache, orphans }) => {
      try {
        const report = await runtime.health.clean({ cache: cache === true, orphans: orphans === true });
        return ok(report);
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'bigenv_check_updates',
    {
      title: '检查 bigEnv 更新',
      description: '查询 bigEnv 自身是否有新版本（GitHub Releases）。',
      inputSchema: { force: z.boolean().optional().describe('跳过 6 小时缓存') },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ force }) => {
      try {
        return ok(await runtime.updates.check(force === true));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'bigenv_open_terminal',
    {
      title: '打开环境终端',
      description: '在当前大屏上打开一个按项目锁（或全部 current）注入环境变量的 PowerShell 窗口。',
      inputSchema: { dir: z.string().optional().describe('项目目录；省略则用当前激活版本') },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ dir }) => {
      try {
        if (dir) {
          const info = await runtime.projects.inspect(dir);
          await runtime.env.openTerminal(dir, new Map(Object.entries(info.versions)));
        } else {
          await runtime.env.openTerminal();
        }
        return ok({ opened: true, dir: dir ?? null });
      } catch (error) {
        return fail(error);
      }
    },
  );

  return server;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      // MCP requests are small; anything larger is a mistake or an attack.
      if (size > 4 * 1024 * 1024) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

/**
 * Loopback MCP endpoint. Off by default; when on it listens on 127.0.0.1 only and
 * requires the token shown on the settings page, so local tools (and only those
 * holding the token) can drive installs, PATH changes and project locks.
 */
export class McpService {
  private server: Server | null = null;
  private runningPort: number | null = null;
  private lastError: string | undefined;
  private readonly version: string;

  constructor(
    private readonly runtime: AppRuntime,
    version: string,
  ) {
    this.version = version;
  }

  private ensureToken(): string {
    const token = getSettings().mcpToken;
    if (token) return token;
    const fresh = newToken();
    // Fire-and-forget is fine: callers re-read the token from settings right after.
    void updateSettings({ mcpToken: fresh });
    return fresh;
  }

  status(): McpStatus {
    const settings = getSettings();
    const running = this.server !== null && this.runningPort !== null;
    return {
      enabled: settings.mcpEnabled,
      running,
      port: running ? (this.runningPort ?? settings.mcpPort) : settings.mcpPort,
      url: `http://${BIND_HOST}:${running ? (this.runningPort ?? settings.mcpPort) : settings.mcpPort}${ENDPOINT}`,
      token: settings.mcpToken,
      toolCount: TOOL_COUNT,
      ...(this.lastError ? { error: this.lastError } : {}),
    };
  }

  async rotateToken(): Promise<McpStatus> {
    await updateSettings({ mcpToken: newToken() });
    return this.status();
  }

  async start(): Promise<McpStatus> {
    this.ensureToken();
    const settings = getSettings();
    if (this.server && this.runningPort === settings.mcpPort) return this.status();
    await this.stop();
    const server = createServer((req, res) => {
      void this.handle(req, res).catch((error: unknown) => {
        log.error('request failed', error instanceof Error ? error.message : String(error));
        if (!res.headersSent) sendJson(res, 500, { error: 'internal error' });
      });
    });
    this.lastError = undefined;
    await new Promise<void>((resolve) => {
      server.once('error', (error: NodeJS.ErrnoException) => {
        this.lastError =
          error.code === 'EADDRINUSE' ? `端口 ${settings.mcpPort} 已被占用，换一个端口再试` : error.message;
        log.warn('listen failed', this.lastError);
        resolve();
      });
      server.listen(settings.mcpPort, BIND_HOST, () => {
        this.server = server;
        this.runningPort = settings.mcpPort;
        log.info('mcp listening', `http://${BIND_HOST}:${settings.mcpPort}${ENDPOINT}`);
        resolve();
      });
    });
    return this.status();
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.runningPort = null;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private authorized(req: IncomingMessage): boolean {
    const token = getSettings().mcpToken;
    if (!token) return false;
    const header = req.headers.authorization;
    const bearer = typeof header === 'string' && header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
    const direct = req.headers['x-bigenv-token'];
    const candidate = bearer || (typeof direct === 'string' ? direct : '');
    if (!candidate) return false;
    return sameToken(candidate, token);
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const origin = req.headers.origin;
    res.setHeader('access-control-allow-origin', typeof origin === 'string' ? origin : '*');
    res.setHeader('vary', 'origin');
    res.setHeader('access-control-allow-headers', 'authorization, content-type, mcp-protocol-version, mcp-session-id, x-bigenv-token');
    res.setHeader('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('access-control-expose-headers', 'mcp-session-id');

    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }

    const url = new URL(req.url ?? '/', `http://${BIND_HOST}`);
    if (url.pathname !== ENDPOINT) {
      sendJson(res, 404, {
        error: 'not found',
        endpoint: `http://${BIND_HOST}:${this.runningPort ?? getSettings().mcpPort}${ENDPOINT}`,
      });
      return;
    }
    if (!this.authorized(req)) {
      sendJson(res, 401, { error: 'unauthorized', hint: '在设置 → AI 接入里复制访问令牌，放到 Authorization: Bearer <token>' });
      return;
    }
    if (req.method === 'GET' || req.method === 'DELETE') {
      sendJson(res, 405, { error: 'method not allowed', hint: '这个 MCP 端点是无状态的，只用 POST 发送 JSON-RPC' });
      return;
    }
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'method not allowed' });
      return;
    }

    let body: unknown;
    try {
      body = JSON.parse(await readBody(req));
    } catch (error) {
      sendJson(res, 400, { error: 'invalid json', detail: error instanceof Error ? error.message : String(error) });
      return;
    }

    const server = buildServer(this.runtime, this.version);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      void transport.close().catch(() => undefined);
      void server.close().catch(() => undefined);
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  }
}
