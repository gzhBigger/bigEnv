import type { JSX } from 'react';
import { useMemo, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { useApp } from '../store';
import { formatBytes, glyphOf } from '../lib/format';
import { SDK_CATEGORIES, categoryRank } from '../../shared/categories';

export function Catalog(): JSX.Element {
  const catalog = useApp((state) => state.catalog);
  const catalogLoading = useApp((state) => state.catalogLoading);
  const refreshCatalog = useApp((state) => state.refreshCatalog);
  const openSdk = useApp((state) => state.openSdk);
  const settings = useApp((state) => state.settings);
  const installed = useApp((state) => state.installed);

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('全部');

  const categories = useMemo(() => {
    const present = new Set(catalog.map((sdk) => sdk.category));
    const ordered = SDK_CATEGORIES.filter((item) => present.has(item));
    const extras = [...present].filter((item) => categoryRank(item) === SDK_CATEGORIES.length).sort();
    return ['全部', ...ordered, ...extras];
  }, [catalog]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return catalog
      .filter((sdk) => (category === '全部' ? true : sdk.category === category))
      .filter((sdk) => (settings?.showUnsupported ? true : sdk.installable))
      .filter((sdk) =>
        keyword.length === 0
          ? true
          : sdk.name.toLowerCase().includes(keyword) ||
            sdk.id.toLowerCase().includes(keyword) ||
            sdk.description.toLowerCase().includes(keyword),
      )
      .sort((a, b) => {
        const aInstalled = a.currentVersion ? 0 : a.installable ? 1 : 2;
        const bInstalled = b.currentVersion ? 0 : b.installable ? 1 : 2;
        if (aInstalled !== bInstalled) return aInstalled - bInstalled;
        const byCategory = categoryRank(a.category) - categoryRank(b.category);
        if (byCategory !== 0) return byCategory;
        return a.name.localeCompare(b.name);
      });
  }, [catalog, category, query, settings?.showUnsupported]);

  const installedBytes = installed.reduce((sum, item) => sum + item.sizeBytes, 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>SDK 目录</h1>
          <p>
            版本元数据来自 vsources（vmr 官方数据源），共 {catalog.length} 个条目。
            安装包与校验和在安装时实时拉取，本机已占用 {formatBytes(installedBytes)}。
          </p>
        </div>
        <div className="actions">
          <button type="button" className="btn" onClick={() => void refreshCatalog(true)} disabled={catalogLoading}>
            <RefreshCw size={13} className={catalogLoading ? 'spin' : ''} />
            刷新
          </button>
        </div>
      </div>

      <div className="spread" style={{ marginBottom: 14, gap: 12 }}>
        <div className="tabbar">
          {categories.map((item) => (
            <button key={item} type="button" className={item === category ? 'on' : ''} onClick={() => setCategory(item)}>
              {item}
            </button>
          ))}
        </div>
        <div className="row" style={{ marginLeft: 'auto' }}>
          <div style={{ position: 'relative' }}>
            <Search size={13} style={{ position: 'absolute', left: 9, top: 9, color: 'var(--dim)' }} />
            <input
              className="input search"
              style={{ paddingLeft: 28 }}
              placeholder="搜索 SDK 名称或说明"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>
      </div>

      {filtered.length === 0 && <div className="empty">没有匹配的 SDK，换个关键词或分类试试。</div>}

      <div className="sdk-grid">
        {filtered.map((sdk) => (
          <div
            key={sdk.id}
            className={`sdk-card ${sdk.installable ? '' : 'dim'}`}
            onClick={() => openSdk(sdk.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') openSdk(sdk.id);
            }}
          >
            <div className="sdk-top">
              <span className="sdk-glyph">{glyphOf(sdk.name, sdk.id)}</span>
              <div style={{ minWidth: 0 }}>
                <div className="sdk-name">{sdk.name}</div>
                <div className="sdk-id mono">{sdk.id}</div>
              </div>
              {sdk.currentVersion && <span className="tag green" style={{ marginLeft: 'auto' }}>{sdk.currentVersion}</span>}
            </div>
            <div className="sdk-desc">{sdk.description}</div>
            <div className="sdk-foot">
              <span className="tag">{sdk.category}</span>
              <span className="tag">{sdk.versionCount} 版本</span>
              {sdk.latestLts && <span className="tag blue">LTS</span>}
              {!sdk.installable && <span className="tag amber">{sdk.unavailableReason ?? '当前平台不可用'}</span>}
              {sdk.installedVersions.length > 0 && (
                <span className="tag green" style={{ marginLeft: 'auto' }}>
                  已装 {sdk.installedVersions.length}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
