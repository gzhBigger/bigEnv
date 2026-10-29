import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { Copy, Minus, Square, X } from 'lucide-react';
import { isDesktop } from '../lib/bridge';
import type { WindowState } from '../../shared/types';

const bridge = window.bigenv;

/**
 * Frameless window needs its own caption buttons; we trade the OS ones for a
 * compact, theme-aware set that matches the title bar.
 */
export function WindowControls(): JSX.Element | null {
  const [state, setState] = useState<WindowState>({ maximized: false, focused: true });

  useEffect(() => {
    if (!isDesktop || !bridge) return;
    setState(bridge.window.state());
    return bridge.window.onState(setState);
  }, []);

  // macOS keeps its native traffic lights, so no extra buttons there.
  if (!isDesktop || !bridge || bridge.runtime.platform === 'darwin') return null;

  return (
    <div className="win-controls">
      <button type="button" className="win-btn" aria-label="最小化" title="最小化" onClick={() => bridge.window.minimize()}>
        <Minus size={14} strokeWidth={1.8} />
      </button>
      <button
        type="button"
        className="win-btn"
        aria-label={state.maximized ? '还原' : '最大化'}
        title={state.maximized ? '还原' : '最大化'}
        onClick={() => bridge.window.toggleMaximize()}
      >
        {state.maximized ? <Copy size={12} strokeWidth={1.7} /> : <Square size={11} strokeWidth={1.8} />}
      </button>
      <button type="button" className="win-btn close" aria-label="关闭" title="关闭" onClick={() => bridge.window.close()}>
        <X size={14} strokeWidth={1.8} />
      </button>
    </div>
  );
}
