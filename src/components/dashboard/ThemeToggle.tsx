'use client';

import { useTheme } from '@/context/ThemeContext';

export default function ThemeToggle() {
  const { isDark, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      type="button"
      title={`Switch to ${isDark ? 'Light' : 'Dark'} mode`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '5px 12px', borderRadius: 20,
        background: isDark ? 'rgba(255,255,255,0.08)' : '#f1f5f9',
        border: `1px solid ${isDark ? '#202d26' : '#cbd5e1'}`,
        color: isDark ? '#fef08a' : '#334155',
        cursor: 'pointer', fontSize: 12, fontWeight: 500,
        transition: 'all 0.15s',
        flexShrink: 0,
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.14)' : '#e2e8f0';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.08)' : '#f1f5f9';
      }}
    >
      <span>{isDark ? '☀️' : '🌙'}</span>
      <span style={{ fontSize: 11.5, color: isDark ? '#d1d5db' : '#334155', fontWeight: 600 }}>
        {isDark ? 'Light' : 'Dark'}
      </span>
    </button>
  );
}

