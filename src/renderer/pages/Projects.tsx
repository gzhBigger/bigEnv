import type { JSX } from 'react';
import { useState } from 'react';
import { FolderSearch, FolderOpen, Lock, Play, TerminalSquare } from 'lucide-react';
import { bridge } from '../lib/bridge';
import { useApp } from '../store';
import { formatBytes, glyphOf } from '../lib/format';

export function Projects(): JSX.Element {
  const project = useApp((state) => state.project);
  const installed = useApp((state) => state.installed);
  const catalog = useApp((state) => state.catalog);
  const inspectProject = useApp((state) => state.inspectProject);
  const lockProject = useApp((state) => state.lockProject);
  const startInstall = useApp((state) => state.startInstall);
  const useVersion = useApp((state) => state.useVersion);
  const notify = useApp((state) => state.notify);
  const [dir, setDir] = useState(project?.dir ?? '');

  const pick = async (): Promise<void> => {
    const picked = await bridge.system.pickDirectory();
    if (!picked) return;
    setDir(picked);
    await inspectProject(picked);
  };

  const writeCurrent = async (): Promise<void> => {
    const versions: Record<string, string> = {};
    for (const record of installed) if (record.current) versions[record.sdk] = record.version;
    if (Object.keys(versions).length === 0) {
      notify('当前没有激活的运行时', 'err');
      return;
    }
    await lockProject(versions);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>项目环境</h1>
          <p>
            在项目根目录写入 <code>.bigenv.json</code>（兼容 vmr 的 <code>.vmr.lock</code>），记录每个 SDK 期望的版本。
            打开终端时会按锁文件拼出 PATH，不会污染全局环境。
          </p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row">
          <input
            className="input"
            style={{ flex: 1 }}
            placeholder="项目目录，例如 D:\\workspace\\demo-shop"
            value={dir}
            onChange={(event) => setDir(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && dir.trim()) void inspectProject(dir.trim());
            }}
          />
          <button type="button" className="btn" onClick={() => void pick()}>
            <FolderSearch size={13} /> 选择
          </button>
          <button type="button" className="btn primary" disabled={!dir.trim()} onClick={() => void inspectProject(dir.trim())}>
            读取
          </button>
        </div>
      </div>

      {!project && <div className="empty">选择一个项目目录，或者把终端 cd 进去后在此读取。</div>}

      {project && (
        <>
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="spread">
              <div>
                <div style={{ fontWeight: 600 }}>锁文件</div>
                <div className="hint-text mono">{project.lockFile ?? '尚未创建锁文件'}</div>
              </div>
              <div className="row">
                <button type="button" className="btn" onClick={() => void bridge.system.openPath(project.dir)}>
                  <FolderOpen size={13} /> 打开目录
                </button>
                <button type="button" className="btn" onClick={() => void bridge.env.openTerminal(project.dir)}>
                  <TerminalSquare size={13} /> 在此打开终端
                </button>
                <button type="button" className="btn" onClick={() => void writeCurrent()}>
                  <Lock size={13} /> 写入当前环境
                </button>
              </div>
            </div>
          </div>

          {project.entries.length === 0 ? (
            <div className="empty">锁文件里还没有条目，点“写入当前环境”可以一键记录本机激活的版本。</div>
          ) : (
            <div className="card" style={{ padding: '4px 8px' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>SDK</th>
                    <th>锁定版本</th>
                    <th>本机状态</th>
                    <th style={{ textAlign: 'right' }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {project.entries.map((entry) => {
                    const summary = catalog.find((sdk) => sdk.id === entry.sdk);
                    const record = installed.find((item) => item.sdk === entry.sdk && item.version === entry.version);
                    return (
                      <tr key={entry.sdk}>
                        <td>
                          <div className="row">
                            <span className="sdk-glyph" style={{ width: 22, height: 22, fontSize: 10 }}>
                              {glyphOf(summary?.name ?? entry.sdk, entry.sdk)}
                            </span>
                            <span>{summary?.name ?? entry.sdk}</span>
                          </div>
                        </td>
                        <td className="mono">{entry.version}</td>
                        <td>
                          {entry.installed ? (
                            <span className="tag green">已安装</span>
                          ) : (
                            <span className="tag amber">缺失</span>
                          )}
                          {record && (
                            <span className="hint-text" style={{ marginLeft: 8 }}>
                              {formatBytes(record.sizeBytes)}
                            </span>
                          )}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                            {!entry.installed && (
                              <button type="button" className="btn sm primary" onClick={() => void startInstall(entry.sdk, entry.version)}>
                                <Play size={11} /> 安装
                              </button>
                            )}
                            {entry.installed && !record?.current && (
                              <button type="button" className="btn sm" onClick={() => void useVersion(entry.sdk, entry.version)}>
                                设为当前
                              </button>
                            )}
                            {record?.current && <span className="tag green">已激活</span>}
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
      )}
    </>
  );
}
