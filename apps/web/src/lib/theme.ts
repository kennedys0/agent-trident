export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'trident.theme';

export function readTheme(): Theme {
  const attribute = document.documentElement.dataset['theme'];
  return attribute === 'dark' ? 'dark' : 'light';
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset['theme'] = theme;
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage can be blocked; the in-memory attribute still applies for this session.
  }
}

export function toggleTheme(): Theme {
  const next: Theme = readTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  return next;
}