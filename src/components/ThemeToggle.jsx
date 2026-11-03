// src/components/ThemeToggle.jsx
import { useSyncExternalStore } from 'react';
import { subscribe, getTheme, toggleTheme } from '@/ui/theme';
import { useI18n } from '@/i18n';

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getTheme);
  const { t } = useI18n();
  // Same shape as PermaDrive's toggle: glyph + current theme name, so the
  // state is readable instead of an icon-only guess (family consistency).
  const name = theme === 'light' ? t('theme.light') : t('theme.dark');
  return (
    <button
      className="btn ghost small theme-toggle"
      onClick={toggleTheme}
      title={t('theme.title', [name])}
      aria-label={t('theme.aria')}
    >
      {theme === 'light' ? `☀ ${t('theme.light')}` : `☾ ${t('theme.dark')}`}
    </button>
  );
}
