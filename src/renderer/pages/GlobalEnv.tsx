import type { JSX } from 'react';
import { useMemo, useRef } from 'react';
import { AlertTriangle, Loader2, RotateCw, TerminalSquare } from 'lucide-react';
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
  const pathModePending = useApp((state) => state.pathModePending);
  const pathSdksPending = useApp((state) => state.pathSdksPending);
  const pathError = useApp((state) => state.pathError);

  const selected = useMemo(() => new Set(shell?.pathSdks ?? []), [shell?.pathSdks]);
  const pending = useMemo(() => new Set(pathSdksPending ?? []), [pathSdksPending]);
  const writingSdks = pathSdksPending !== null;
  const writingMode = pathModePending !== null;
  const writing = writingSdks || writingMode || busy === 'path' || busy === 'path-sdks';
  const mode = shell?.pathMode ?? 'off';
  const lastAction = useRef<(() => void) | null>(null);

  const applyMode = (next: PathMode): void => {
    lastAction.current = () => void setPathMode(next);
    void setPathMode(next);
  };

  const applySdks = (next: string[]): void => {
    lastAction.current = () => void setPathSdks(next);
    void setPathSdks(next);
  };

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
    applySdks([...next]);
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>全局环境</h1>
          <p>
            这里决定「哪些运行时对所有程序可见」。只有点「启用」的 SDK 会把自己的{' '}
            <code>&lt;安装目录&gt;\&lt;sdk&gt;\current</code> 写进 PATH；切版本只换 junction 目标，已打开的终端下一条命令就生效。
          </p>
        </div>
        <div className="actions">
          <button type="button" className="btn" onClick={() => void bridge.env.openTerminal()}>
            <TerminalSquare size={14} /> 打开终端验证
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
            用户 PATH 立即生效、不需要额外授权；系统 PATH 对所有账户生效，选中时会弹出一次 Windows
            管理员授权（UAC）。关闭时会移除 bigEnv 写入的所有条目，不动其它内容。
          </div>
          <div className="tabbar" role="group" aria-label="PATH 生效范围">
            {PATH_MODES.map((modeItem) => (
              <button
                key={modeItem.id}
                type="button"
                className={shell?.pathMode === modeItem.id ? 'on' : ''}
                aria-pressed={shell?.pathMode === modeItem.id}
                disabled={writing}
                onClick={() => applyMode(modeItem.id)}
              >
                {pathModePending === modeItem.id && <Loader2 size={12} className="spin" />}
                {modeItem.label}
              </button>
            ))}
          </div>
        </div>
        {writingMode && (
          <>
            <div className="divider" />
            <div className="row" style={{ fontSize: 12, color: 'var(--muted)' }}>
              <Loader2 size={13} className="spin" />
              <span>
                正在{mode === 'off' || pathModePending === 'off' ? '移除' : '写入'}注册表 PATH，请稍候…
                {pathModePending === 'machine' && '（会弹出 Windows 管理员授权，请点「是」）'}
              </span>
            </div>
          </>
        )}
        {pathError && (
          <>
            <div className="divider" />
            <div className="row" style={{ fontSize: 12, color: 'var(--danger)' }}>
              <AlertTriangle size={13} />
              <span style={{ flex: 1 }}>PATH 写入失败：{pathError}</span>
              <button
                type="button"
                className="btn sm"
                disabled={writing}
                onClick={() => lastAction.current?.()}
              >
                <RotateCw size={12} /> 重试
              </button>
            </div>
          </>
        )}
        {shell?.pathMode === 'off' && (
          <>
            <div className="divider" />
            <div className="spread" style={{ gap: 12 }}>
              <div className="hint">
                当前没有把任何运行时写进全局 PATH。你在这里的启用结果会保存下来，重新开启「用户 PATH / 系统 PATH」后立即按结果写入。
              </div>
              <button
                type="button"
                className="btn sm primary"
                disabled={writing}
                onClick={() => applyMode('user')}
              >
                {pathModePending === 'user' ? <Loader2 size={12} className="spin" /> : null}
                立即写入用户 PATH
              </button>
            </div>
          </>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <h2>参与全局 PATH 的 SDK</h2>
          <span className="meta">
            {writingSdks ? (
              <span className="row" style={{ gap: 6 }}>
                <Loader2 size={12} className="spin" /> 正在写入 {pending.size} 个 SDK…
              </span>
            ) : (
              `${selected.size} 个已启用 · 共 ${rows.length} 个可发布`
            )}
          </span>
        </div>
        {rows.length === 0 && <div className="empty">还没有安装任何运行时。</div>}
        {rows.length > 1 && (
          <div className="spread" style={{ marginTop: 10 }}>
            <span className="hint">启用后写入的是 <code>&lt;安装目录&gt;\&lt;sdk&gt;\current</code>，切版本不用改 PATH。</span>
            <button
              type="button"
              className="btn sm"
              disabled={writing}
              onClick={() => applySdks(rows.every((row) => selected.has(row.sdk)) ? [] : rows.map((row) => row.sdk))}
            >
              {rows.every((row) => selected.has(row.sdk)) ? '全部停用' : '全部启用'}
            </button>
          </div>
        )}
        {rows.length > 0 && (
          <div className="env-table">
            {rows.map((row) => {
              const checked = writingSdks ? pending.has(row.sdk) : selected.has(row.sdk);
              const rowPending = writingSdks && pending.has(row.sdk) !== selected.has(row.sdk);
              const status = rowPending
                ? { cls: 'amber', text: '写入中' }
                : checked
                  ? mode === 'off'
                    ? { cls: '', text: '仅记录' }
                    : { cls: 'green', text: '已发布' }
                  : { cls: '', text: '未发布' };
              return (
                <div key={row.sdk} className={`env-row${checked ? ' on' : ''}${rowPending ? ' pending' : ''}`}>
                  <span className="sdk-glyph sm">{glyphOf(row.name, row.sdk)}</span>
                  <div className="env-row-name">
                    <strong>{row.name}</strong>
                    <span className="muted mono">{row.entry}</span>
                  </div>
                  {row.current && <span className="tag blue">{row.current}</span>}
                  {!row.current && <span className="tag amber">未激活</span>}
                  <span className={`tag ${status.cls}`}>
                    {rowPending && <Loader2 size={11} className="spin" />}
                    {status.text}
                  </span>
                  <button
                    type="button"
                    className={`btn sm${checked ? '' : ' primary'}`}
                    disabled={writing}
                    aria-label={`${checked ? '停用' : '启用'} ${row.name}`}
                    onClick={() => toggle(row.sdk, !checked)}
                  >
                    {checked ? '停用' : '启用'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {phantom.length > 0 && (
          <>
            <div className="divider" />
            {phantom.map((sdk) => (
              <div key={sdk} className="env-row pending">
                <div className="env-row-name">
                  <strong>{sdk}</strong>
                  <span className="muted">
                    {writingSdks && pending.has(sdk)
                      ? '正在从 PATH 移除…'
                      : '已不在本机安装，点「移除」即可从 PATH 清掉'}
                  </span>
                </div>
                {writingSdks && pending.has(sdk) && (
                  <span className="tag amber">
                    <Loader2 size={11} className="spin" /> 移除中
                  </span>
                )}
                <button
                  type="button"
                  className="btn sm danger"
                  disabled={writing}
                  aria-label={`从 PATH 移除 ${sdk}`}
                  onClick={() => toggle(sdk, false)}
                >
                  移除
                </button>
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
