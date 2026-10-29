import type { JSX } from 'react';
import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { useApp } from '../store';
import { THEME_OPTIONS, type ThemeMode } from '../lib/theme';

const ICONS: Record<ThemeMode, LucideIcon> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
};

/** Three-way palette switch: follow the OS, or pin light / dark. */
export function ThemeSwitch(): JSX.Element {
  const theme = useApp((state) => state.settings?.theme ?? 'system');
  const setTheme = useApp((state) => state.setTheme);

  return (
    <div className="theme-switch" role="group" aria-label="主题">
      {THEME_OPTIONS.map((option) => {
        const Icon = ICONS[option.id];
        const active = theme === option.id;
        return (
          <button
            key={option.id}
            type="button"
            className={`theme-btn ${active ? 'on' : ''}`}
            aria-pressed={active}
            aria-label={`主题：${option.label}`}
            title={`主题：${option.label}`}
            onClick={() => void setTheme(option.id)}
          >
            <Icon size={13} strokeWidth={2} />
          </button>
        );
      })}
    </div>
  );
}
