import type { JSX } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { FolderGit2, FolderPlus, SquareArrowOutUpRight, TerminalSquare, Trash2 } from 'lucide-react';
import { useApp } from '../store';
import { bridge } from '../lib/bridge';
import { glyphOf } from '../lib/format';

export function Projects(): JSX.Element {
  const projects = useApp((state) => state.projects);
  const projectDir = useApp((state) => state.projectDir);
  const installed = useApp((state) => state.installed);
  const catalog = useApp((state) => state.catalog);
  const busy = useApp((state) => state.busy);
  const setPage = useApp((state) => state.setPage);
  const addProject = useApp((state) => state.addProject);
  const removeProject = useApp((state) => state.removeProject);
  const saveProject = useApp((state) => state.saveProject);
  const loadProjects = useApp((state) => state.loadProjects);
  const openSdk = useApp((state) => state.openSdk);
  const notify = useApp((state) => state.notify);

  const [draft, setDraft] = useState<Record<string, string>>({});

  const project = useMemo(
    () => projects.find((item) => item.dir === projectDir) ?? projects[0] ?? null,
    [projects, projectDir],
  );

  useEffect(() => {
    if (!project) {
      setDraft({});
      return;
    }
    setDraft({ ...project.versions });
  }, [project?.dir, project?.versions]);

  useEffect(() => {
    void loadProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const record of installed) {
      const list = map.get(record.sdk) ?? [];
      list.push(record.version);
      map.set(record.sdk, list);
    }
    // Lock entries survive an uninstall: the SDK must stay listed so it can be switched off again.
    for (const sdk of Object.keys(project?.versions ?? {})) {
      if (!map.has(sdk)) map.set(sdk, []);
    }
    return [...map.entries()]
      .map(([sdk, versions]) => ({ sdk, versions: versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true })) }))
      .sort((a, b) => a.sdk.localeCompare(b.sdk));
  }, [installed, project?.versions]);

  const nameOf = (sdk: string): string => catalog.find((item) => item.id === sdk)?.name ?? sdk;

  const toggle = (sdk: string, version: string, on: boolean): void => {
    setDraft((current) => {
      const next = { ...current };
      if (on) next[sdk] = version;
      else delete next[sdk];
      return next;
    });
  };

  const add = async (): Promise<void> => {
    const dir = await bridge.system.pickDirectory();
    if (dir) await addProject(dir);
  };

  const dirty = useMemo(() => {
    if (!project) return false;
    const normalize = (value: Record<string, string>): string =>
      JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
    return normalize(draft) !== normalize(project.versions);
  }, [draft, project]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>项目环境</h1>
          <p>
            每个项目目录独立记录要用哪些运行时、哪个版本（写入项目根目录的 <code>.bigenv.json</code>）。
            打开终端或运行 <code>bigenv run</code> 时只激活这里勾选的 SDK，而不是全部。
          </p>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => void add()}>
            <FolderPlus size={15} /> 添加目录
          </button>
        </div>
      </div>

      {projects.length === 0 ? (
        <div className="empty">
          <FolderGit2 size={26} />
          <p>还没有添加项目目录</p>
          <button className="btn primary" onClick={() => void add()}>
            <FolderPlus size={15} /> 选择项目文件夹
          </button>
        </div>
      ) : (
        <div className="projects-layout">
          <div className="card project-list">
            {projects.map((item) => (
              <button
                key={item.dir}
                className={`project-item${item.dir === project?.dir ? ' active' : ''}`}
                onClick={() => useApp.setState({ projectDir: item.dir })}
              >
                <div className="project-item-main">
                  <strong>{item.name}</strong>
                  <span className="muted">{item.dir}</span>
                </div>
                <span className={`tag${Object.keys(item.versions).length > 0 ? ' green' : ''}`}>
                  {Object.keys(item.versions).length} 个 SDK
                </span>
                <span
                  className="icon-btn"
                  title="移除"
                  onClick={(event) => {
                    event.stopPropagation();
                    void removeProject(item.dir);
                  }}
                >
                  <Trash2 size={14} />
                </span>
              </button>
            ))}
          </div>

          {project ? (
            <div className="card project-editor">
              <div className="project-head">
                <div>
                  <h3>{project.name}</h3>
                  <span className="muted mono">{project.dir}</span>
                </div>
                <div className="chip-row">
                  <button
                    className="btn ghost sm"
                    onClick={() => void bridge.system.openPath(project.dir)}
                  >
                    <SquareArrowOutUpRight size={14} /> 打开目录
                  </button>
                  <button className="btn ghost sm" onClick={() => void bridge.projects.openTerminal(project.dir)}>
                    <TerminalSquare size={14} /> 在此开终端
                  </button>
                </div>
              </div>

              <p className="muted hint">
                勾选要在这个项目里启用的 SDK 及其版本；未勾选的一律不注入环境。已卸载的 SDK 会保留在列表并标记「未安装」，取消勾选即可从配置中移除。保存后写入{' '}
                <code>{project.lockFile ?? `${project.dir}\\.bigenv.json`}</code>。
              </p>

              {grouped.length === 0 ? (
                <div className="empty">
                  <p>还没有安装任何运行时</p>
                  <button className="btn primary" onClick={() => setPage('catalog')}>
                    去 SDK 目录安装
                  </button>
                </div>
              ) : (
                <div className="env-table">
                  {grouped.map(({ sdk, versions }) => {
                    const checked = draft[sdk];
                    const missing = checked !== undefined && !versions.includes(checked);
                    return (
                      <div key={sdk} className={`env-row${checked ? ' on' : ''}`}>
                        <input
                          type="checkbox"
                          checked={checked !== undefined}
                          onChange={(event) => toggle(sdk, checked ?? versions[0] ?? '', event.target.checked)}
                        />
                        <span className="sdk-glyph sm">{glyphOf(nameOf(sdk), sdk)}</span>
                        <div className="env-row-name">
                          <strong>{nameOf(sdk)}</strong>
                          <span className="muted mono">{sdk}</span>
                        </div>
                        <select
                          className="select sm"
                          value={checked ?? ''}
                          disabled={checked === undefined || versions.length === 0}
                          onChange={(event) => toggle(sdk, event.target.value, true)}
                        >
                          {checked === undefined ? <option value="">未启用</option> : null}
                          {missing ? <option value={checked}>{checked}（未安装）</option> : null}
                          {versions.map((version) => (
                            <option key={version} value={version}>
                              {version}
                            </option>
                          ))}
                        </select>
                        <button className="icon-btn" title="安装其他版本" onClick={() => openSdk(sdk)}>
                          <FolderPlus size={14} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {Object.keys(project.versions).length > 0 ? (
                <div className="divider" />
              ) : null}
              {Object.keys(project.versions).length > 0 ? (
                <div className="lock-summary">
                  <span className="muted">当前记录：</span>
                  {Object.entries(project.versions).map(([sdk, version]) => (
                    <span key={sdk} className="tag blue">
                      {sdk}@{version}
                    </span>
                  ))}
                </div>
              ) : null}

              <div className="project-actions">
                <button
                  className="btn primary"
                  disabled={!dirty || busy === 'project'}
                  onClick={() => void saveProject(project.dir, draft)}
                >
                  保存环境
                </button>
                <button
                  className="btn ghost"
                  onClick={() => {
                    setDraft({ ...project.versions });
                    notify('已还原为上次保存的环境');
                  }}
                >
                  还原
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

