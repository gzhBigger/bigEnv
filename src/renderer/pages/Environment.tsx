import type { JSX } from 'react';
import { ClipboardCopy, FileCode2, TerminalSquare } from 'lucide-react';
import { bridge } from '../lib/bridge';
import { useApp } from '../store';
import { formatBytes } from '../lib/format';

export function Environment(): JSX.Element {
  const shell = useApp((state) => state.shell);
  const installed = useApp((state) => state.installed);
  const toggleShell = useApp((state) => state.toggleShell);
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
            把一个被标记包围的初始化脚本写进 PowerShell 配置，新终端自动加载；全局 PATH 的公开范围在「全局环境」里单独管理。
          </p>
        </div>
        <div className="actions">
          <button type="button" className="btn" onClick={() => void bridge.env.openTerminal()}>
            <TerminalSquare size={13} /> 打开终端
          </button>
        </div>
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
