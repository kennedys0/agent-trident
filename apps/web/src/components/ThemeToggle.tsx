import { useEffect, useState, type ReactNode } from 'react';
import { Moon, Sun } from 'lucide-react';
import { readTheme, syncBrowserChrome, toggleTheme, type Theme } from '../lib/theme.js';

export function ThemeToggle(): ReactNode {
  const [theme, setTheme] = useState<Theme>(() => readTheme());
  const next = theme === 'dark' ? 'light' : 'dark';

  // The toolbar colour has to follow a stored theme that differs from the OS preference.
  useEffect(() => {
    syncBrowserChrome();
  }, []);

  return (
    <button
      type="button"
      className="btn btn--quiet btn--block"
      onClick={() => setTheme(toggleTheme())}
      aria-label={`Switch to ${next} theme`}
      data-testid="theme-toggle"
    >
      {theme === 'dark' ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
      {theme === 'dark' ? 'Light theme' : 'Dark theme'}
    </button>
  );
}