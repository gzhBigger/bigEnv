import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { Check, Download, FolderSearch, RefreshCw, RotateCw } from 'lucide-react';
import { bridge } from '../lib/bridge';
import { useApp } from '../store';
import type { MirrorMode, Settings as SettingsShape } from '../../shared/types';

const META_BASES = [
  { value: 'https://raw.githubusercontent.com/gvcgo/vsources/main', label: 'GitHub Raw（官方）' },
  { value: 'https://cdn.jsdelivr.net/gh/gvcgo/vsources@main', label: 'jsDelivr CDN（国内可用）' },
  { value: 'https://gh-proxy.com/https://raw.githubusercontent.com/gvcgo/vsources/main', label: 'gh-proxy 加速' },
];

const UPDATE_STATUS: Record<string, string> = {
  latest: '已经是最新版本',
  available: '有新版本可用',
  none: '仓库还没有发布版本',
  error: '检查更新失败',
  unknown: '尚未检查',
};

export function Settings(): JSX.Element {
  const settings = useApp((state) => state.settings);
  const saveSettings = useApp((state) => state.saveSettings);
  const busy = useApp((state) => state.busy);
  const update = useApp((state) => state.update);
  const checkingUpdate = useApp((state) => state.checkingUpdate);
  const downloadingUpdate = useApp((state) => state.downloadingUpdate);
  const checkUpdate = useApp((state) => state.checkUpdate);
  const downloadUpdate = useApp((state) => state.downloadUpdate);
  const [draft, setDraft] = useState<SettingsShape | null>(settings);

  useEffect(() => {
    if (settings) setDraft(settings);
  }, [settings]);

  if (!draft) return <div className="empty">正在读取设置…</div>;

  const patch = (values: Partial<SettingsShape>): void => setDraft({ ...draft, ...values });

  // Text fields still need an explicit save; switches persist immediately so a
  // stray navigation does not silently undo them.
  const dirty = Boolean(
    settings
      && (draft.installRoot !== settings.installRoot
        || draft.metaBase !== settings.metaBase
        || draft.mirror !== settings.mirror
        || draft.proxy !== settings.proxy
        || draft.concurrency !== settings.concurrency),
  );

  const pickRoot = async (): Promise<void> => {
    const picked = await bridge.system.pickDirectory();
    if (picked) patch({ installRoot: picked });
  };

  const updatesBusy = checkingUpdate || downloadingUpdate;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>设置</h1>
          <p>开关与主题即时生效；安装位置、元数据源与代理改完点“保存”后生效。</p>
        </div>
        <div className="actions">
          {dirty ? <span className="tag amber">有未保存的修改</span> : null}
          <button type="button" className="btn primary" disabled={busy === 'settings' || !dirty} onClick={() => void saveSettings(draft)}>
            <Check size={13} /> 保存
          </button>
        </div>
      </div>

      <div className="grid c2">
        <div className="card">
          <div className="card-head">
            <h2>安装与下载</h2>
          </div>
          <div className="field">
            <label>安装根目录</label>
            <div className="row">
              <input className="input" style={{ flex: 1 }} value={draft.installRoot} onChange={(event) => patch({ installRoot: event.target.value })} />
              <button type="button" className="btn" onClick={() => void pickRoot()}>
                <FolderSearch size={13} />
              </button>
            </div>
            <div className="desc">每个 SDK 会在这里拥有独立目录，current 链接指向激活版本。</div>
          </div>

          <div className="field">
            <label>元数据源</label>
            <select className="select" value={draft.metaBase} onChange={(event) => patch({ metaBase: event.target.value })}>
              {META_BASES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <div className="desc">读取 sdk-list / 版本表 / 安装配置的来源，可切换到国内 CDN。</div>
          </div>

          <div className="field">
            <label>下载镜像</label>
            <div className="tabbar" style={{ alignSelf: 'flex-start' }}>
              {(['cn', 'off'] as MirrorMode[]).map((mode) => (
                <button key={mode} type="button" className={draft.mirror === mode ? 'on' : ''} onClick={() => patch({ mirror: mode })}>
                  {mode === 'cn' ? '国内镜像优先' : '直连官方'}
                </button>
              ))}
            </div>
            <div className="desc">国内镜像会改写 nodejs.org、go.dev、flutter 与 GitHub Releases 的下载地址。</div>
          </div>

          <div className="field">
            <label>HTTP 代理</label>
            <input
              className="input"
              placeholder="http://127.0.0.1:7890（留空表示不使用）"
              value={draft.proxy}
              onChange={(event) => patch({ proxy: event.target.value })}
            />
          </div>

          <div className="field">
            <label>并发安装数</label>
            <input
              className="input"
              style={{ width: 90 }}
              type="number"
              min={1}
              max={6}
              value={draft.concurrency}
              onChange={(event) => patch({ concurrency: Number(event.target.value) || 1 })}
            />
          </div>
        </div>

        <div>
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card-head">
              <h2>界面</h2>
            </div>
            <div className="spread" style={{ padding: '6px 0' }}>
              <div>
                <div>显示当前平台不可安装的 SDK</div>
                <div className="desc">例如仅提供 conda 包或没有 Windows 构建的条目。</div>
              </div>
              <button
                type="button"
                className={`switch ${settings?.showUnsupported ? 'on' : ''}`}
                aria-label="显示不可安装 SDK"
                disabled={busy === 'settings'}
                onClick={() => void saveSettings({ showUnsupported: !settings?.showUnsupported })}
              />
            </div>
          </div>

          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card-head">
              <h2>版本与更新</h2>
            </div>
            <dl className="kv">
              <dt>当前版本</dt>
              <dd className="mono">{update?.current ?? bridge.runtime.version}</dd>
              <dt>最新版本</dt>
              <dd className="mono">{update?.latest ?? '—'}</dd>
              <dt>状态</dt>
              <dd>
                {update?.available ? (
                  <span className="tag green">{UPDATE_STATUS.available}</span>
                ) : update?.status === 'error' ? (
                  <span className="tag red">{UPDATE_STATUS.error}</span>
                ) : (
                  UPDATE_STATUS[update?.status ?? 'unknown']
                )}
              </dd>
            </dl>
            {update?.error ? <div className="desc mono" style={{ marginTop: 6 }}>{update.error}</div> : null}
            {update?.available ? (
              <div className="row" style={{ marginTop: 10 }}>
                <button type="button" className="btn primary" disabled={updatesBusy} onClick={() => void downloadUpdate()}>
                  {downloadingUpdate ? <RefreshCw size={13} className="spin" /> : <Download size={13} />}
                  {downloadingUpdate ? '正在下载…' : '下载更新'}
                </button>
                <button type="button" className="btn ghost" onClick={() => void bridge.updates.openPage()}>
                  打开发布页
                </button>
              </div>
            ) : (
              <div className="row" style={{ marginTop: 10 }}>
                <button type="button" className="btn" disabled={updatesBusy} onClick={() => void checkUpdate(true)}>
                  {checkingUpdate ? <RefreshCw size={13} className="spin" /> : <RotateCw size={13} />}
                  {checkingUpdate ? '正在检查…' : '检查更新'}
                </button>
                {update?.notes ? null : (
                  <button type="button" className="btn ghost" onClick={() => void bridge.updates.openPage()}>
                    打开发布页
                  </button>
                )}
              </div>
            )}
            {update?.available ? <div className="hint-text" style={{ marginTop: 8 }}>下载完成后会直接打开安装包；当前版本没有代码签名，Windows 可能提示 SmartScreen。</div> : null}
          </div>

          <div className="card">
            <div className="card-head">
              <h2>关于</h2>
            </div>
            <dl className="kv">
              <dt>版本</dt>
              <dd>{bridge.runtime.version}</dd>
              <dt>运行环境</dt>
              <dd>
                {bridge.runtime.platform} / {bridge.runtime.arch}
              </dd>
              <dt>Electron</dt>
              <dd>{bridge.runtime.electron || '—'}</dd>
              <dt>数据目录</dt>
              <dd className="mono" style={{ fontSize: 11.5 }}>{bridge.runtime.dataRoot || '—'}</dd>
            </dl>
            <div className="divider" />
            <div className="hint-text">
              版本元数据来自 vsources（gvcgo/vsources），安装布局与 vmr 兼容；本项目为独立实现，不复用其 Lua 插件运行时。
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
