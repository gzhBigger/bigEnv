import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { Check, FolderSearch } from 'lucide-react';
import { bridge } from '../lib/bridge';
import { useApp } from '../store';
import type { MirrorMode, Settings as SettingsShape } from '../../shared/types';

const META_BASES = [
  { value: 'https://raw.githubusercontent.com/gvcgo/vsources/main', label: 'GitHub Raw（官方）' },
  { value: 'https://cdn.jsdelivr.net/gh/gvcgo/vsources@main', label: 'jsDelivr CDN（国内可用）' },
  { value: 'https://gh-proxy.com/https://raw.githubusercontent.com/gvcgo/vsources/main', label: 'gh-proxy 加速' },
];

export function Settings(): JSX.Element {
  const settings = useApp((state) => state.settings);
  const saveSettings = useApp((state) => state.saveSettings);
  const busy = useApp((state) => state.busy);
  const [draft, setDraft] = useState<SettingsShape | null>(settings);

  useEffect(() => {
    if (settings) setDraft(settings);
  }, [settings]);

  if (!draft) return <div className="empty">正在读取设置…</div>;

  const patch = (values: Partial<SettingsShape>): void => setDraft({ ...draft, ...values });

  const pickRoot = async (): Promise<void> => {
    const picked = await bridge.system.pickDirectory();
    if (picked) patch({ installRoot: picked });
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>设置</h1>
          <p>安装位置、元数据源与下载镜像都会即时生效；修改安装根目录后需要重新扫描已有版本。</p>
        </div>
        <div className="actions">
          <button type="button" className="btn primary" disabled={busy === 'settings'} onClick={() => void saveSettings(draft)}>
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
              <h2>界面与 Shell</h2>
            </div>
            <div className="spread" style={{ padding: '6px 0' }}>
              <div>
                <div>显示当前平台不可安装的 SDK</div>
                <div className="desc">例如仅提供 conda 包或没有 Windows 构建的条目。</div>
              </div>
              <button
                type="button"
                className={`switch ${draft.showUnsupported ? 'on' : ''}`}
                aria-label="显示不可安装 SDK"
                onClick={() => patch({ showUnsupported: !draft.showUnsupported })}
              />
            </div>
            <div className="divider" />
            <div className="spread" style={{ padding: '6px 0' }}>
              <div>
                <div>注入 PowerShell 配置</div>
                <div className="desc">启动新终端时自动加载 bigEnv 的 PATH 与变量。</div>
              </div>
              <button
                type="button"
                className={`switch ${draft.shellEnabled ? 'on' : ''}`}
                aria-label="注入 PowerShell 配置"
                onClick={() => patch({ shellEnabled: !draft.shellEnabled })}
              />
            </div>
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
