import type { JSX } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useEffect } from 'react';
import { isDesktop } from './lib/bridge';
import { useApp, type PageKey } from './store';
import { Sidebar } from './components/Sidebar';
import { JobDock } from './components/JobDock';
import { SdkSheet } from './components/SdkSheet';
import { ThemeSwitch } from './components/ThemeSwitch';
import { WindowControls } from './components/WindowControls';
import { Toast } from './components/Toast';
import { Overview } from './pages/Overview';
import { Catalog } from './pages/Catalog';
import { Jobs } from './pages/Jobs';
import { Projects } from './pages/Projects';
import { GlobalEnv } from './pages/GlobalEnv';
import { Health } from './pages/Health';
import { Settings } from './pages/Settings';

const TITLES: Record<PageKey, string> = {
  overview: '概览',
  catalog: 'SDK 目录',
  jobs: '安装队列',
  projects: '项目环境',
  globals: '全局环境',
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
    case 'globals':
      return <GlobalEnv />;
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

  // Frameless windows lose the OS double-click-to-maximize, so restore it here.
  const onTitlebarDoubleClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if ((event.target as HTMLElement).closest('button')) return;
    window.bigenv?.window.toggleMaximize();
  };

  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <div className="titlebar" onDoubleClick={onTitlebarDoubleClick}>
          <span className="crumb">bigEnv</span>
          <span className="crumb" style={{ color: 'var(--border-strong)' }}>
            /
          </span>
          <span className="crumb" style={{ color: 'var(--text)' }}>
            {TITLES[page]}
          </span>
          <span className="spacer" />
          {isDesktop ? null : <span className="hint">浏览器预览（模拟数据）</span>}
          <ThemeSwitch />
          <WindowControls />
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
