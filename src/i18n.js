import { createI18n } from 'vue-i18n';

// Import translation files
import en from './i18n/en.json';
import zh from './i18n/zh.json';
import es from './i18n/es.json';
import de from './i18n/de.json';

/**
 * Gets the default locale based on the following priority:
 * 1. The saved locale in localStorage.
 * 2. The browser's language.
 * 3. The fallback locale ('en').
 * @returns {string} The determined locale.
 */
function getDefaultLocale() {
  const savedLocale = localStorage.getItem('locale');
  if (savedLocale) {
    return savedLocale;
  }

  const browserLanguage = navigator.language.split('-')[0];
  const supportedLocales = ['en', 'zh', 'es', 'de'];
  if (supportedLocales.includes(browserLanguage)) {
    return browserLanguage;
  }

  return 'en'; // Fallback locale
}

export const i18n = createI18n({
  legacy: false, // Use Composition API
  locale: getDefaultLocale(),
  fallbackLocale: 'en', // Fallback to English if a translation is missing
  messages: { en, zh, es, de },
});