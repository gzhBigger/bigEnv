import type { JSX } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { X, ExternalLink, Download, Check, Trash2, Search } from 'lucide-react';
import { bridge } from '../lib/bridge';
import { useApp } from '../store';
import { formatBytes, glyphOf } from '../lib/format';

const PAGE_SIZE = 60;

export function SdkSheet(): JSX.Element | null {
  const selectedSdk = useApp((state) => state.selectedSdk);
  const catalog = useApp((state) => state.catalog);
  const versions = useApp((state) => state.versions);
  const versionsLoading = useApp((state) => state.versionsLoading);
  const closeSdk = useApp((state) => state.closeSdk);
  const startInstall = useApp((state) => state.startInstall);
  const useVersion = useApp((state) => state.useVersion);
  const uninstall = useApp((state) => state.uninstall);

  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);

  useEffect(() => {
    setQuery('');
    setLimit(PAGE_SIZE);
  }, [selectedSdk]);

  const list = selectedSdk ? versions[selectedSdk] ?? [] : [];

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return list;
    return list.filter((option) => option.version.toLowerCase().includes(keyword));
  }, [list, query]);

  const visible = filtered.slice(0, limit);

  if (!selectedSdk) return null;
  const summary = catalog.find((item) => item.id === selectedSdk);
  const loading = versionsLoading === selectedSdk;

  return (
    <div className="sheet-mask" onClick={closeSdk}>
      <div className="sheet" onClick={(event) => event.stopPropagation()}>
        <div className="sheet-head">
          <div className="sdk-top" style={{ marginBottom: 10 }}>
            <span className="sdk-glyph" style={{ width: 36, height: 36, fontSize: 14 }}>
              {glyphOf(summary?.name ?? selectedSdk, selectedSdk)}
            </span>
            <div style={{ minWidth: 0 }}>
              <div className="sdk-name" style={{ fontSize: 15 }}>
                {summary?.name ?? selectedSdk}
              </div>
              <div className="sdk-id mono">{selectedSdk}</div>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              {summary?.homepage && (
                <button
                  type="button"
                  className="btn ghost sm"
                  onClick={() => void bridge.system.openExternal(summary.homepage)}
                  title="打开主页"
                >
                  <ExternalLink size={13} />
                </button>
              )}
              <button type="button" className="btn ghost sm" onClick={closeSdk} title="关闭">
                <X size={14} />
              </button>
            </div>
          </div>
          <div style={{ color: 'var(--muted)', fontSize: 12.5 }}>{summary?.description}</div>
          <div className="chip-row" style={{ marginTop: 10 }}>
            <span className="tag">{summary?.category ?? '未分类'}</span>
            <span className="tag blue">{summary?.versionCount ?? 0} 个版本</span>
            {summary?.latestLts && <span className="tag green">LTS {summary.latestLts}</span>}
            {summary?.currentVersion && <span className="tag green">当前 {summary.currentVersion}</span>}
          </div>
        </div>
        <div className="sheet-search">
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={13} style={{ position: 'absolute', left: 9, top: 9, color: 'var(--dim)' }} />
            <input
              className="input"
              style={{ paddingLeft: 28, width: '100%' }}
              placeholder="搜索版本号"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setLimit(PAGE_SIZE);
              }}
            />
          </div>
          <span className="hint-text" style={{ whiteSpace: 'nowrap' }}>
            {filtered.length} / {list.length}
          </span>
        </div>
        <div className="sheet-body">
          {loading && (
            <div className="row" style={{ color: 'var(--dim)', padding: '18px 4px' }}>
              <span className="loading" /> 正在读取版本列表…
            </div>
          )}
          {!loading && list.length === 0 && <div className="empty">暂无该 SDK 的版本元数据</div>}
          {!loading && list.length > 0 && filtered.length === 0 && <div className="empty">没有匹配“{query}”的版本</div>}
          {visible.map((option) => (
            <div className="version-row" key={option.version}>
              <div className="version-name">{option.version}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {option.lts && <span className="tag green">LTS</span>}
                {option.installer !== 'unarchiver' && option.installer !== 'executable' && (
                  <span className="tag amber">{option.installer}</span>
                )}
                {option.sizeBytes && <span className="tag">{formatBytes(option.sizeBytes)}</span>}
                {option.current && <span className="tag blue">当前</span>}
                {!option.current && option.installed && <span className="tag">已安装</span>}
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                {option.current ? (
                  option.installed && (
                    <button type="button" className="btn sm danger" onClick={() => void uninstall(selectedSdk, option.version)}>
                      <Trash2 size={12} /> 删除
                    </button>
                  )
                ) : option.installed ? (
                  <>
                    <button type="button" className="btn sm" onClick={() => void useVersion(selectedSdk, option.version)}>
                      <Check size={12} /> 设为当前
                    </button>
                    <button type="button" className="btn sm danger" onClick={() => void uninstall(selectedSdk, option.version)}>
                      <Trash2 size={12} />
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="btn sm primary"
                    disabled={!option.installable}
                    title={option.unavailableReason ?? ''}
                    onClick={() => void startInstall(selectedSdk, option.version)}
                  >
                    <Download size={12} /> {option.installable ? '安装' : '不可用'}
                  </button>
                )}
              </div>
            </div>
          ))}
          {filtered.length > visible.length && (
            <button
              type="button"
              className="btn sm"
              style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}
              onClick={() => setLimit((current) => current + PAGE_SIZE)}
            >
              再显示 {Math.min(PAGE_SIZE, filtered.length - visible.length)} 个版本
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
