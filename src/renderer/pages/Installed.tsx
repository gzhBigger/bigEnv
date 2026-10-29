import type { JSX } from 'react';
import { useMemo, useState } from 'react';
import { FolderOpen, Search, Trash2 } from 'lucide-react';
import { bridge } from '../lib/bridge';
import { useApp } from '../store';
import { formatBytes, formatDate, glyphOf } from '../lib/format';

export function Installed(): JSX.Element {
  const installed = useApp((state) => state.installed);
  const catalog = useApp((state) => state.catalog);
  const settings = useApp((state) => state.settings);
  const useVersion = useApp((state) => state.useVersion);
  const uninstall = useApp((state) => state.uninstall);
  const openSdk = useApp((state) => state.openSdk);
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return installed
      .filter((item) => (keyword ? item.sdk.toLowerCase().includes(keyword) || item.version.includes(keyword) : true))
      .sort((a, b) => a.sdk.localeCompare(b.sdk) || b.version.localeCompare(a.version));
  }, [installed, query]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>已安装</h1>
          <p>
            每个 SDK 的版本独立存放，<code>current</code> 是指向激活版本的目录链接。切换版本只改链接，不复制文件。
          </p>
        </div>
        <div className="actions">
          <div style={{ position: 'relative' }}>
            <Search size={13} style={{ position: 'absolute', left: 9, top: 9, color: 'var(--dim)' }} />
            <input
              className="input search"
              style={{ paddingLeft: 28 }}
              placeholder="过滤 SDK 或版本"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <button type="button" className="btn" onClick={() => void bridge.system.openPath(settings?.installRoot ?? '.')}>
            <FolderOpen size={13} /> 安装目录
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="empty">还没有安装任何运行时。</div>
      ) : (
        <div className="card" style={{ padding: '4px 8px' }}>
          <table className="table">
            <thead>
              <tr>
                <th>SDK</th>
                <th>版本</th>
                <th>大小</th>
                <th>安装时间</th>
                <th>状态</th>
                <th style={{ textAlign: 'right' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => {
                const summary = catalog.find((sdk) => sdk.id === item.sdk);
                return (
                  <tr key={`${item.sdk}-${item.version}`}>
                    <td>
                      <button
                        type="button"
                        className="row"
                        style={{ border: 0, background: 'transparent', cursor: 'pointer', padding: 0 }}
                        onClick={() => openSdk(item.sdk)}
                      >
                        <span className="sdk-glyph" style={{ width: 24, height: 24, fontSize: 10 }}>
                          {glyphOf(summary?.name ?? item.sdk, item.sdk)}
                        </span>
                        <span>{summary?.name ?? item.sdk}</span>
                      </button>
                    </td>
                    <td className="mono">{item.version}</td>
                    <td>{formatBytes(item.sizeBytes)}</td>
                    <td>{formatDate(item.installedAt)}</td>
                    <td>
                      <div className="chip-row">
                        {item.current ? <span className="tag green">当前</span> : <span className="tag">未激活</span>}
                        {!item.managed && <span className="tag amber">外部目录</span>}
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        {!item.current && (
                          <button type="button" className="btn sm" onClick={() => void useVersion(item.sdk, item.version)}>
                            设为当前
                          </button>
                        )}
                        <button type="button" className="btn sm ghost" onClick={() => void bridge.system.openPath(item.path)}>
                          <FolderOpen size={12} />
                        </button>
                        <button
                          type="button"
                          className="btn sm danger"
                          onClick={() => {
                            if (window.confirm(`删除 ${item.sdk} ${item.version}？该目录会被永久移除。`)) {
                              void uninstall(item.sdk, item.version);
                            }
                          }}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
