import type { JSX } from 'react';
import { AlertTriangle, ClipboardCopy, FileCode2, TerminalSquare } from 'lucide-react';
import type { PathMode } from '../../shared/types';
import { bridge } from '../lib/bridge';
import { useApp } from '../store';
import { formatBytes } from '../lib/format';

const PATH_MODES: { id: PathMode; label: string }[] = [
  { id: 'off', label: '关闭' },
  { id: 'user', label: '用户 PATH' },
  { id: 'machine', label: '系统 PATH' },
];

export function Environment(): JSX.Element {
  const shell = useApp((state) => state.shell);
  const installed = useApp((state) => state.installed);
  const toggleShell = useApp((state) => state.toggleShell);
  const setPathMode = useApp((state) => state.setPathMode);
  const busy = useApp((state) => state.busy);
  const notify = useApp((state) => state.notify);

  const copy = async (text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      notify('已复制到剪贴板');
    } catch {
      notify('复制失败', 'err');
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Shell 集成</h1>
          <p>
            默认不触碰注册表：用初始化脚本、项目锁或 CLI 提供环境；需要全局生效时再选择把稳定入口写进用户/系统 PATH。
          </p>
        </div>
        <div className="actions">
          <button type="button" className="btn" onClick={() => void bridge.env.openTerminal()}>
            <TerminalSquare size={13} /> 打开终端
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head">
          <h2>全局 PATH 激活</h2>
          <span className="meta">
            {shell?.activeScope === 'machine'
              ? '已写入系统 PATH'
              : shell?.activeScope === 'user'
                ? '已写入用户 PATH'
                : '当前未写入'}
          </span>
        </div>
        <div className="spread" style={{ alignItems: 'flex-start' }}>
          <div style={{ fontSize: 12.5, color: 'var(--muted)', maxWidth: 520 }}>
            把 <code>&lt;安装目录&gt;\&lt;sdk&gt;\current</code> 写进 PATH，任何程序（cmd、IDE、AI agent）都能直接用；
            切换版本只换 junction 目标，已打开的终端下一条命令就生效。系统 PATH 需要管理员权限。
          </div>
          <div className="tabbar">
            {PATH_MODES.map((mode) => (
              <button
                key={mode.id}
                type="button"
                className={shell?.pathMode === mode.id ? 'active' : ''}
                disabled={busy === 'path'}
                onClick={() => void setPathMode(mode.id)}
              >
                {mode.label}
              </button>
            ))}
          </div>
        </div>
        <div className="divider" />
        {(!shell || shell.globalEntries.length === 0) && <div className="empty">还没有可发布的运行时。</div>}
        {shell?.globalEntries.map((entry) => (
          <div key={entry} className="row" style={{ padding: '4px 0', fontSize: 12 }}>
            <span className="tag green">PATH</span>
            <span className="mono" style={{ fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {entry}
            </span>
          </div>
        ))}
        {shell && shell.conflicts.length > 0 && (
          <>
            <div className="divider" />
            {shell.conflicts.map((conflict) => (
              <div key={`${conflict.sdk}-${conflict.exe}`} className="row" style={{ padding: '4px 0', fontSize: 12 }}>
                <AlertTriangle size={13} color="var(--warn, #d6a84a)" />
                <span>
                  <b>{conflict.exe}</b> 被更靠前的 <span className="mono">{conflict.shadowedBy}</span> 抢先，bigEnv 的 {conflict.sdk} 不会生效
                </span>
              </div>
            ))}
          </>
        )}
        <div className="divider" />
        <dl className="kv">
          <dt>CLI</dt>
          <dd className="mono" style={{ fontSize: 11.5 }}>{shell?.cliLauncher ?? '未生成'}</dd>
          <dt>用法</dt>
          <dd style={{ fontSize: 12 }}>
            {['bigenv run -- node -v', 'bigenv env --json', 'bigenv use node@24.4.0'].map((line) => (
              <div key={line} style={{ padding: '2px 0' }}>
                <code>{line}</code>
              </div>
            ))}
          </dd>
        </dl>
      </div>

      <div className="grid c2">
        <div className="card">
          <div className="card-head">
            <h2>PowerShell 配置注入</h2>
            <span className="meta">{shell?.enabled ? '已开启' : '未开启'}</span>
          </div>
          <div className="spread">
            <div style={{ fontSize: 12.5, color: 'var(--muted)', maxWidth: 420 }}>
              开启后会在 <code>Microsoft.PowerShell_profile.ps1</code> 末尾写入一段被标记包围的代码，启动新终端时自动加载 bigEnv 环境。
              关闭会移除该段代码，不改动其它内容。
            </div>
            <button
              type="button"
              className={`switch ${shell?.enabled ? 'on' : ''}`}
              aria-label="切换 Shell 注入"
              onClick={() => void toggleShell(!shell?.enabled)}
            />
          </div>
          <div className="divider" />
          <dl className="kv">
            <dt>配置文件</dt>
            <dd className="mono" style={{ fontSize: 11.5 }}>{shell?.profilePath ?? '—'}</dd>
            <dt>环境脚本</dt>
            <dd className="mono" style={{ fontSize: 11.5 }}>{shell?.envScriptPath ?? '—'}</dd>
          </dl>
          <div className="row" style={{ marginTop: 12 }}>
            <button type="button" className="btn sm" onClick={() => shell && void copy(shell.envScriptPath)}>
              <ClipboardCopy size={12} /> 复制脚本路径
            </button>
            <button
              type="button"
              className="btn sm"
              onClick={() => shell && void bridge.system.openPath(shell.envScriptPath.replace(/[\\/][^\\/]+$/, ''))}
            >
              <FileCode2 size={12} /> 打开脚本目录
            </button>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h2>注入内容</h2>
            <span className="meta">PATH 条目 {shell?.pathEntries.length ?? 0}</span>
          </div>
          {(!shell || shell.pathEntries.length === 0) && <div className="empty">还没有激活的运行时。</div>}
          {shell?.pathEntries.map((entry) => (
            <div key={entry} className="row" style={{ padding: '5px 0', fontSize: 12 }}>
              <span className="tag green">PATH</span>
              <span className="mono" style={{ fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {entry}
              </span>
            </div>
          ))}
          {shell && Object.entries(shell.vars).length > 0 && <div className="divider" />}
          {shell &&
            Object.entries(shell.vars).map(([name, value]) => (
              <div key={name} className="row" style={{ padding: '5px 0', fontSize: 12 }}>
                <span className="tag blue">{name}</span>
                <span className="mono" style={{ fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {value}
                </span>
              </div>
            ))}
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-head">
          <h2>本机已安装</h2>
          <span className="meta">
            {installed.length} 项 · {formatBytes(installed.reduce((sum, item) => sum + item.sizeBytes, 0))}
          </span>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>SDK</th>
              <th>激活版本</th>
              <th>bin 路径</th>
            </tr>
          </thead>
          <tbody>
            {installed.map((item) => (
              <tr key={`${item.sdk}-${item.version}`}>
                <td>
                  {item.sdk} {item.current && <span className="tag green">当前</span>}
                </td>
                <td className="mono">{item.version}</td>
                <td className="mono" style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                  {item.binDirs.map((segments) => (segments.length ? `${item.path}\\${segments.join('\\')}` : item.path)).join('  ·  ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
