import type { ThemeMode } from '../../shared/types';

export type { ThemeMode };

/** Mirrors `settings.theme`; also cached in localStorage so the first paint does not flash. */
export const THEME_KEY = 'bigenv.theme';

export const THEME_OPTIONS: { id: ThemeMode; label: string }[] = [
  { id: 'system', label: '随系统' },
  { id: 'light', label: '明亮' },
  { id: 'dark', label: '暗色' },
];

export function readCachedTheme(): ThemeMode {
  try {
    const value = localStorage.getItem(THEME_KEY);
    if (value === 'light' || value === 'dark' || value === 'system') return value;
  } catch {
    // localStorage can be unavailable (privacy mode); the default is still correct.
  }
  return 'system';
}

/**
 * Writes the palette choice onto `<html data-theme>`. The stylesheet keys both the
 * explicit palettes and the `system` media query off this attribute, so the renderer
 * never has to re-render anything when the OS flips.
 */
export function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement;
  root.dataset.theme = mode;
  root.style.colorScheme = mode === 'light' ? 'light' : mode === 'dark' ? 'dark' : '';
  try {
    localStorage.setItem(THEME_KEY, mode);
  } catch {
    // Persistence is best-effort; settings.json remains the source of truth.
  }
}
