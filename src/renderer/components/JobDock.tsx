import type { JSX } from 'react';
import { useState } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { useApp } from '../store';
import { formatSpeed, percent, phaseText } from '../lib/format';

export function JobDock(): JSX.Element | null {
  const jobs = useApp((state) => state.jobs);
  const cancelJob = useApp((state) => state.cancelJob);
  const [collapsed, setCollapsed] = useState(false);

  const active = jobs.filter((job) => !['done', 'error', 'canceled'].includes(job.phase));
  const recent = jobs.filter((job) => ['done', 'error'].includes(job.phase)).slice(0, 2);
  const visible = [...active, ...recent];

  if (visible.length === 0) return null;

  return (
    <div className="dock">
      <div className="dock-head" onClick={() => setCollapsed((value) => !value)}>
        <span className="dot" style={{ background: active.length ? 'var(--accent)' : 'var(--accent-2)' }} />
        <span>{active.length > 0 ? `${active.length} 个任务进行中` : '最近任务'}</span>
        <span style={{ marginLeft: 'auto', color: 'var(--dim)' }}>
          {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
      </div>
      {!collapsed && (
        <div className="dock-body">
          {visible.map((job) => {
            const done = job.phase === 'done';
            const failed = job.phase === 'error' || job.phase === 'canceled';
            return (
              <div className="job" key={job.id}>
                <div className="job-line">
                  <span className="mono">
                    {job.sdk} <span style={{ color: 'var(--dim)' }}>{job.version}</span>
                  </span>
                  <span className="phase">
                    {phaseText(job.phase)} · {percent(job.progress)}
                    {job.phase === 'downloading' && job.speed > 0 ? ` · ${formatSpeed(job.speed)}` : ''}
                  </span>
                  {!done && !failed && (
                    <button
                      type="button"
                      className="btn ghost sm"
                      style={{ height: 20, padding: '0 4px' }}
                      onClick={(event) => {
                        event.stopPropagation();
                        void cancelJob(job.id);
                      }}
                      title="取消任务"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
                <div className="bar">
                  <i className={done ? 'ok' : failed ? 'err' : ''} style={{ width: `${Math.max(3, job.progress * 100)}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
