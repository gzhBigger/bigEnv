import type { JSX } from 'react';
import {
  Boxes,
  FolderGit2,
  GaugeCircle,
  Globe2,
  ListChecks,
  Settings2,
  Stethoscope,
  TerminalSquare,
  type LucideIcon,
} from 'lucide-react';
import { useApp, type PageKey } from '../store';

interface NavEntry {
  key: PageKey;
  label: string;
  icon: LucideIcon;
}

const MAIN: NavEntry[] = [
  { key: 'overview', label: '概览', icon: GaugeCircle },
  { key: 'catalog', label: 'SDK 目录', icon: Boxes },
  { key: 'jobs', label: '安装队列', icon: ListChecks },
];

const TOOLS: NavEntry[] = [
  { key: 'projects', label: '项目环境', icon: FolderGit2 },
  { key: 'globals', label: '全局环境', icon: Globe2 },
  { key: 'environment', label: 'Shell 集成', icon: TerminalSquare },
  { key: 'health', label: '体检与清理', icon: Stethoscope },
  { key: 'settings', label: '设置', icon: Settings2 },
];

export function Sidebar(): JSX.Element {
  const page = useApp((state) => state.page);
  const setPage = useApp((state) => state.setPage);
  const jobs = useApp((state) => state.jobs);
  const activeJobs = jobs.filter((job) => !['done', 'error', 'canceled'].includes(job.phase)).length;

  const renderNav = (entries: NavEntry[]): JSX.Element[] =>
    entries.map((entry) => {
      const Icon = entry.icon;
      const count = entry.key === 'jobs' && activeJobs > 0 ? activeJobs : null;
      return (
        <button
          key={entry.key}
          type="button"
          className={`nav-item ${page === entry.key ? 'active' : ''}`}
          onClick={() => setPage(entry.key)}
          aria-current={page === entry.key ? 'page' : undefined}
        >
          <Icon size={15} strokeWidth={1.9} />
          <span>{entry.label}</span>
          {count !== null && <span className="count">{count}</span>}
        </button>
      );
    });

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">
          <TerminalSquare size={13} color="#04101f" strokeWidth={2.4} />
        </span>
        <span className="brand-name">bigEnv</span>
        <span className="brand-sub">0.1.0</span>
      </div>
      <nav className="nav">
        <div className="nav-label">工作区</div>
        {renderNav(MAIN)}
        <div className="nav-label">工具</div>
        {renderNav(TOOLS)}
      </nav>
      <div className="sidebar-foot">
        <div>
          <span className="dot" />
          元数据源在线
        </div>
        <div style={{ marginTop: 4 }}>Electron · React · TS</div>
      </div>
    </aside>
  );
}
