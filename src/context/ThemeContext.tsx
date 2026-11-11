'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  isDark: boolean;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'dark',
  isDark: true,
  toggleTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>('dark');

  useEffect(() => {
    const saved = (localStorage.getItem('dc_dashboard_theme') || localStorage.getItem('dc_chats_theme')) as Theme | null;
    if (saved === 'light' || saved === 'dark') {
      setTheme(saved);
      document.documentElement.setAttribute('data-theme', saved);
    } else {
      document.documentElement.setAttribute('data-theme', 'dark');
    }

    const handleSync = () => {
      const s = (localStorage.getItem('dc_dashboard_theme') || localStorage.getItem('dc_chats_theme')) as Theme | null;
      if (s === 'light' || s === 'dark') {
        setTheme(s);
        document.documentElement.setAttribute('data-theme', s);
      }
    };

    window.addEventListener('theme-change', handleSync);
    window.addEventListener('storage', handleSync);
    return () => {
      window.removeEventListener('theme-change', handleSync);
      window.removeEventListener('storage', handleSync);
    };
  }, []);

  const toggleTheme = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    localStorage.setItem('dc_dashboard_theme', next);
    localStorage.setItem('dc_chats_theme', next);
    document.documentElement.setAttribute('data-theme', next);
    window.dispatchEvent(new Event('theme-change'));
  };

  const isDark = theme === 'dark';

  return (
    <ThemeContext.Provider value={{ theme, isDark, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}

