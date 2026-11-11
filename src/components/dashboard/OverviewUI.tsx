'use client';

import React from 'react';
import { useTheme } from '@/context/ThemeContext';
import ThemeToggle from './ThemeToggle';

const NEON   = '#5ce46d';
const YELLOW = '#e4e15c';

interface Stats {
  totalContacts: number;
  todayContacts: number;
  totalMessages: number;
  todayMessages: number;
  todayHours: number[];
  last7Days: { date: string; count: number }[];
}

function smooth(pts: { x: number; y: number }[]): string {
  if (!pts.length) return '';
  let d = `M${pts[0].x.toFixed(0)},${pts[0].y.toFixed(0)}`;
  for (let i = 1; i < pts.length; i++) {
    const cx = ((pts[i - 1].x + pts[i].x) / 2).toFixed(0);
    d += ` C${cx},${pts[i - 1].y.toFixed(0)} ${cx},${pts[i].y.toFixed(0)} ${pts[i].x.toFixed(0)},${pts[i].y.toFixed(0)}`;
  }
  return d;
}

function LineChart({ data, isDark }: { data: { date: string; count: number }[]; isDark: boolean }) {
  const W = 1000, H = 200;
  const rawMax = Math.max(...data.map(d => d.count), 0);
  const niceMax = rawMax === 0 ? 5 : Math.ceil(rawMax * 1.3);

  function toY(count: number) {
    return 15 + (1 - count / niceMax) * 160;
  }

  const greenPts = data.map((d, i) => ({
    x: data.length <= 1 ? W / 2 : (i / (data.length - 1)) * W,
    y: toY(d.count),
  }));

  const yellowPts = data.map((d, i) => ({
    x: data.length <= 1 ? W / 2 : (i / (data.length - 1)) * W,
    y: Math.max(18, toY(d.count) - 22),
  }));

  const greenLine  = smooth(greenPts);
  const yellowLine = smooth(yellowPts);
  const greenArea  = `${greenLine} L${W},${H} L0,${H} Z`;
  const yellowArea = `${yellowLine} L${W},${H} L0,${H} Z`;

  const yLabels = niceMax <= 10
    ? [niceMax, Math.round(niceMax / 2), 0]
    : [niceMax, Math.round(niceMax * 0.5), 0];

  const peakIdx = data.reduce((b, d, i) => d.count > data[b].count ? i : b, 0);
  const peakPt  = greenPts[peakIdx];
  const peakVal = data[peakIdx]?.count ?? 0;

  const days = data.map(d =>
    new Date(d.date + 'T00:00:00').toLocaleDateString('en-PK', { weekday: 'short' })
  );

  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, marginTop: 16 }}>
      {/* Y labels */}
      <div style={{
        position: 'absolute', left: 0, top: 0, bottom: 28,
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        fontSize: 11, color: isDark ? '#4b5563' : '#94a3b8', userSelect: 'none',
      }}>
        {yLabels.map((v, i) => <span key={i}>{v}</span>)}
      </div>

      {/* Chart body */}
      <div style={{ position: 'absolute', left: 32, right: 0, top: 0, bottom: 28 }}>
        {/* Grid */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          borderLeft: `1px solid ${isDark ? 'rgba(107,114,128,0.25)' : '#e2e8f0'}`,
          borderBottom: `1px solid ${isDark ? 'rgba(107,114,128,0.25)' : '#e2e8f0'}`,
        }}>
          {[0, 25, 50, 75].map(p => (
            <div key={p} style={{ position: 'absolute', top: `${p}%`, left: 0, right: 0, borderBottom: `1px dashed ${isDark ? 'rgba(107,114,128,0.18)' : '#f1f5f9'}` }} />
          ))}
          {[1, 2, 3, 4, 5, 6].map((_, i) => (
            <div key={i} style={{ position: 'absolute', left: `${((i + 1) / 7) * 100}%`, top: 0, bottom: 0, borderLeft: `1px dashed ${isDark ? 'rgba(107,114,128,0.18)' : '#f1f5f9'}` }} />
          ))}
        </div>

        {/* SVG */}
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', overflow: 'visible' }}
        >
          <defs>
            <linearGradient id="gFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={isDark ? NEON : '#10b981'} stopOpacity={isDark ? 0.25 : 0.2} />
              <stop offset="100%" stopColor={isDark ? NEON : '#10b981'} stopOpacity="0" />
            </linearGradient>
            <linearGradient id="yFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={YELLOW} stopOpacity={isDark ? 0.12 : 0.1} />
              <stop offset="100%" stopColor={YELLOW} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={yellowArea} fill="url(#yFill)" />
          <path d={yellowLine} fill="none" stroke={YELLOW} strokeWidth="2"
            style={{ filter: isDark ? 'drop-shadow(0 0 5px rgba(228,225,92,0.6))' : 'none' }} />
          <path d={greenArea} fill="url(#gFill)" />
          <path d={greenLine} fill="none" stroke={isDark ? NEON : '#10b981'} strokeWidth="2.5"
            style={{ filter: isDark ? 'drop-shadow(0 0 6px rgba(92,228,109,0.7))' : 'none' }} />
        </svg>

        {/* Yellow dots */}
        {yellowPts.map((p, i) => (
          <div key={i} style={{
            position: 'absolute',
            left: `${(p.x / W) * 100}%`,
            top: `${(p.y / H) * 100}%`,
            width: 6, height: 6,
            borderRadius: '50%',
            background: YELLOW,
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'none',
          }} />
        ))}

        {/* Green dots */}
        {greenPts.map((p, i) => (
          <div key={i} style={{
            position: 'absolute',
            left: `${(p.x / W) * 100}%`,
            top: `${(p.y / H) * 100}%`,
            width: 8, height: 8,
            borderRadius: '50%',
            background: isDark ? '#090d0b' : '#ffffff',
            border: `2px solid ${isDark ? NEON : '#10b981'}`,
            boxShadow: isDark ? '0 0 6px rgba(92,228,109,0.7)' : '0 1px 4px rgba(16,185,129,0.4)',
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'none',
          }} />
        ))}

        {/* Peak value label */}
        {peakVal > 0 && (
          <div style={{
            position: 'absolute',
            left: `${(peakPt.x / W) * 100}%`,
            top: `${(peakPt.y / H) * 100}%`,
            transform: 'translate(-50%, -130%)',
            background: isDark ? NEON : '#10b981',
            color: isDark ? '#000' : '#fff',
            fontSize: 10, fontWeight: 700,
            padding: '2px 6px', borderRadius: 4,
            pointerEvents: 'none', whiteSpace: 'nowrap',
          }}>
            {peakVal}
          </div>
        )}
      </div>

      {/* X labels */}
      <div style={{
        position: 'absolute', left: 32, right: 0, bottom: 0, height: 24,
        display: 'flex', justifyContent: 'space-between',
        fontSize: 11, color: isDark ? '#9ca3af' : '#64748b',
      }}>
        {days.map((d, i) => <span key={i}>{d}</span>)}
      </div>
    </div>
  );
}

