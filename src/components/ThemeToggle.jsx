// src/components/ThemeToggle.jsx
import { useSyncExternalStore } from 'react';
import { subscribe, getTheme, toggleTheme } from '@/ui/theme';
import { useI18n } from '@/i18n';

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getTheme);
  const { t } = useI18n();
  return (
    <button
      className="btn ghost small"
      onClick={toggleTheme}
      title={t('theme.title')}
      aria-label={t('theme.title')}
    >
      {theme === 'dark' ? '🌙' : '☀️'}
    </button>
  );
}
