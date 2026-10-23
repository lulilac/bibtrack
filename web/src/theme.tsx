import { useState } from 'react';
import { Icon } from './icons.tsx';

export type Theme = 'system' | 'light' | 'dark';
const KEY = 'bibtrack.theme';

export const getTheme = (): Theme => {
  try { return (localStorage.getItem(KEY) as Theme) || 'system'; } catch { return 'system'; }
};

// 'system' removes the attribute so the prefers-color-scheme media query decides.
export function applyTheme(t: Theme) {
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

export function ThemeSwitch() {
  const [theme, setTheme] = useState(getTheme);
  const pick = (t: Theme) => {
    setTheme(t);
    applyTheme(t);
    try { localStorage.setItem(KEY, t); } catch {}
  };
  const opts: [Theme, keyof typeof Icon, string][] = [['system', 'monitor', 'System'], ['light', 'sun', 'Light'], ['dark', 'moon', 'Dark']];
  return (
    <div className="theme-switch" role="radiogroup" aria-label="Theme">
      {opts.map(([t, icon, label]) => (
        <button key={t} className={theme === t ? 'on' : ''} title={label} aria-checked={theme === t} role="radio" onClick={() => pick(t)}>
          {Icon[icon]}
        </button>
      ))}
    </div>
  );
}
