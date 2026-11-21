export type Theme = 'light' | 'dark' | 'parchment' | 'forest' | 'midnight' | 'rose' | 'contrast';

export interface ThemeInfo { id: Theme; label: string; /** preview colours: surface, text, accent */ swatch: [string, string, string]; dark: boolean }

export const THEMES: ThemeInfo[] = [
  { id: 'light', label: 'Light', swatch: ['#ffffff', '#1d2230', '#1c7ed6'], dark: false },
  { id: 'dark', label: 'Dark', swatch: ['#1b1e25', '#e8eaf0', '#4da3ff'], dark: true },
  { id: 'parchment', label: 'Parchment', swatch: ['#f6ecd6', '#3b2d1c', '#a24b1a'], dark: false },
  { id: 'forest', label: 'Forest', swatch: ['#16241d', '#e3efe6', '#58c27d'], dark: true },
  { id: 'midnight', label: 'Midnight', swatch: ['#12122b', '#e6e6ff', '#9b8cff'], dark: true },
  { id: 'rose', label: 'Rose', swatch: ['#fff1f4', '#3d1d2a', '#d6336c'], dark: false },
  { id: 'contrast', label: 'High contrast', swatch: ['#000000', '#ffffff', '#ffd400'], dark: true },
];

const listeners = new Set<() => void>();
const THEME_KEY = 'vtt-theme';
const ACCENT_KEY = 'vtt-accent';

export function getTheme(): Theme {
  const t = document.documentElement.dataset.theme as Theme | undefined;
  return THEMES.some((x) => x.id === t) ? (t as Theme) : 'light';
}

export function setTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem(THEME_KEY, t); } catch { /* private mode */ }
  applyAccent(getAccent()); // an accent override has to be re-derived against the new theme
  listeners.forEach((f) => f());
}

export function getAccent(): string | null {
  try { return localStorage.getItem(ACCENT_KEY); } catch { return null; }
}

/** A personal accent colour (buttons, highlights). null = the theme's own. */
export function setAccent(color: string | null) {
  try { if (color) localStorage.setItem(ACCENT_KEY, color); else localStorage.removeItem(ACCENT_KEY); } catch { /* ignore */ }
  applyAccent(color);
  listeners.forEach((f) => f());
}

function applyAccent(color: string | null) {
  const root = document.documentElement.style;
  if (!color) { root.removeProperty('--accent'); root.removeProperty('--accent-2'); return; }
  root.setProperty('--accent', color);
  root.setProperty('--accent-2', color);
}

/** Run once at startup (index.html applies the theme name early to avoid a flash). */
export function initTheme() {
  applyAccent(getAccent());
}

export function onThemeChange(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
