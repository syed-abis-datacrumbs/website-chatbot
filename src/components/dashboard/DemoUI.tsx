'use client';

import { useState } from 'react';
import { SheetDemoRequest } from '@/lib/google';
import DownloadCsvButton from './DownloadCsvButton';
import { useTheme } from '@/context/ThemeContext';
import ThemeToggle from './ThemeToggle';

const NEON = '#5ce46d';

export default function DemoUI({ requests }: { requests: SheetDemoRequest[] }) {
  const [search, setSearch] = useState('');
  const { isDark } = useTheme();

  const filtered = search.trim()
    ? requests.filter(r => {
        const q = search.trim().toLowerCase();
        return (
          (r.name && r.name.toLowerCase().includes(q)) ||
          (r.email && r.email.toLowerCase().includes(q)) ||
          r.phone.includes(q.replace(/\D/g, '')) ||
          r.message.toLowerCase().includes(q)
        );
      })
    : requests;

  const glassBg = isDark
    ? 'linear-gradient(180deg, rgba(20,29,25,0.8) 0%, rgba(13,20,17,0.9) 100%)'
    : '#ffffff';
  const borderCol = isDark ? '#202d26' : '#e2e8f0';
  const textCol = isDark ? '#ffffff' : '#0f172a';
  const textMuted = isDark ? '#9ca3af' : '#64748b';

  return (
    <div style={{ flex: 1, overflowY: 'auto' }}>
      <div style={{ padding: '32px 36px' }}>
        <div style={{ maxWidth: 860 }}>

          {/* Header */}
          <div style={{ marginBottom: 28 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <h1 style={{ fontSize: 28, fontWeight: 700, color: textCol, margin: 0 }}>
                Demo Class Requests
              </h1>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <ThemeToggle />
                <DownloadCsvButton
                  filename="demo-requests.csv"
                  headers={['Name', 'Email', 'Phone', 'Message', 'Submitted']}
                  rows={requests.map(r => [r.name, r.email ?? '', `+${r.phone}`, r.message, r.submitted])}
                />
              </div>
            </div>
            <p style={{ fontSize: 13, color: textMuted, marginTop: 4, marginBottom: 14 }}>
              Students who asked for a demo class — {requests.length} request{requests.length !== 1 ? 's' : ''}
            </p>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, email, phone, or message…"
              style={{
                width: '100%', maxWidth: 400, boxSizing: 'border-box',
                background: isDark ? '#0d1511' : '#ffffff',
                border: `1px solid ${borderCol}`,
                borderRadius: 8, padding: '8px 12px', fontSize: 13,
                color: textCol, outline: 'none',
                boxShadow: isDark ? 'none' : '0 1px 2px rgba(0,0,0,0.04)',
              }}
            />
          </div>

          {filtered.length === 0 ? (
            <div style={{
              background: glassBg, border: `1px solid ${borderCol}`,
              borderRadius: 16, padding: 48,
              textAlign: 'center', color: '#6b7280', fontSize: 14,
              boxShadow: isDark ? 'none' : '0 1px 3px rgba(0,0,0,0.05)',
            }}>
              {search.trim() ? 'No matching demo requests.' : 'No demo class requests yet.'}
            </div>
          ) : (
            <div style={{
              background: glassBg, border: `1px solid ${borderCol}`,
              borderRadius: 16, overflow: 'hidden',
              boxShadow: isDark ? 'none' : '0 1px 3px rgba(0,0,0,0.05)',
            }}>
              {/* Table header */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '140px 160px 120px 1fr 150px',
                padding: '12px 20px',
                background: isDark ? 'transparent' : '#f8fafc',
                borderBottom: `1px solid ${borderCol}`,
                fontSize: 11, fontWeight: 700, color: textMuted,
                textTransform: 'uppercase', letterSpacing: '0.06em',
              }}>
                <span>Name</span>
                <span>Email</span>
                <span>Phone</span>
                <span>Message</span>
                <span>Date &amp; Time</span>
              </div>

              {filtered.map((r, i) => (
                <div
                  key={i}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '140px 160px 120px 1fr 150px',
                    padding: '14px 20px',
                    borderBottom: i < filtered.length - 1 ? `1px solid ${borderCol}` : 'none',
                    alignItems: 'start',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = isDark ? '#0e1a13' : '#f1f5f9')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <span style={{ fontSize: 13, fontWeight: 600, color: isDark ? '#e5e7eb' : '#0f172a' }}>
                    {r.name || '—'}
                  </span>
                  <span style={{ fontSize: 12, color: textMuted, wordBreak: 'break-all' }}>
                    {r.email || '—'}
                  </span>
                  <span style={{ fontSize: 12, color: isDark ? NEON : '#059669', fontFamily: 'monospace' }}>
                    +{r.phone}
                  </span>
                  <span style={{
                    fontSize: 12.5, color: isDark ? '#d1d5db' : '#334155', lineHeight: 1.55,
                    paddingRight: 16,
                  }}>
                    {r.message}
                  </span>
                  <span style={{ fontSize: 11.5, color: textMuted }}>
                    {r.submitted}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