function SparkCard({ icon, value, label, todayNew, sparkData, isDark, glass, iconBox }: {
  icon: React.ReactNode; value: number; label: string; todayNew: number; sparkData: number[];
  isDark: boolean; glass: React.CSSProperties; iconBox: React.CSSProperties;
}) {
  const W = 100, H = 64;
  const max = Math.max(...sparkData, 1);
  const pts = sparkData.map((v, i) => ({
    x: sparkData.length <= 1 ? W / 2 : (i / (sparkData.length - 1)) * W,
    y: H - 6 - (v / max) * (H - 12),
  }));
  const line = smooth(pts);
  const area = `${line} L${W},${H} L0,${H} Z`;
  const last = pts[pts.length - 1];

  return (
    <div style={{ ...glass, borderRadius: 16, padding: 20, height: 160, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', position: 'relative', overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', zIndex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={iconBox}>{icon}</div>
          <span style={{ fontSize: 30, fontWeight: 700, color: isDark ? '#fff' : '#0f172a' }}>{value}</span>
        </div>
        <svg width="16" height="16" fill={isDark ? '#4b5563' : '#94a3b8'} viewBox="0 0 24 24">
          <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
        </svg>
      </div>
      <div style={{ fontSize: 13, color: isDark ? '#d1d5db' : '#475569', zIndex: 1 }}>{label}</div>

      {/* Mini sparkline */}
      <div style={{ position: 'absolute', bottom: 0, right: 0, width: '55%', height: 64, opacity: 0.85, pointerEvents: 'none' }}>
        <svg preserveAspectRatio="none" viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '100%' }}>
          <defs>
            <linearGradient id="spark" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={isDark ? NEON : '#10b981'} stopOpacity="0.45" />
              <stop offset="100%" stopColor={isDark ? NEON : '#10b981'} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill="url(#spark)" />
          <path d={line} fill="none" stroke={isDark ? NEON : '#10b981'} strokeWidth="1.8"
            style={{ filter: isDark ? 'drop-shadow(0 0 4px rgba(92,228,109,0.6))' : 'none' }} />
        </svg>
        {last && (
          <div style={{
            position: 'absolute', left: `${(last.x / W) * 100}%`, top: `${(last.y / H) * 100}%`,
            width: 6, height: 6, borderRadius: '50%', background: isDark ? NEON : '#10b981',
            transform: 'translate(-50%, -50%)',
            boxShadow: isDark ? '0 0 6px rgba(92,228,109,0.9)' : '0 1px 3px rgba(16,185,129,0.5)',
          }} />
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, zIndex: 1 }}>
        {todayNew > 0 ? (
          <>
            <span style={{ background: isDark ? '#122b19' : '#ecfdf5', color: isDark ? NEON : '#059669', fontSize: 11, padding: '2px 8px', borderRadius: 4, fontWeight: 600 }}>
              ↑ {todayNew} today
            </span>
            <span style={{ fontSize: 11, color: isDark ? '#6b7280' : '#64748b' }}>new contacts</span>
          </>
        ) : (
          <span style={{ fontSize: 11, color: isDark ? '#4b5563' : '#94a3b8' }}>No new contacts today</span>
        )}
      </div>
    </div>
  );
}

