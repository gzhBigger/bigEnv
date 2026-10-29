import type { JSX } from 'react';
import { useEffect } from 'react';
import { isDesktop } from './lib/bridge';
import { useApp, type PageKey } from './store';
import { Sidebar } from './components/Sidebar';
import { JobDock } from './components/JobDock';
import { SdkSheet } from './components/SdkSheet';
import { Toast } from './components/Toast';
import { Overview } from './pages/Overview';
import { Catalog } from './pages/Catalog';
import { Jobs } from './pages/Jobs';
import { Projects } from './pages/Projects';
import { Environment } from './pages/Environment';
import { Health } from './pages/Health';
import { Settings } from './pages/Settings';

const TITLES: Record<PageKey, string> = {
  overview: '概览',
  catalog: 'SDK 目录',
  jobs: '安装队列',
  projects: '项目环境',
  environment: 'Shell 集成',
  health: '体检与清理',
  settings: '设置',
};

function PageContent({ page }: { page: PageKey }): JSX.Element {
  switch (page) {
    case 'catalog':
      return <Catalog />;
    case 'jobs':
      return <Jobs />;
    case 'projects':
      return <Projects />;
    case 'environment':
      return <Environment />;
    case 'health':
      return <Health />;
    case 'settings':
      return <Settings />;
    default:
      return <Overview />;
  }
}

export function App(): JSX.Element {
  const page = useApp((state) => state.page);
  const init = useApp((state) => state.init);

  useEffect(() => {
    void init();
  }, [init]);

  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <div className="titlebar">
          <span className="crumb">bigEnv</span>
          <span className="crumb" style={{ color: 'var(--border-strong)' }}>
            /
          </span>
          <span className="crumb" style={{ color: 'var(--text)' }}>
            {TITLES[page]}
          </span>
          <span className="spacer" />
          <span className="hint">{isDesktop ? '桌面模式' : '浏览器预览（模拟数据）'}</span>
        </div>
        <div className="scroll">
          <PageContent page={page} />
        </div>
      </div>
      <JobDock />
      <SdkSheet />
      <Toast />
    </div>
  );
}
