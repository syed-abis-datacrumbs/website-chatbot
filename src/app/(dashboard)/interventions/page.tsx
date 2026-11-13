'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useTheme } from '@/context/ThemeContext';
import ThemeToggle from '@/components/dashboard/ThemeToggle';

interface HumanIntervention {
  phone: string;
  name?: string | null;
  email?: string | null;
  category: 'payment' | 'discount' | 'demo';
  reason: string;
  lastMessage: string;
  flaggedAt: number;
  status: 'pending' | 'resolved';
  resolvedAt?: number;
}

const NEON = '#5ce46d';

const CATEGORY_CONFIG: Record<'payment' | 'discount' | 'demo', { label: string; color: string; bg: string; icon: string }> = {
  payment:  { label: 'Payment',  color: '#f59e0b', bg: 'rgba(245,158,11,0.12)',  icon: '💳' },
  discount: { label: 'Discount', color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)', icon: '🏷️' },
  demo:     { label: 'Demo',     color: '#06b6d4', bg: 'rgba(6,182,212,0.12)',   icon: '🎓' },
};

function formatRelativeTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function formatFullTime(ts: number): string {
  try {
    return new Date(ts).toLocaleString('en-PK', {
      timeZone: 'Asia/Karachi',
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true,
    });
  } catch { return new Date(ts).toLocaleString(); }
}

