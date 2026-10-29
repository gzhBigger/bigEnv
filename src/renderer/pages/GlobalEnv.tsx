import type { JSX } from 'react';
import { useMemo } from 'react';
import { AlertTriangle, Globe2 } from 'lucide-react';
import type { PathMode } from '../../shared/types';
import { bridge } from '../lib/bridge';
import { useApp } from '../store';
import { glyphOf } from '../lib/format';

const PATH_MODES: { id: PathMode; label: string }[] = [
  { id: 'off', label: '关闭' },
  { id: 'user', label: '用户 PATH' },
  { id: 'machine', label: '系统 PATH' },
];

export function GlobalEnv(): JSX.Element {
  const shell = useApp((state) => state.shell);
  const installed = useApp((state) => state.installed);
  const catalog = useApp((state) => state.catalog);
  const settings = useApp((state) => state.settings);
  const busy = useApp((state) => state.busy);
  const setPathMode = useApp((state) => state.setPathMode);
  const setPathSdks = useApp((state) => state.setPathSdks);

  const selected = useMemo(() => new Set(shell?.pathSdks ?? []), [shell?.pathSdks]);

  // One row per SDK that has an active version; the entry we would publish is `<installRoot>/<sdk>/current`.
  const rows = useMemo(() => {
    const map = new Map<string, { current: string | null; versions: string[] }>();
    for (const record of installed) {
      const item = map.get(record.sdk) ?? { current: null, versions: [] };
      item.versions.push(record.version);
      if (record.current) item.current = record.version;
      map.set(record.sdk, item);
    }
    return [...map.entries()]
      .map(([sdk, value]) => ({
        sdk,
        name: catalog.find((item) => item.id === sdk)?.name ?? sdk,
        current: value.current,
        versions: value.versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true })),
        entry: settings ? `${settings.installRoot}\\${sdk}\\current` : '',
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [installed, catalog, settings]);

  // Locked SDKs that are no longer installed still show up so they can be switched off.
  const phantom = useMemo(
    () => [...selected].filter((sdk) => !installed.some((record) => record.sdk === sdk)),
    [selected, installed],
  );

  const toggle = (sdk: string, on: boolean): void => {
    const next = new Set(selected);
    if (on) next.add(sdk);
    else next.delete(sdk);
    void setPathSdks([...next]);
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>全局环境</h1>
          <p>
            这里决定「哪些运行时对所有程序可见」。只有勾选的 SDK 会把自己的{' '}
            <code>&lt;安装目录&gt;\&lt;sdk&gt;\current</code> 写进 PATH；切版本只换 junction 目标，已打开的终端下一条命令就生效。
          </p>
        </div>
        <div className="actions">
          <button type="button" className="btn" onClick={() => void bridge.env.openTerminal()}>
            <Globe2 size={14} /> 验证一下
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-head">
          <h2>生效范围</h2>
          <span className="meta">
            {shell?.activeScope === 'machine'
              ? '已写入系统 PATH'
              : shell?.activeScope === 'user'
                ? '已写入用户 PATH'
                : '当前未写入 PATH'}
          </span>
        </div>
        <div className="spread" style={{ alignItems: 'flex-start' }}>
          <div style={{ fontSize: 12.5, color: 'var(--muted)', maxWidth: 540 }}>
            用户 PATH 立即生效、无需管理员；系统 PATH 对所有账户生效，但需要以管理员身份运行 bigEnv。
            关闭时会移除 bigEnv 写入的所有条目，不动其它内容。
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
        {shell?.pathMode === 'off' && (
          <>
            <div className="divider" />
            <div className="hint">
              当前没有把任何运行时写进全局 PATH。勾选结果会保存在设置里，重新开启「用户 PATH / 系统 PATH」后立即按勾选项写入。
            </div>
          </>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <h2>参与全局 PATH 的 SDK</h2>
          <span className="meta">
            {selected.size} 个已选 · 共 {rows.length} 个可发布
          </span>
        </div>
        {rows.length === 0 && <div className="empty">还没有安装任何运行时。</div>}
        {rows.length > 0 && (
          <div className="env-table">
            {rows.map((row) => {
              const checked = selected.has(row.sdk);
              return (
                <div key={row.sdk} className={`env-row${checked ? ' on' : ''}`}>
                  <input type="checkbox" checked={checked} onChange={(event) => toggle(row.sdk, event.target.checked)} />
                  <span className="sdk-glyph sm">{glyphOf(row.name, row.sdk)}</span>
                  <div className="env-row-name">
                    <strong>{row.name}</strong>
                    <span className="muted mono">{row.entry}</span>
                  </div>
                  {row.current && <span className="tag blue">{row.current}</span>}
                  {!row.current && <span className="tag amber">未激活</span>}
                </div>
              );
            })}
          </div>
        )}
        {phantom.length > 0 && (
          <>
            <div className="divider" />
            {phantom.map((sdk) => (
              <div key={sdk} className="env-row">
                <input type="checkbox" checked onChange={() => toggle(sdk, false)} />
                <div className="env-row-name">
                  <strong>{sdk}</strong>
                  <span className="muted">已不在本机安装，取消勾选即可从 PATH 移除</span>
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      <div className="grid c2" style={{ marginTop: 14 }}>
        <div className="card">
          <div className="card-head">
            <h2>已写入全局 PATH 的条目</h2>
            <span className="meta">{shell?.globalEntries.length ?? 0} 条</span>
          </div>
          {(!shell || shell.globalEntries.length === 0) && <div className="empty">没有发布任何运行时。</div>}
          {shell?.globalEntries.map((entry) => (
            <div key={entry} className="row" style={{ padding: '5px 0', fontSize: 12 }}>
              <span className="tag green">PATH</span>
              <span className="mono" style={{ fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {entry}
              </span>
            </div>
          ))}
          {shell && shell.globalEntries.length > 0 && shell.pathMode !== 'off' && (
            <>
              <div className="divider" />
              <div className="hint">这些目录排在 PATH 最前面，所以 bigEnv 的版本优先于其它安装。</div>
            </>
          )}
        </div>

        <div className="card">
          <div className="card-head">
            <h2>遮蔽检测</h2>
            <span className="meta">{shell?.conflicts.length ?? 0} 项冲突</span>
          </div>
          {(!shell || shell.conflicts.length === 0) && (
            <div className="empty">没有发现同名可执行文件被更靠前的目录抢先。</div>
          )}
          {shell?.conflicts.map((conflict) => (
            <div key={`${conflict.sdk}-${conflict.exe}`} className="row" style={{ padding: '5px 0', fontSize: 12 }}>
              <AlertTriangle size={13} color="var(--warn, #d6a84a)" />
              <span>
                <b>{conflict.exe}</b> 被更靠前的 <span className="mono">{conflict.shadowedBy}</span> 抢先，bigEnv 的{' '}
                {conflict.sdk} 不会生效
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-head">
          <h2>命令行入口</h2>
          <span className="meta">{shell?.pathMode === 'off' ? '未写入 PATH' : '随 PATH 一起发布'}</span>
        </div>
        <dl className="kv">
          <dt>CLI</dt>
          <dd className="mono" style={{ fontSize: 11.5 }}>{shell?.cliLauncher ?? '未生成'}</dd>
          <dt>用法</dt>
          <dd style={{ fontSize: 12 }}>
            {['bigenv run -- node -v', 'bigenv env --json', 'bigenv use node@24.4.0', 'bigenv which node'].map((line) => (
              <div key={line} style={{ padding: '2px 0' }}>
                <code>{line}</code>
              </div>
            ))}
          </dd>
        </dl>
      </div>
    </div>
  );
}
