import type { JSX } from 'react';
import { Eraser, RefreshCw, ShieldAlert } from 'lucide-react';
import { useApp } from '../store';
import { formatBytes, formatDate } from '../lib/format';

export function Health(): JSX.Element {
  const health = useApp((state) => state.health);
  const scanHealth = useApp((state) => state.scanHealth);
  const cleanHealth = useApp((state) => state.cleanHealth);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>体检与清理</h1>
          <p>扫描安装目录，找出没有元数据的残留版本、失效的 current 链接，并统计缓存与磁盘占用。</p>
        </div>
        <div className="actions">
          <button type="button" className="btn" onClick={() => void scanHealth()}>
            <RefreshCw size={13} /> 重新扫描
          </button>
        </div>
      </div>

      {!health && <div className="empty">点击右上角“重新扫描”开始体检。</div>}

      {health && (
        <>
          <div className="grid c3" style={{ marginBottom: 14 }}>
            <div className="card stat">
              <div className="k">已安装占用</div>
              <div className="v">{formatBytes(health.totalBytes)}</div>
              <div className="sub">{health.installs.length} 个版本目录</div>
            </div>
            <div className="card stat">
              <div className="k">下载与临时缓存</div>
              <div className="v">{formatBytes(health.cacheBytes)}</div>
              <div className="sub">可安全清理，不影响已安装版本</div>
            </div>
            <div className="card stat">
              <div className="k">异常项</div>
              <div className="v">{health.orphans.length + health.brokenCurrentLinks.length}</div>
              <div className="sub">
                {health.orphans.length} 个残留目录 · {health.brokenCurrentLinks.length} 个失效链接
              </div>
            </div>
          </div>

          <div className="grid c2">
            <div className="card">
              <div className="card-head">
                <h2>残留版本目录</h2>
                <span className="meta">{health.orphans.length} 项</span>
                <button
                  type="button"
                  className="btn sm danger"
                  style={{ marginLeft: 'auto' }}
                  disabled={health.orphans.length === 0}
                  onClick={() => {
                    if (window.confirm(`删除 ${health.orphans.length} 个残留目录？`)) void cleanHealth({ orphans: true });
                  }}
                >
                  <Eraser size={12} /> 清理
                </button>
              </div>
              {health.orphans.length === 0 && <div className="empty">没有残留目录，安装树很干净。</div>}
              {health.orphans.map((orphan) => (
                <div className="version-row" key={orphan.path} style={{ marginBottom: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>
                      {orphan.sdk} <span className="mono" style={{ color: 'var(--muted)' }}>{orphan.version}</span>
                    </div>
                    <div className="hint-text mono">{orphan.path}</div>
                  </div>
                  <span className="tag amber" style={{ marginLeft: 'auto' }}>
                    {formatBytes(orphan.sizeBytes)}
                  </span>
                </div>
              ))}
            </div>

            <div className="card">
              <div className="card-head">
                <h2>缓存</h2>
                <span className="meta">{formatBytes(health.cacheBytes)}</span>
                <button
                  type="button"
                  className="btn sm"
                  style={{ marginLeft: 'auto' }}
                  disabled={health.cacheBytes === 0}
                  onClick={() => {
                    if (window.confirm('清空下载缓存与解压临时目录？')) void cleanHealth({ cache: true });
                  }}
                >
                  <Eraser size={12} /> 清空缓存
                </button>
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.7 }}>
                缓存目录保存最近下载的安装包与解压中间文件，安装完成后不会自动删除，方便重复安装时命中本地校验。
                清理后再次安装需要重新下载。
              </div>
              <div className="divider" />
              <div className="card-head" style={{ marginBottom: 8 }}>
                <h2>失效链接</h2>
                <span className="meta">{health.brokenCurrentLinks.length} 个</span>
              </div>
              {health.brokenCurrentLinks.length === 0 ? (
                <div className="hint-text">所有 current 链接都指向存在的版本目录。</div>
              ) : (
                health.brokenCurrentLinks.map((sdk) => (
                  <div className="row" key={sdk} style={{ padding: '3px 0' }}>
                    <ShieldAlert size={13} color="var(--warn)" />
                    <span className="mono">{sdk}</span>
                    <span className="hint-text">current 指向的目录不存在</span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="card" style={{ marginTop: 14, padding: '4px 8px' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>SDK</th>
                  <th>版本</th>
                  <th>大小</th>
                  <th>安装时间</th>
                  <th>来源</th>
                </tr>
              </thead>
              <tbody>
                {health.installs.map((item) => (
                  <tr key={`${item.sdk}-${item.version}`}>
                    <td>{item.sdk}</td>
                    <td className="mono">{item.version}</td>
                    <td>{formatBytes(item.sizeBytes)}</td>
                    <td>{formatDate(item.installedAt)}</td>
                    <td>{item.orphan ? <span className="tag amber">外部/残留</span> : <span className="tag green">bigEnv 管理</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