const HOUR_LABELS = ['00','02','04','06','08','10','12','14','16','18','20','22'];

function MsgCard({ value, todayHours, isDark, glass, iconBox }: {
  value: number; todayHours: number[]; isDark: boolean; glass: React.CSSProperties; iconBox: React.CSSProperties;
}) {
  const bars = HOUR_LABELS.map((_, i) => todayHours[i * 2] ?? 0);
  const bMax = Math.max(...bars, 1);
  const peakIdx = bars.reduce((best, v, i) => v > bars[best] ? i : best, 0);

  return (
    <div style={{ ...glass, borderRadius: 16, padding: 20, height: 160, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={iconBox}>
            <svg width="20" height="20" fill="none" stroke={isDark ? NEON : '#10b981'} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <span style={{ fontSize: 30, fontWeight: 700, color: isDark ? '#fff' : '#0f172a' }}>{value}</span>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ color: isDark ? NEON : '#059669', fontSize: 11, fontWeight: 600 }}>↑ live</div>
          <div style={{ fontSize: 10, color: isDark ? '#6b7280' : '#64748b' }}>today</div>
        </div>
      </div>
      <div style={{ fontSize: 13, color: isDark ? '#d1d5db' : '#475569' }}>Today&apos;s Messages</div>

      {/* Hourly bar chart */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 40 }}>
        {bars.map((count, i) => {
          const pct = Math.max((count / bMax) * 100, count > 0 ? 30 : 8);
          const isPeak = i === peakIdx && count > 0;
          return (
            <div key={i} style={{
              flex: 1, height: `${pct}%`,
              background: isPeak ? (isDark ? NEON : '#10b981') : (isDark ? '#1a2a1e' : '#e2e8f0'),
              borderRadius: '2px 2px 0 0',
              boxShadow: isPeak ? (isDark ? '0 0 6px rgba(92,228,109,0.45)' : '0 1px 3px rgba(16,185,129,0.4)') : 'none',
            }} />
          );
        })}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: isDark ? '#4b5563' : '#94a3b8' }}>
        {HOUR_LABELS.map(h => <span key={h}>{h}</span>)}
      </div>
    </div>
  );
}

function RespCard({ value, isDark, glass, iconBox }: {
  value: number; isDark: boolean; glass: React.CSSProperties; iconBox: React.CSSProperties;
}) {
  return (
    <div style={{ ...glass, borderRadius: 16, padding: 20, height: 160, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={iconBox}>
          <svg width="20" height="20" fill="none" stroke={isDark ? NEON : '#10b981'} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <span style={{ fontSize: 30, fontWeight: 700, color: isDark ? '#fff' : '#0f172a' }}>{value}</span>
      </div>
      <div style={{ fontSize: 13, color: isDark ? '#d1d5db' : '#475569' }}>Total Responded</div>
      <div style={{ fontSize: 13, color: isDark ? NEON : '#059669', fontWeight: 600 }}>100% Response Rate</div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 10px',
        border: `1px solid ${isDark ? '#202d26' : '#e2e8f0'}`,
        borderRadius: 8,
        background: isDark ? '#0c120f' : '#f8fafc',
      }}>
        <svg width="13" height="13" fill="none" stroke={isDark ? NEON : '#10b981'} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span style={{ fontSize: 11, color: isDark ? '#9ca3af' : '#64748b' }}>
          Avg. Response: <span style={{ color: isDark ? '#fff' : '#0f172a', fontWeight: 600 }}>Instant (AI)</span>
        </span>
      </div>
    </div>
  );
}

