import type { JSX } from 'react';
import { ArrowRight, Boxes, FolderOpen, RefreshCw, TerminalSquare } from 'lucide-react';
import { bridge } from '../lib/bridge';
import { useApp } from '../store';
import { formatBytes, glyphOf, percent, phaseText } from '../lib/format';

const POPULAR = ['node', 'python', 'go', 'jdk', 'rust', 'dotnet', 'bun', 'deno', 'zig', 'php'];

export function Overview(): JSX.Element {
  const catalog = useApp((state) => state.catalog);
  const installed = useApp((state) => state.installed);
  const jobs = useApp((state) => state.jobs);
  const settings = useApp((state) => state.settings);
  const catalogLoading = useApp((state) => state.catalogLoading);
  const setPage = useApp((state) => state.setPage);
  const refreshCatalog = useApp((state) => state.refreshCatalog);
  const openSdk = useApp((state) => state.openSdk);

  const current = installed.filter((item) => item.current);
  const totalBytes = installed.reduce((sum, item) => sum + item.sizeBytes, 0);
  const activeJobs = jobs.filter((job) => !['done', 'error', 'canceled'].includes(job.phase));
  const sdksWithBuilds = catalog.filter((item) => item.installable).length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>概览</h1>
          <p>统一管理本机的语言运行时与命令行工具：安装、切换、按项目锁定版本，并按需写进全局 PATH。</p>
        </div>
        <div className="actions">
          <button
            type="button"
            className="btn"
            onClick={() => void refreshCatalog(true)}
            disabled={catalogLoading}
          >
            <RefreshCw size={13} className={catalogLoading ? 'spin' : ''} /> 同步元数据
          </button>
        </div>
      </div>

      <div className="grid c4" style={{ marginBottom: 14 }}>
        <div className="card stat">
          <div className="k">已安装运行时</div>
          <div className="v">{installed.length}</div>
          <div className="sub">{current.length} 个处于激活状态</div>
        </div>
        <div className="card stat">
          <div className="k">可用 SDK</div>
          <div className="v">{sdksWithBuilds}</div>
          <div className="sub">共 {catalog.length} 个条目，Windows 可安装 {sdksWithBuilds} 个</div>
        </div>
        <div className="card stat">
          <div className="k">磁盘占用</div>
          <div className="v">{formatBytes(totalBytes)}</div>
          <div className="sub mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {settings?.installRoot ?? '—'}
          </div>
        </div>
        <div className="card stat">
          <div className="k">进行中任务</div>
          <div className="v">{activeJobs.length}</div>
          <div className="sub">{jobs.length} 条历史记录</div>
        </div>
      </div>

      <div className="grid c2">
        <div className="card">
          <div className="card-head">
            <h2>已安装运行时</h2>
            <span className="meta">{installed.length} 项</span>
            <button type="button" className="btn ghost sm" style={{ marginLeft: 8 }} onClick={() => setPage('catalog')}>
              全部 <ArrowRight size={12} />
            </button>
          </div>
          {installed.length === 0 && <div className="empty">还没有安装任何运行时，去 SDK 目录挑一个吧。</div>}
          {installed.slice(0, 6).map((item) => {
            const summary = catalog.find((sdk) => sdk.id === item.sdk);
            return (
              <div className="version-row" key={`${item.sdk}-${item.version}`} style={{ marginBottom: 8 }}>
                <span className="sdk-glyph" style={{ width: 26, height: 26, fontSize: 11 }}>
                  {glyphOf(summary?.name ?? item.sdk, item.sdk)}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{summary?.name ?? item.sdk}</div>
                  <div className="sdk-id mono">{item.version}</div>
                </div>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
                  {item.current && <span className="tag green">当前</span>}
                  {!item.managed && <span className="tag amber">外部</span>}
                  <span className="tag">{formatBytes(item.sizeBytes)}</span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="card">
          <div className="card-head">
            <h2>任务</h2>
            <span className="meta">{activeJobs.length} 个进行中</span>
            <button type="button" className="btn ghost sm" style={{ marginLeft: 8 }} onClick={() => setPage('jobs')}>
              队列 <ArrowRight size={12} />
            </button>
          </div>
          {jobs.length === 0 && <div className="empty">安装任务会出现在这里，支持并发下载与取消。</div>}
          {jobs.slice(0, 5).map((job) => (
            <div className="job" key={job.id}>
              <div className="job-line">
                <span className="mono">
                  {job.sdk} <span style={{ color: 'var(--dim)' }}>{job.version}</span>
                </span>
                <span className="phase">
                  {phaseText(job.phase)} · {percent(job.progress)}
                </span>
              </div>
              <div className="bar">
                <i
                  className={job.phase === 'done' ? 'ok' : job.phase === 'error' ? 'err' : ''}
                  style={{ width: `${Math.max(3, job.progress * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-head">
          <h2>快速开始</h2>
        </div>
        <div className="grid c3">
          <button type="button" className="sdk-card" style={{ textAlign: 'left' }} onClick={() => setPage('catalog')}>
            <div className="sdk-top">
              <span className="sdk-glyph">
                <Boxes size={15} />
              </span>
              <div>
                <div className="sdk-name">浏览 SDK 目录</div>
                <div className="sdk-id">{catalog.length} 个运行时与工具</div>
              </div>
            </div>
            <div className="sdk-desc">阅读版本元数据，一键安装并切换当前版本。</div>
          </button>
          <button
            type="button"
            className="sdk-card"
            style={{ textAlign: 'left' }}
            onClick={() => void bridge.system.openPath(settings?.installRoot ?? '.')}
          >
            <div className="sdk-top">
              <span className="sdk-glyph">
                <FolderOpen size={15} />
              </span>
              <div>
                <div className="sdk-name">打开安装目录</div>
                <div className="sdk-id mono">{settings?.installRoot ?? '—'}</div>
              </div>
            </div>
            <div className="sdk-desc">查看每个 SDK 的版本身与 current 链接。</div>
          </button>
          <button type="button" className="sdk-card" style={{ textAlign: 'left' }} onClick={() => void bridge.env.openTerminal()}>
            <div className="sdk-top">
              <span className="sdk-glyph">
                <TerminalSquare size={15} />
              </span>
              <div>
                <div className="sdk-name">打开临时环境终端</div>
                <div className="sdk-id">只在这个窗口里注入当前版本</div>
              </div>
            </div>
            <div className="sdk-desc">新窗口继承 bigEnv 的环境变量，无需修改系统设置。</div>
          </button>
        </div>
      </div>

      {catalog.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="hint-text" style={{ marginBottom: 8 }}>
            常用运行时
          </div>
          <div className="chip-row">
            {POPULAR.flatMap((id) => {
              const sdk = catalog.find((item) => item.id === id);
              if (!sdk) return [];
              return [
                <button key={sdk.id} type="button" className="btn sm" onClick={() => openSdk(sdk.id)}>
                  {sdk.name}
                  {sdk.currentVersion && <span className="dot" style={{ marginLeft: 6 }} />}
                </button>,
              ];
            })}
          </div>
        </div>
      )}
    </>
  );
}
