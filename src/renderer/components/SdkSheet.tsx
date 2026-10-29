import type { JSX } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { X, ExternalLink, Download, Check, Trash2, Search, RefreshCw } from 'lucide-react';
import { bridge } from '../lib/bridge';
import { useApp } from '../store';
import { formatBytes, glyphOf } from '../lib/format';

const PAGE_SIZE = 60;

type Tab = 'installed' | 'available';

export function SdkSheet(): JSX.Element | null {
  const selectedSdk = useApp((state) => state.selectedSdk);
  const catalog = useApp((state) => state.catalog);
  const versions = useApp((state) => state.versions);
  const versionsLoading = useApp((state) => state.versionsLoading);
  const versionsError = useApp((state) => state.versionsError);
  const closeSdk = useApp((state) => state.closeSdk);
  const reloadVersions = useApp((state) => state.reloadVersions);
  const startInstall = useApp((state) => state.startInstall);
  const useVersion = useApp((state) => state.useVersion);
  const uninstall = useApp((state) => state.uninstall);

  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [tab, setTab] = useState<Tab>('installed');

  useEffect(() => {
    setQuery('');
    setLimit(PAGE_SIZE);
  }, [selectedSdk]);

  const list = selectedSdk ? versions[selectedSdk] ?? [] : [];
  const error = selectedSdk ? versionsError[selectedSdk] ?? '' : '';

  const installedList = useMemo(() => list.filter((option) => option.installed), [list]);

  // Default to the list that actually has content: installed runtimes first, otherwise all versions.
  useEffect(() => {
    if (list.length === 0) return;
    setTab(installedList.length > 0 ? 'installed' : 'available');
    // Only re-decide when the drawer switches SDK or the data arrives for the first time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSdk, list.length]);

  const source = tab === 'installed' ? installedList : list;

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return source;
    return source.filter((option) => option.version.toLowerCase().includes(keyword));
  }, [source, query]);

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

        <div className="sheet-tabs">
          {(
            [
              { id: 'installed' as Tab, label: `已安装 ${installedList.length}` },
              { id: 'available' as Tab, label: `可安装 ${list.length}` },
            ]
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              className={tab === item.id ? 'active' : ''}
              onClick={() => {
                setTab(item.id);
                setLimit(PAGE_SIZE);
              }}
            >
              {item.label}
            </button>
          ))}
          <button
            type="button"
            className="btn ghost sm"
            style={{ marginLeft: 'auto' }}
            title="重新读取版本"
            onClick={() => void reloadVersions(selectedSdk)}
          >
            <RefreshCw size={12} /> 刷新
          </button>
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
            {filtered.length} / {source.length}
          </span>
        </div>
        <div className="sheet-body">
          {loading && (
            <div className="row" style={{ color: 'var(--dim)', padding: '18px 4px' }}>
              <span className="loading" /> 正在读取版本列表…
            </div>
          )}
          {!loading && error && (
            <div className="empty">
              <p>读取版本失败：{error}</p>
              <button className="btn sm" onClick={() => void reloadVersions(selectedSdk)}>
                <RefreshCw size={12} /> 重试
              </button>
            </div>
          )}
          {!loading && !error && list.length === 0 && <div className="empty">暂无该 SDK 的版本元数据</div>}
          {!loading && !error && list.length > 0 && source.length === 0 && (
            <div className="empty">{tab === 'installed' ? '还没有安装任何版本' : '没有可安装的版本'}</div>
          )}
          {!loading && !error && source.length > 0 && filtered.length === 0 && (
            <div className="empty">没有匹配“{query}”的版本</div>
          )}
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
                {!option.installable && !option.installed && (
                  <span className="tag amber">{option.unavailableReason ?? '不可安装'}</span>
                )}
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