function InterestedCard({ isDark, glass, iconBox }: {
  isDark: boolean; glass: React.CSSProperties; iconBox: React.CSSProperties;
}) {
  return (
    <div style={{ ...glass, borderRadius: 16, padding: 20, height: 160, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={iconBox}>
          <svg width="20" height="20" fill="none" stroke={isDark ? NEON : '#10b981'} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.879 16.121A3 3 0 1012.015 11L11 14H9c0 .768.293 1.536.879 2.121z" />
          </svg>
        </div>
        <span style={{ fontSize: 30, fontWeight: 700, color: isDark ? '#fff' : '#0f172a' }}>0</span>
      </div>
      <div style={{ fontSize: 13, color: isDark ? '#d1d5db' : '#475569' }}>Total Interested Leads</div>
      <div style={{ fontSize: 11, color: isDark ? '#6b7280' : '#64748b' }}>No activity today</div>
      <div style={{
        width: 40, height: 30,
        border: `1px solid ${isDark ? '#202d26' : '#e2e8f0'}`,
        borderRadius: 8,
        background: isDark ? '#0c120f' : '#f8fafc',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: isDark ? '#4b5563' : '#94a3b8', fontSize: 13,
      }}>--</div>
    </div>
  );
}

export default function OverviewUI({ stats }: { stats: Stats }) {
  const { isDark } = useTheme();

  const today = new Date().toLocaleDateString('en-PK', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const glass: React.CSSProperties = {
    background: isDark
      ? 'linear-gradient(180deg, rgba(20,29,25,0.8) 0%, rgba(13,20,17,0.9) 100%)'
      : '#ffffff',
    border: isDark ? '1px solid #202d26' : '1px solid #e2e8f0',
    boxShadow: isDark ? 'none' : '0 1px 3px rgba(0,0,0,0.05), 0 1px 2px rgba(0,0,0,0.03)',
    transition: 'background 0.2s, border-color 0.2s',
  };

  const iconBox: React.CSSProperties = {
    padding: 8,
    border: isDark ? '1px solid #202d26' : '1px solid #e2e8f0',
    borderRadius: 8,
    background: isDark ? '#0d1511' : '#ecfdf5',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  };

  return (
    <div style={{ flex: 1, overflowY: 'auto' }}>
      <div style={{ padding: '32px 36px' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 28 }}>
          <div>
            <h2 style={{ fontSize: 28, fontWeight: 700, color: isDark ? '#fff' : '#0f172a', margin: 0 }}>Overview</h2>
            <p style={{ fontSize: 13, color: isDark ? '#9ca3af' : '#64748b', marginTop: 4 }}>{today}</p>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <ThemeToggle />
            <div style={{
              ...glass, padding: '8px 14px', borderRadius: 8,
              display: 'flex', alignItems: 'center', gap: 6,
              fontSize: 13, color: isDark ? '#d1d5db' : '#334155',
            }}>
              <svg width="14" height="14" fill="none" stroke={isDark ? NEON : '#10b981'} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              This Month
            </div>
          </div>
        </div>

        {/* KPI cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20, marginBottom: 20 }}>
          <SparkCard
            icon={
              <svg width="20" height="20" fill="none" stroke={isDark ? NEON : '#10b981'} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
            }
            value={stats.totalContacts}
            label="Total Leads"
            todayNew={stats.todayContacts}
            sparkData={stats.last7Days.map(d => d.count)}
            isDark={isDark}
            glass={glass}
            iconBox={iconBox}
          />
          <MsgCard
            value={stats.todayMessages}
            todayHours={stats.todayHours}
            isDark={isDark}
            glass={glass}
            iconBox={iconBox}
          />
          <RespCard
            value={stats.totalMessages}
            isDark={isDark}
            glass={glass}
            iconBox={iconBox}
          />
          <InterestedCard
            isDark={isDark}
            glass={glass}
            iconBox={iconBox}
          />
        </div>

        {/* Main chart */}
        <div style={{ ...glass, borderRadius: 16, padding: '24px 24px 20px', marginBottom: 20, height: 340, boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h3 style={{ fontSize: 16, fontWeight: 600, color: isDark ? '#fff' : '#0f172a', margin: 0 }}>Messages — Last 7 Days</h3>
              <p style={{ fontSize: 11, color: isDark ? '#9ca3af' : '#64748b', marginTop: 4 }}>Daily incoming messages</p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 12, color: isDark ? '#9ca3af' : '#64748b' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 14, height: 3, background: isDark ? NEON : '#10b981', borderRadius: 2, boxShadow: isDark ? '0 0 6px rgba(92,228,109,0.6)' : 'none' }} />
                Incoming
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 14, height: 3, background: YELLOW, borderRadius: 2, boxShadow: isDark ? '0 0 6px rgba(228,225,92,0.6)' : 'none' }} />
                Outgoing
              </div>
            </div>
          </div>
          <LineChart data={stats.last7Days} isDark={isDark} />
        </div>

        {/* Bottom cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>

          {/* Today's new contacts */}
          <div style={{ ...glass, borderRadius: 16, padding: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <div style={iconBox}>
                  <svg width="18" height="18" fill="none" stroke={isDark ? NEON : '#10b981'} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                </div>
                <span style={{ fontSize: 13, color: isDark ? '#d1d5db' : '#475569' }}>Today&apos;s New Contacts</span>
              </div>
              <div style={{ fontSize: 28, fontWeight: 700, color: isDark ? '#fff' : '#0f172a', paddingLeft: 44 }}>{stats.todayContacts}</div>
            </div>
            <div style={{
              width: 40, height: 40, borderRadius: '50%',
              background: isDark ? '#121c17' : '#ecfdf5',
              border: `1px solid ${isDark ? '#202d26' : '#e2e8f0'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: isDark ? '#6b7280' : '#059669',
            }}>
              <svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
              </svg>
            </div>
          </div>

          {/* All-time messages */}
          <div style={{ ...glass, borderRadius: 16, padding: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <div style={iconBox}>
                  <svg width="18" height="18" fill="none" stroke={isDark ? NEON : '#10b981'} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                  </svg>
                </div>
                <span style={{ fontSize: 13, color: isDark ? '#d1d5db' : '#475569' }}>All-Time Messages</span>
              </div>
              <div style={{ fontSize: 28, fontWeight: 700, color: isDark ? '#fff' : '#0f172a', paddingLeft: 44 }}>{stats.totalMessages}</div>
            </div>
            <div style={{ width: 150 }}>
              {[
                { label: 'WhatsApp', pct: stats.totalMessages > 0 ? 100 : 0, color: isDark ? NEON : '#10b981' },
                { label: 'Responded', pct: stats.totalMessages > 0 ? 100 : 0, color: YELLOW },
              ].map(row => (
                <div key={row.label} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: 10 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: row.color, flexShrink: 0 }} />
                  <span style={{ color: isDark ? '#9ca3af' : '#64748b', width: 58, flexShrink: 0 }}>{row.label}</span>
                  <div style={{ flex: 1, background: isDark ? '#1a251f' : '#f1f5f9', borderRadius: 4, height: 6, overflow: 'hidden' }}>
                    <div style={{ width: `${row.pct}%`, height: '100%', background: row.color, borderRadius: 4 }} />
                  </div>
                  <span style={{ color: isDark ? '#fff' : '#0f172a', width: 30, textAlign: 'right', fontWeight: 600 }}>{row.pct}%</span>
                </div>
              ))}
            </div>
          </div>

          {/* Total contacts donut */}
          <div style={{ ...glass, borderRadius: 16, padding: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <div style={iconBox}>
                  <svg width="18" height="18" fill="none" stroke={isDark ? NEON : '#10b981'} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                </div>
                <span style={{ fontSize: 13, color: isDark ? '#d1d5db' : '#475569' }}>Total Contacts</span>
              </div>
              <div style={{ fontSize: 28, fontWeight: 700, color: isDark ? '#fff' : '#0f172a', paddingLeft: 44 }}>{stats.totalContacts}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 64, height: 64, borderRadius: '50%', flexShrink: 0,
                background: `conic-gradient(${isDark ? NEON : '#10b981'} 0% ${stats.totalContacts > 0 ? 70 : 5}%, ${isDark ? '#1a2a22' : '#e2e8f0'} ${stats.totalContacts > 0 ? 70 : 5}% 100%)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                position: 'relative',
              }}>
                <div style={{
                  position: 'absolute', inset: 0, borderRadius: '50%',
                  boxShadow: isDark ? '0 0 15px rgba(92,228,109,0.35)' : 'none',
                }} />
                <div style={{ width: 44, height: 44, borderRadius: '50%', background: isDark ? '#0d1411' : '#ffffff', zIndex: 1 }} />
              </div>
              <div style={{ fontSize: 11, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: isDark ? '#fff' : '#0f172a', fontWeight: 500 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: isDark ? NEON : '#10b981', flexShrink: 0 }} />
                  Active
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: isDark ? '#9ca3af' : '#64748b' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: isDark ? '#1a2a22' : '#cbd5e1', border: `1px solid ${isDark ? '#2a3a32' : '#94a3b8'}`, flexShrink: 0 }} />
                  Cold
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

