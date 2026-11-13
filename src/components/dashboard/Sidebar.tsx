'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { useTheme } from '@/context/ThemeContext';

const NEON = '#5ce46d';

type CountKey = 'chats' | 'leads' | 'enrollments' | 'interventions';

const NAV: { href: string; label: string; countKey?: CountKey; icon: React.ReactNode }[] = [
  {
    href: '/overview',
    label: 'Overview',
    icon: (
      <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
      </svg>
    ),
  },
  {
    href: '/chats',
    label: 'Chats',
    countKey: 'chats',
    icon: (
      <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
      </svg>
    ),
  },
  /*
  {
    href: '/leads',
    label: 'Leads',
    countKey: 'leads',
    icon: (
      <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
      </svg>
    ),
  },
  */
  {
    href: '/payments',
    label: 'Payments',
    countKey: 'enrollments',
    icon: (
      <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    href: '/interventions',
    label: 'Interventions',
    countKey: 'interventions',
    icon: (
      <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    ),
  },
  /*
  {
    href: '/discounts',
    label: 'Discounts',
    icon: (
      <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M17 17h.01M9 19l10-16M7 9a2 2 0 100-4 2 2 0 000 4zm10 10a2 2 0 100-4 2 2 0 000 4z" />
      </svg>
    ),
  },
  {
    href: '/demo',
    label: 'Demo Requests',
    icon: (
      <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.55-2.55a1 1 0 011.45.9v7.3a1 1 0 01-1.45.9L15 14M5 6h9a1 1 0 011 1v10a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1z" />
      </svg>
    ),
  },
  */
  {
    href: '/config',
    label: 'Configuration',
    icon: (
      <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
      </svg>
    ),
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [hovered, setHovered] = useState<string | null>(null);
  const [logoutHov, setLogoutHov] = useState(false);
  const [counts, setCounts] = useState<Record<CountKey, number> | null>(null);
  const { isDark } = useTheme();

  useEffect(() => {
    let cancelled = false;
    const fetchCounts = async () => {
      try {
        const res  = await fetch('/api/stats/nav-counts');
        const data = await res.json();
        if (!cancelled) setCounts(data);
      } catch { /* ignore — badges just stay hidden */ }
    };
    fetchCounts();
    const poll = setInterval(fetchCounts, 15000);
    return () => { cancelled = true; clearInterval(poll); };
  }, []);

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }

  return (
    <div style={{
      width: 256, flexShrink: 0,
      display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
      borderRight: isDark ? '1px solid #1a251f' : '1px solid #e2e8f0',
      height: '100vh',
      background: isDark ? '#090d0b' : '#ffffff',
      transition: 'background 0.2s, border-color 0.2s',
    }}>
      <div style={{ padding: 20 }}>
        {/* Logo */}
        <div style={{ marginBottom: 20 }}>
          <Image
            src={isDark ? '/logo.png' : '/logo-dark.png'}
            alt="DataCrumbs"
            width={140}
            height={50}
            style={{ objectFit: 'contain', objectPosition: 'left' }}
          />
        </div>

        {/* Nav */}
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {NAV.map(item => {
            const active = pathname === item.href || (item.href === '/payments' && pathname === '/enrollments');
            const hovering = hovered === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                style={{ textDecoration: 'none' }}
                onMouseEnter={() => setHovered(item.href)}
                onMouseLeave={() => setHovered(null)}
              >
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 12px', borderRadius: 8,
                  background: active
                    ? (isDark ? 'linear-gradient(to right, #204027, #122316)' : 'linear-gradient(to right, #ecfdf5, #f0fdf4)')
                    : hovering ? (isDark ? '#121a16' : '#f8fafc') : 'transparent',
                  border: `1px solid ${active ? (isDark ? '#2b5133' : '#a7f3d0') : 'transparent'}`,
                  boxShadow: active ? (isDark ? '0 0 15px rgba(92,228,109,0.3)' : '0 2px 8px rgba(16,185,129,0.15)') : 'none',
                  color: active ? (isDark ? NEON : '#059669') : hovering ? (isDark ? '#fff' : '#0f172a') : (isDark ? '#9ca3af' : '#64748b'),
                  transition: 'all 0.15s',
                }}>
                  <span style={{ color: active ? (isDark ? NEON : '#059669') : 'inherit', display: 'flex', flexShrink: 0 }}>
                    {item.icon}
                  </span>
                  <span style={{ fontSize: 14, fontWeight: active ? 600 : 400, flex: 1 }}>
                    {item.label}
                  </span>
                  {item.countKey && counts != null && counts[item.countKey] !== undefined && (
                    <span style={{
                      fontSize: 11, fontWeight: 600,
                      color: item.countKey === 'interventions' && counts[item.countKey] > 0
                        ? '#ef4444'
                        : active ? (isDark ? NEON : '#059669') : (isDark ? '#6b7280' : '#64748b'),
                      background: item.countKey === 'interventions' && counts[item.countKey] > 0
                        ? (isDark ? 'rgba(239,68,68,0.18)' : '#fee2e2')
                        : active ? (isDark ? 'rgba(92,228,109,0.12)' : 'rgba(16,185,129,0.12)') : (isDark ? 'rgba(255,255,255,0.05)' : '#f1f5f9'),
                      border: `1px solid ${
                        item.countKey === 'interventions' && counts[item.countKey] > 0
                          ? (isDark ? 'rgba(239,68,68,0.4)' : '#fca5a5')
                          : active ? (isDark ? 'rgba(92,228,109,0.3)' : '#a7f3d0') : (isDark ? '#202d26' : '#e2e8f0')
                      }`,
                      borderRadius: 20, padding: '1px 8px',
                      flexShrink: 0,
                    }}>
                      {counts[item.countKey]}
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Bottom profile */}
      <div style={{ padding: '0 16px 16px' }}>
        <div style={{
          background: isDark
            ? 'linear-gradient(180deg, rgba(20,29,25,0.8) 0%, rgba(13,20,17,0.9) 100%)'
            : '#f8fafc',
          border: isDark ? '1px solid #202d26' : '1px solid #e2e8f0',
          borderRadius: 10, padding: '10px 12px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ position: 'relative' }}>
              <div style={{
                width: 34, height: 34, borderRadius: '50%',
                background: isDark ? '#1a251f' : '#ecfdf5',
                border: `1.5px solid ${isDark ? NEON : '#10b981'}`,
                boxShadow: isDark ? '0 0 10px rgba(92,228,109,0.2)' : '0 0 8px rgba(16,185,129,0.2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: isDark ? NEON : '#059669',
              }}>
                <svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                </svg>
              </div>
              <div style={{
                position: 'absolute', bottom: 0, right: 0,
                width: 8, height: 8, borderRadius: '50%',
                background: isDark ? NEON : '#10b981', border: `1.5px solid ${isDark ? '#090d0b' : '#ffffff'}`,
              }} />
            </div>
            <div>
              <h3 style={{ fontSize: 13, fontWeight: 600, color: isDark ? '#fff' : '#0f172a', margin: 0, lineHeight: 1.2 }}>Admin</h3>
              <p style={{ fontSize: 10, color: isDark ? NEON : '#059669', margin: 0, lineHeight: 1.2 }}>DataCrumbs</p>
            </div>
          </div>
          <button
            onClick={logout}
            onMouseEnter={() => setLogoutHov(true)}
            onMouseLeave={() => setLogoutHov(false)}
            title="Logout"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 32, height: 32, borderRadius: 6,
              fontSize: 12, color: logoutHov ? '#ef4444' : (isDark ? '#9ca3af' : '#64748b'),
              background: logoutHov ? 'rgba(239, 68, 68, 0.1)' : 'transparent',
              border: 'none', cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
