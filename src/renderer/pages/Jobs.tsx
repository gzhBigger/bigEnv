import type { JSX } from 'react';
import { X } from 'lucide-react';
import { useApp } from '../store';
import { formatSpeed, percent, phaseText } from '../lib/format';

export function Jobs(): JSX.Element {
  const jobs = useApp((state) => state.jobs);
  const cancelJob = useApp((state) => state.cancelJob);
  const clearJobs = useApp((state) => state.clearJobs);
  const refreshJobs = useApp((state) => state.refreshJobs);
  const finished = jobs.filter((job) => ['done', 'error', 'canceled'].includes(job.phase)).length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>安装队列</h1>
          <p>下载与解压串行排队执行（并发数可在设置中调整），失败会自动清理半成品目录并保留错误信息。</p>
        </div>
        <div className="actions">
          <button type="button" className="btn" onClick={() => void refreshJobs()}>
            刷新
          </button>
          <button type="button" className="btn ghost" disabled={finished === 0} onClick={() => void clearJobs()}>
            清空已完成（{finished}）
          </button>
        </div>
      </div>

      {jobs.length === 0 && <div className="empty">还没有任务记录。去 SDK 目录安装一个运行时试试。</div>}

      {jobs.map((job) => (
        <div className="card" key={job.id} style={{ marginBottom: 10 }}>
          <div className="spread">
            <div className="row">
              <span className={`tag ${job.phase === 'done' ? 'green' : job.phase === 'error' ? 'red' : 'blue'}`}>
                {phaseText(job.phase)}
              </span>
              <span className="mono">{job.sdk}</span>
              <span className="mono" style={{ color: 'var(--muted)' }}>
                {job.version}
              </span>
              <span className="hint-text">{job.message}</span>
            </div>
            <div className="row">
              <span className="hint-text">
                {percent(job.progress)}
                {job.speed > 0 && job.phase === 'downloading' ? ` · ${formatSpeed(job.speed)}` : ''}
              </span>
              {!['done', 'error', 'canceled'].includes(job.phase) && (
                <button type="button" className="btn sm ghost" onClick={() => void cancelJob(job.id)}>
                  <X size={12} /> 取消
                </button>
              )}
            </div>
          </div>
          <div className="bar" style={{ marginTop: 10 }}>
            <i
              className={job.phase === 'done' ? 'ok' : job.phase === 'error' ? 'err' : ''}
              style={{ width: `${Math.max(3, job.progress * 100)}%` }}
            />
          </div>
          <div className="spread" style={{ marginTop: 8 }}>
            <span className="hint-text">
              开始于 {new Date(job.startedAt).toLocaleTimeString('zh-CN')}
              {job.finishedAt ? ` · 结束于 ${new Date(job.finishedAt).toLocaleTimeString('zh-CN')}` : ''}
            </span>
            {job.installPath && <span className="hint-text mono">{job.installPath}</span>}
          </div>
          {job.error && (
            <div className="hint-text" style={{ color: 'var(--danger)', marginTop: 6 }}>
              {job.error}
            </div>
          )}
        </div>
      ))}
    </>
  );
}
