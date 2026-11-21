export type Theme = 'light' | 'dark';

const listeners = new Set<() => void>();

export function getTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export function setTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('vtt-theme', t); } catch { /* private mode */ }
  listeners.forEach((f) => f());
}

export function onThemeChange(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
