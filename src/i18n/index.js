// src/i18n/index.js
//
// Minimal i18n loader — same JSON key format and {0} placeholder syntax as
// vue-i18n (the translation files are reused verbatim), without the library.
// Default locale: saved → browser language → 'en'.

import { useSyncExternalStore } from 'react';
import en from './en.json';
import zh from './zh.json';
import es from './es.json';
import de from './de.json';

export const messages = { en, zh, es, de };
export const LOCALES = ['en', 'zh', 'es', 'de'];

const listeners = new Set();
let locale = getDefaultLocale();

function getDefaultLocale() {
  const saved = localStorage.getItem('locale');
  if (saved && LOCALES.includes(saved)) return saved;
  const browserLanguage = navigator.language.split('-')[0];
  if (LOCALES.includes(browserLanguage)) return browserLanguage;
  return 'en';
}

export function getLocale() {
  return locale;
}

export function setLocale(next) {
  locale = next;
  localStorage.setItem('locale', next);
  listeners.forEach((fn) => fn());
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function lookup(key) {
  const path = key.split('.');
  let node = messages[locale];
  for (const part of path) {
    if (node == null) return undefined;
    node = node[part];
  }
  if (node == null) {
    // fallback: en
    node = messages.en;
    for (const part of path) {
      if (node == null) return undefined;
      node = node[part];
    }
  }
  return typeof node === 'string' ? node : undefined;
}

// t('history.challengeEnds', [time]) → replaces {0}, {1}, …
export function t(key, ...args) {
  const template = lookup(key);
  if (template === undefined) return key;
  if (args.length === 1 && Array.isArray(args[0])) args = args[0];
  return template.replace(/\{(\d+)\}/g, (m, i) => (args[i] !== undefined ? String(args[i]) : m));
}

export function useI18n() {
  useSyncExternalStore(subscribe, getLocale);
  return { t, locale, setLocale, locales: LOCALES };
}
