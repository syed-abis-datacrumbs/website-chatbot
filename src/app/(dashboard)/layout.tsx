'use client';

import { ThemeProvider, useTheme } from '@/context/ThemeContext';
import Sidebar from '@/components/dashboard/Sidebar';

function LayoutInner({ children }: { children: React.ReactNode }) {
  const { isDark } = useTheme();

  return (
    <div style={{
      display: 'flex', height: '100vh', overflow: 'hidden',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      background: isDark ? '#090d0b' : '#f8fafc',
      color: isDark ? '#fff' : '#0f172a',
      transition: 'background 0.2s, color 0.2s',
    }}>
      <Sidebar />
      <main style={{ flex: 1, height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {children}
      </main>
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <LayoutInner>{children}</LayoutInner>
    </ThemeProvider>
  );
}
