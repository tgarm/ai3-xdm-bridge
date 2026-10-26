// src/ui/theme.js
//
// Dual theme (doc/07): dark is the default, light via html[data-theme='light'].
// Explicit choice persists in localStorage; otherwise follows the system.
// index.html sets data-theme inline before first paint to avoid a flash.

const listeners = new Set();

function initialTheme() {
  const saved = localStorage.getItem('theme');
  if (saved === 'dark' || saved === 'light') return saved;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

let theme = initialTheme();

export function getTheme() {
  return theme;
}

export function setTheme(next) {
  theme = next;
  localStorage.setItem('theme', next);
  document.documentElement.dataset.theme = next;
  listeners.forEach((fn) => fn());
}

export function toggleTheme() {
  setTheme(theme === 'dark' ? 'light' : 'dark');
}

export function initTheme() {
  document.documentElement.dataset.theme = theme;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
