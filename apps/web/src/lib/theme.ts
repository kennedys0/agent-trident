export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'trident.theme';

export function readTheme(): Theme {
  const attribute = document.documentElement.dataset['theme'];
  return attribute === 'dark' ? 'dark' : 'light';
}

/**
 * Keeps the browser toolbar colour on the active theme instead of only on the OS
 * preference declared in index.html. The value is read from the `--canvas` token so
 * the colour is never duplicated here.
 */
export function syncBrowserChrome(): void {
  const canvas = getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim();
  if (canvas === '') {
    return;
  }
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    meta.setAttribute('content', canvas);
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset['theme'] = theme;
  syncBrowserChrome();
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