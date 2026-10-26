// src/components/LanguageSelect.jsx
import { useI18n } from '@/i18n';

const languageNames = {
  en: 'English',
  zh: '中文',
  es: 'Español',
  de: 'Deutsch',
};

export function LanguageSelect() {
  const { locale, setLocale, locales } = useI18n();
  return (
    <select
      value={locale}
      onChange={(e) => setLocale(e.target.value)}
      aria-label="Language"
      style={{ fontSize: 12, padding: '4px 6px' }}
    >
      {locales.map((l) => (
        <option key={l} value={l}>{languageNames[l]}</option>
      ))}
    </select>
  );
}
