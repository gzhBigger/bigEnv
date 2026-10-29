import type { JSX } from 'react';
import { useApp } from '../store';

export function Toast(): JSX.Element | null {
  const toast = useApp((state) => state.toast);
  if (!toast) return null;
  return <div className={toast.kind === 'err' ? 'toast err' : 'toast'}>{toast.text}</div>;
}
