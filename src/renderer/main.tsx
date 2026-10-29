import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyTheme, readCachedTheme } from './lib/theme';
import './styles.css';

// Paint the cached palette before the first React render so a dark session never flashes light.
applyTheme(readCachedTheme());

const container = document.getElementById('root');
if (!container) throw new Error('#root 容器缺失');

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