export default function InterventionsPage() {
  const { isDark } = useTheme();
  const [items, setItems] = useState<HumanIntervention[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [resolvingPhone, setResolvingPhone] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const glassBg = isDark
    ? 'linear-gradient(180deg, rgba(20,29,25,0.85) 0%, rgba(13,20,17,0.95) 100%)'
    : '#ffffff';
  const borderCol = isDark ? '#202d26' : '#e2e8f0';
  const textCol   = isDark ? '#ffffff' : '#0f172a';
  const textMuted = isDark ? '#9ca3af' : '#64748b';

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const loadInterventions = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const res = await fetch('/api/interventions', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const valid = ((data.interventions || []) as HumanIntervention[]).filter(
        i => (i.category === 'payment' || i.category === 'discount' || i.category === 'demo')
      );
      setItems(valid);
    } catch (err) {
      console.error('Failed to load interventions:', err);
      showToast('Failed to load interventions', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadInterventions();
    const interval = setInterval(() => loadInterventions(true), 30000);
    return () => clearInterval(interval);
  }, [loadInterventions]);

  const handleBackfill = async () => {
    setBackfilling(true);
    try {
      const res = await fetch('/api/interventions/backfill', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Backfill failed');
      const { discountsCount, demosCount, messagesCount } = data.summary;
      showToast(`✅ Records imported! ${discountsCount} discounts + ${demosCount} demos + ${messagesCount} payments.`);
      await loadInterventions(true);
    } catch (err) {
      console.error('Backfill error:', err);
      showToast('Import failed — check console', 'error');
    } finally {
      setBackfilling(false);
    }
  };

  const handleResolve = async (phone: string) => {
    setResolvingPhone(phone);
    try {
      const res = await fetch(`/api/interventions/${encodeURIComponent(phone)}/resolve`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to resolve');
      // Optimistically mark resolved so it disappears immediately from pending list
      setItems(prev => prev.map(item =>
        item.phone === phone ? { ...item, status: 'resolved', resolvedAt: Date.now() } : item
      ));
      showToast('Marked as resolved ✅');
    } catch (err) {
      console.error('Resolve error:', err);
      showToast('Could not mark resolved', 'error');
    } finally {
      setResolvingPhone(null);
    }
  };

  // ONLY PENDING interventions shown (strictly payment, discount, demo)
  const pendingItems = useMemo(() => {
    return items.filter(
      item => item.status === 'pending' &&
      (item.category === 'payment' || item.category === 'discount' || item.category === 'demo')
    );
  }, [items]);

  return (
    <div style={{ flex: 1, overflowY: 'auto' }}>
      <div style={{ padding: '32px 36px', maxWidth: 1440, margin: '0 auto' }}>

        {/* Toast */}
        {toast && (
          <div style={{
            position: 'fixed', top: 24, right: 24, zIndex: 9999,
            padding: '12px 20px', borderRadius: 10, fontSize: 13, fontWeight: 500,
            color: '#fff', background: toast.type === 'success' ? '#059669' : '#dc2626',
            boxShadow: '0 10px 25px -5px rgba(0,0,0,0.3)',
            animation: 'fadeIn 0.2s ease-out', maxWidth: 440,
          }}>
            {toast.message}
          </div>
        )}

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                background: isDark ? 'rgba(239,68,68,0.12)' : 'rgba(239,68,68,0.08)',
                border: '1px solid rgba(239,68,68,0.25)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ef4444',
              }}>
                <svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <h1 style={{ fontSize: 26, fontWeight: 700, color: textCol, margin: 0 }}>Human Interventions</h1>
                  {pendingItems.length > 0 ? (
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 20,
                      background: '#ef4444', color: '#fff', letterSpacing: '0.4px',
                      boxShadow: '0 0 10px rgba(239,68,68,0.4)',
                    }}>
                      {pendingItems.length} PENDING ACTION
                    </span>
                  ) : (
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 20,
                      background: 'rgba(92,228,109,0.15)', color: NEON, letterSpacing: '0.4px',
                    }}>
                      ALL CAUGHT UP
                    </span>
                  )}
                </div>
                <p style={{ fontSize: 13, color: textMuted, marginTop: 4, marginBottom: 0 }}>
                  Active leads requiring review · Payment claims · Discount requests · Demo requests
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <ThemeToggle />
              <button
                onClick={handleBackfill}
                disabled={backfilling}
                title="Import past records into this list"
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                  cursor: backfilling ? 'not-allowed' : 'pointer',
                  border: `1px solid ${isDark ? 'rgba(139,92,246,0.4)' : 'rgba(139,92,246,0.3)'}`,
                  background: isDark ? 'rgba(139,92,246,0.15)' : 'rgba(139,92,246,0.08)',
                  color: '#8b5cf6',
                }}
              >
                <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                {backfilling ? 'Importing…' : 'Import Past Records'}
              </button>
              <button
                onClick={() => loadInterventions(true)}
                disabled={refreshing || loading}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                  cursor: refreshing || loading ? 'not-allowed' : 'pointer',
                  border: `1px solid ${borderCol}`,
                  background: isDark ? 'rgba(20,29,25,0.6)' : '#fff', color: textCol,
                }}
              >
                <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"
                  style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }}>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {refreshing ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
          </div>
        </div>

        {/* Pending Table */}
        {loading ? (
          <div style={{ background: glassBg, border: `1px solid ${borderCol}`, borderRadius: 16, padding: '60px 24px', textAlign: 'center', color: textMuted }}>
            Loading pending interventions…
          </div>
        ) : pendingItems.length === 0 ? (
          <div style={{
            background: glassBg, border: `1px solid ${borderCol}`, borderRadius: 16,
            padding: '60px 24px', textAlign: 'center', color: textMuted, fontSize: 14,
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <div style={{ fontSize: 36 }}>🎉</div>
              <div style={{ fontSize: 17, fontWeight: 700, color: textCol }}>All caught up!</div>
              <div style={{ fontSize: 13, color: textMuted }}>No leads currently require human intervention.</div>
              <button onClick={handleBackfill} disabled={backfilling} style={{
                marginTop: 10, padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                cursor: 'pointer', border: '1px solid rgba(139,92,246,0.4)',
                background: 'rgba(139,92,246,0.1)', color: '#8b5cf6',
              }}>
                {backfilling ? 'Importing…' : '📥 Import Past Records'}
              </button>
            </div>
          </div>
        ) : (
          <div style={{ background: glassBg, border: `1px solid ${borderCol}`, borderRadius: 16, overflow: 'hidden', boxShadow: isDark ? 'none' : '0 1px 3px rgba(0,0,0,0.05)' }}>
            {/* Table header */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '36px 180px 100px 190px 1fr 120px 160px',
              padding: '12px 20px',
              gap: 10,
              background: isDark ? 'rgba(13,20,17,0.7)' : '#f8fafc',
              borderBottom: `1px solid ${borderCol}`,
              fontSize: 11, fontWeight: 600, color: textMuted,
              textTransform: 'uppercase', letterSpacing: '0.6px', alignItems: 'center',
            }}>
              <div>#</div>
              <div>Student / Lead</div>
              <div>Category</div>
              <div>Trigger Reason</div>
              <div>Student&apos;s Message</div>
              <div>Flagged At</div>
              <div style={{ textAlign: 'right' }}>Actions</div>
            </div>

            {/* Rows */}
            {pendingItems.map((item, idx) => {
              const isResolving = resolvingPhone === item.phone;
              const catCfg = CATEGORY_CONFIG[item.category] || CATEGORY_CONFIG.payment;

              return (
                <div
                  key={`${item.phone}-${item.flaggedAt}`}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '36px 180px 100px 190px 1fr 120px 160px',
                    padding: '16px 20px',
                    borderBottom: idx < pendingItems.length - 1 ? `1px solid ${borderCol}` : 'none',
                    background: isDark ? 'rgba(239,68,68,0.02)' : 'rgba(239,68,68,0.015)',
                    alignItems: 'start', fontSize: 13, gap: 10,
                  }}
                >
                  {/* # */}
                  <div style={{ color: textMuted, fontSize: 12, paddingTop: 2 }}>{idx + 1}</div>

                  {/* Student */}
                  <div style={{ paddingTop: 2 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600, color: textCol, fontSize: 13 }}>
                        {item.name || 'Unknown Student'}
                      </span>
                      <span style={{
                        fontSize: 9, padding: '1px 5px', borderRadius: 4, fontWeight: 700,
                        background: 'rgba(239,68,68,0.15)', color: '#ef4444',
                      }}>PENDING</span>
                    </div>
                    <div style={{ fontSize: 11, color: textMuted, fontFamily: 'monospace', marginTop: 3 }}>+{item.phone}</div>
                    {item.email && <div style={{ fontSize: 11, color: textMuted, marginTop: 2, wordBreak: 'break-all' }}>{item.email}</div>}
                  </div>

                  {/* Category */}
                  <div style={{ paddingTop: 2 }}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                      background: catCfg.bg, color: catCfg.color,
                    }}>
                      {catCfg.icon} {catCfg.label}
                    </span>
                  </div>

                  {/* Reason */}
                  <div>
                    <div
                      style={{
                        padding: '8px 12px', borderRadius: 8, fontSize: 12, lineHeight: '1.5',
                        background: isDark ? 'rgba(0,0,0,0.25)' : '#f1f5f9',
                        borderLeft: `3px solid ${catCfg.color || '#f59e0b'}`,
                        color: textCol, wordBreak: 'break-word',
                      }}
                    >
                      {item.reason}
                    </div>
                  </div>

                  {/* Message */}
                  <div>
                    <div style={{
                      padding: '8px 12px', borderRadius: 8, fontSize: 12, fontStyle: 'italic',
                      background: isDark ? 'rgba(0,0,0,0.25)' : '#f1f5f9',
                      borderLeft: '3px solid #ef4444',
                      color: textCol, lineHeight: '1.5', wordBreak: 'break-word',
                    }}>
                      &ldquo;{item.lastMessage}&rdquo;
                    </div>
                  </div>

                  {/* Flagged At */}
                  <div style={{ paddingTop: 2 }}>
                    <div style={{ color: textCol, fontWeight: 500, fontSize: 12 }}>{formatRelativeTime(item.flaggedAt)}</div>
                    <div style={{ color: textMuted, fontSize: 10, marginTop: 2 }}>{formatFullTime(item.flaggedAt)}</div>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, paddingTop: 2 }}>
                    <Link
                      href={`/chats?phone=${encodeURIComponent(item.phone)}`}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        padding: '6px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                        textDecoration: 'none',
                        background: isDark ? 'rgba(92,228,109,0.15)' : 'rgba(92,228,109,0.1)',
                        color: isDark ? NEON : '#166534',
                        border: `1px solid ${isDark ? 'rgba(92,228,109,0.3)' : 'rgba(92,228,109,0.2)'}`,
                      }}
                      title="Open in Chats"
                    >
                      <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                      </svg>
                      Chat
                    </Link>

                    <button
                      onClick={() => handleResolve(item.phone)}
                      disabled={isResolving}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        padding: '6px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                        cursor: isResolving ? 'not-allowed' : 'pointer',
                        background: isDark ? 'rgba(239,68,68,0.15)' : 'rgba(239,68,68,0.08)',
                        color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)',
                      }}
                    >
                      <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      {isResolving ? '…' : 'Resolve'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <style jsx global>{`
        @keyframes spin    { from { transform:rotate(0deg) }  to { transform:rotate(360deg) } }
        @keyframes fadeIn  { from { opacity:0; transform:translateY(-8px) } to { opacity:1; transform:translateY(0) } }
      `}</style>
    </div>
  );
}
