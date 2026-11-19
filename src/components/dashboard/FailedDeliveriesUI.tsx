'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useTheme } from '@/context/ThemeContext';
import ThemeToggle from '@/components/dashboard/ThemeToggle';
import { FailedDelivery } from '@/lib/redis';

const NEON = '#5ce46d';

function formatFullTime(ts: number): string {
  try {
    return new Date(ts).toLocaleString('en-PK', {
      timeZone: 'Asia/Karachi',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return new Date(ts).toLocaleString();
  }
}

function getErrorCategoryBadge(category: FailedDelivery['errorCategory']) {
  switch (category) {
    case '24h_window':
      return {
        label: '24h Window Expired',
        color: '#f59e0b',
        bg: 'rgba(245, 158, 11, 0.12)',
        border: 'rgba(245, 158, 11, 0.3)',
      };
    case 'invalid_phone':
      return {
        label: 'Not on WhatsApp',
        color: '#ef4444',
        bg: 'rgba(239, 68, 68, 0.12)',
        border: 'rgba(239, 68, 68, 0.3)',
      };
    case 'policy_block':
      return {
        label: 'Policy / Spam Block',
        color: '#a855f7',
        bg: 'rgba(168, 85, 247, 0.12)',
        border: 'rgba(168, 85, 247, 0.3)',
      };
    case 'rate_limit':
      return {
        label: 'Rate Limit',
        color: '#3b82f6',
        bg: 'rgba(59, 130, 246, 0.12)',
        border: 'rgba(59, 130, 246, 0.3)',
      };
    default:
      return {
        label: 'Meta API Error',
        color: '#94a3b8',
        bg: 'rgba(148, 163, 184, 0.12)',
        border: 'rgba(148, 163, 184, 0.3)',
      };
  }
}

export default function FailedDeliveriesUI({ initialItems = [] }: { initialItems?: FailedDelivery[] }) {
  const { isDark } = useTheme();
  const [items, setItems] = useState<FailedDelivery[]>(initialItems);
  const [loading, setLoading] = useState(false);
  const [retryingPhone, setRetryingPhone] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | FailedDelivery['errorCategory']>('all');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [copiedPhone, setCopiedPhone] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

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

  const handleRefresh = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/failed-deliveries');
      const data = await res.json();
      if (data?.items) {
        setItems(data.items);
        showToast('Refreshed undelivered messages list');
      }
    } catch {
      showToast('Failed to refresh data', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleRetryTemplate = async (phone: string, studentName?: string | null) => {
    setRetryingPhone(phone);
    try {
      const res = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: phone,
          name: studentName || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        showToast(`Template re-sent successfully to ${phone}!`, 'success');
        // Remove from list or refresh
        setItems(prev => prev.filter(i => i.phone !== phone));
      } else {
        showToast(data.error || 'Meta rejected template retry', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Retry failed', 'error');
    } finally {
      setRetryingPhone(null);
    }
  };

  const handleCopyPhone = (phone: string) => {
    navigator.clipboard?.writeText(phone);
    setCopiedPhone(phone);
    setTimeout(() => setCopiedPhone(null), 2000);
  };

  // Group stats
  const stats = useMemo(() => {
    const total = items.length;
    let window24 = 0;
    let invalid = 0;
    let policy = 0;
    let other = 0;

    for (const item of items) {
      if (item.errorCategory === '24h_window') window24++;
      else if (item.errorCategory === 'invalid_phone') invalid++;
      else if (item.errorCategory === 'policy_block') policy++;
      else other++;
    }

    return { total, window24, invalid, policy, other };
  }, [items]);

  // Filtered items
  const filtered = useMemo(() => {
    return items.filter(item => {
      if (categoryFilter !== 'all' && item.errorCategory !== categoryFilter) {
        return false;
      }
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const numOnly = q.replace(/\D/g, '');
        const matchPhone = numOnly ? item.phone.includes(numOnly) : item.phone.includes(q);
        const matchName = item.name ? item.name.toLowerCase().includes(q) : false;
        const matchError = item.deliveryError.toLowerCase().includes(q);
        if (!matchPhone && !matchName && !matchError) return false;
      }
      return true;
    });
  }, [items, categoryFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginatedItems = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, currentPage, pageSize]);

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px', background: isDark ? '#090d0b' : '#f8fafc', color: textCol }}>
      {/* Toast Alert */}
      {toast && (
        <div style={{
          position: 'fixed', top: 20, right: 20, zIndex: 9999,
          padding: '12px 20px', borderRadius: 8, fontSize: 13, fontWeight: 500,
          background: toast.type === 'error' ? 'rgba(239,68,68,0.95)' : 'rgba(92,228,109,0.95)',
          color: toast.type === 'error' ? '#fff' : '#052e16',
          boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
          display: 'flex', alignItems: 'center', gap: 8,
          animation: 'fadeIn 0.2s ease',
        }}>
          <span>{toast.type === 'error' ? '⚠️' : '✅'}</span>
          <span>{toast.message}</span>
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, flexWrap: 'wrap', gap: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, letterSpacing: '-0.5px' }}>
              Undelivered Messages
            </h1>
            <span style={{
              background: 'rgba(239, 68, 68, 0.15)',
              color: '#ef4444',
              fontSize: 12, fontWeight: 700,
              padding: '2px 9px', borderRadius: 12,
              border: '1px solid rgba(239, 68, 68, 0.3)',
            }}>
              {stats.total} Failed
            </span>
          </div>
          <p style={{ fontSize: 13, color: textMuted, margin: '6px 0 0' }}>
            All outbound WhatsApp messages that Meta rejected or could not deliver (24-hour window, invalid numbers, spam blocks, or API errors).
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={handleRefresh}
            disabled={loading}
            style={{
              background: isDark ? 'rgba(255,255,255,0.06)' : '#ffffff',
              border: `1px solid ${borderCol}`,
              borderRadius: 8, padding: '8px 14px',
              fontSize: 13, fontWeight: 500, color: textCol,
              cursor: loading ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
              transition: 'all 0.15s ease',
            }}
          >
            <span style={{ display: 'inline-block', animation: loading ? 'spin 0.8s linear infinite' : 'none' }}>🔄</span>
            <span>{loading ? 'Refreshing...' : 'Refresh'}</span>
          </button>
          <ThemeToggle />
        </div>
      </div>

      {/* KPI Stats Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 24 }}>
        <div style={{ background: glassBg, border: `1px solid ${borderCol}`, borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 12, color: textMuted, fontWeight: 500, marginBottom: 6 }}>Total Undelivered</div>
          <div style={{ fontSize: 26, fontWeight: 700, color: '#ef4444' }}>{stats.total}</div>
        </div>

        <div style={{ background: glassBg, border: `1px solid ${borderCol}`, borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 12, color: textMuted, fontWeight: 500, marginBottom: 6 }}>24h Window Expired</div>
          <div style={{ fontSize: 26, fontWeight: 700, color: '#f59e0b' }}>{stats.window24}</div>
        </div>

        <div style={{ background: glassBg, border: `1px solid ${borderCol}`, borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 12, color: textMuted, fontWeight: 500, marginBottom: 6 }}>Not on WhatsApp / Invalid</div>
          <div style={{ fontSize: 26, fontWeight: 700, color: '#ec4899' }}>{stats.invalid}</div>
        </div>

        <div style={{ background: glassBg, border: `1px solid ${borderCol}`, borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 12, color: textMuted, fontWeight: 500, marginBottom: 6 }}>Policy / API Errors</div>
          <div style={{ fontSize: 26, fontWeight: 700, color: '#a855f7' }}>{stats.policy + stats.other}</div>
        </div>
      </div>

      {/* Controls & Filter Bar */}
      <div style={{
        background: glassBg, border: `1px solid ${borderCol}`, borderRadius: 12,
        padding: '14px 18px', marginBottom: 20,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12,
      }}>
        {/* Category Pills */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[
            { id: 'all', label: `All (${stats.total})` },
            { id: '24h_window', label: `24h Expired (${stats.window24})` },
            { id: 'invalid_phone', label: `Not on WhatsApp (${stats.invalid})` },
            { id: 'policy_block', label: `Policy / Spam (${stats.policy})` },
            { id: 'other', label: `Other Errors (${stats.other})` },
          ].map((tab) => {
            const active = categoryFilter === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setCategoryFilter(tab.id as any);
                  setCurrentPage(1);
                }}
                style={{
                  background: active ? (isDark ? 'rgba(92,228,109,0.15)' : 'rgba(16,185,129,0.12)') : 'transparent',
                  color: active ? (isDark ? NEON : '#059669') : textMuted,
                  border: `1px solid ${active ? (isDark ? 'rgba(92,228,109,0.4)' : '#10b981') : borderCol}`,
                  borderRadius: 20, padding: '5px 12px', fontSize: 12, fontWeight: active ? 600 : 500,
                  cursor: 'pointer', transition: 'all 0.15s ease',
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Search Input */}
        <div style={{ minWidth: 260 }}>
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setCurrentPage(1);
            }}
            placeholder="Search by name, phone, or error..."
            style={{
              width: '100%',
              background: isDark ? 'rgba(0,0,0,0.3)' : '#f1f5f9',
              border: `1px solid ${borderCol}`,
              borderRadius: 8, padding: '7px 12px',
              fontSize: 12, color: textCol, outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>
      </div>

      {/* Main Table / List */}
      <div style={{ background: glassBg, border: `1px solid ${borderCol}`, borderRadius: 12, overflow: 'hidden' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: textMuted, fontSize: 14 }}>
            {search.trim() || categoryFilter !== 'all' ? 'No undelivered messages match your filter.' : '🎉 No failed deliveries! All messages have delivered successfully.'}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
              <thead>
                <tr style={{
                  borderBottom: `1px solid ${borderCol}`,
                  background: isDark ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.02)',
                  color: textMuted, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px',
                }}>
                  <th style={{ padding: '12px 18px' }}>Recipient</th>
                  <th style={{ padding: '12px 18px' }}>Failure Reason</th>
                  <th style={{ padding: '12px 18px' }}>Failed Message Preview</th>
                  <th style={{ padding: '12px 18px' }}>Failed At</th>
                  <th style={{ padding: '12px 18px', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedItems.map((item, idx) => {
                  const badge = getErrorCategoryBadge(item.errorCategory);
                  const isRetrying = retryingPhone === item.phone;
                  return (
                    <tr
                      key={`${item.phone}-${item.timestamp}-${idx}`}
                      style={{
                        borderBottom: `1px solid ${borderCol}`,
                        transition: 'background 0.15s ease',
                      }}
                    >
                      {/* Recipient info */}
                      <td style={{ padding: '14px 18px', verticalAlign: 'top' }}>
                        <div style={{ fontWeight: 600, color: textCol, marginBottom: 2 }}>
                          {item.name || 'Unknown Student'}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: textMuted }}>
                          <span>+{item.phone}</span>
                          <button
                            onClick={() => handleCopyPhone(item.phone)}
                            title="Copy Phone"
                            style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, fontSize: 11, color: textMuted }}
                          >
                            {copiedPhone === item.phone ? '✓' : '📋'}
                          </button>
                        </div>
                      </td>

                      {/* Error category & Meta explanation */}
                      <td style={{ padding: '14px 18px', verticalAlign: 'top', maxWidth: 300 }}>
                        <span style={{
                          display: 'inline-block',
                          background: badge.bg,
                          color: badge.color,
                          border: `1px solid ${badge.border}`,
                          borderRadius: 6,
                          padding: '2px 8px',
                          fontSize: 11,
                          fontWeight: 600,
                          marginBottom: 6,
                        }}>
                          {badge.label}
                        </span>
                        <div style={{ fontSize: 12, color: isDark ? '#fca5a5' : '#dc2626', lineHeight: 1.4, wordBreak: 'break-word' }}>
                          {item.deliveryError}
                        </div>
                      </td>

                      {/* Message preview */}
                      <td style={{ padding: '14px 18px', verticalAlign: 'top', maxWidth: 320 }}>
                        <div style={{
                          fontSize: 12,
                          color: textMuted,
                          lineHeight: 1.4,
                          background: isDark ? 'rgba(0,0,0,0.25)' : '#f8fafc',
                          padding: '8px 10px',
                          borderRadius: 6,
                          border: `1px solid ${borderCol}`,
                          maxHeight: 70,
                          overflowY: 'auto',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                        }}>
                          {item.reply || item.text || '(empty message)'}
                        </div>
                      </td>

                      {/* Time */}
                      <td style={{ padding: '14px 18px', verticalAlign: 'top', whiteSpace: 'nowrap', fontSize: 12, color: textMuted }}>
                        {formatFullTime(item.timestamp)}
                      </td>

                      {/* Actions */}
                      <td style={{ padding: '14px 18px', verticalAlign: 'top', textAlign: 'right' }}>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                          {/* Open in Chat link */}
                          <Link
                            href={`/chats?phone=${encodeURIComponent(item.phone)}`}
                            style={{
                              background: isDark ? 'rgba(255,255,255,0.06)' : '#ffffff',
                              border: `1px solid ${borderCol}`,
                              borderRadius: 6, padding: '5px 10px',
                              fontSize: 12, fontWeight: 500, color: textCol,
                              textDecoration: 'none',
                              display: 'inline-flex', alignItems: 'center', gap: 4,
                            }}
                          >
                            <span>💬</span>
                            <span>Chat</span>
                          </Link>

                          {/* Retry Template button */}
                          <button
                            onClick={() => handleRetryTemplate(item.phone, item.name)}
                            disabled={isRetrying}
                            title="Re-send via official Meta template to bypass 24h restrictions"
                            style={{
                              background: isDark ? 'rgba(92,228,109,0.15)' : '#10b981',
                              color: isDark ? NEON : '#ffffff',
                              border: `1px solid ${isDark ? 'rgba(92,228,109,0.3)' : '#10b981'}`,
                              borderRadius: 6, padding: '5px 10px',
                              fontSize: 12, fontWeight: 600,
                              cursor: isRetrying ? 'not-allowed' : 'pointer',
                              display: 'inline-flex', alignItems: 'center', gap: 4,
                            }}
                          >
                            <span>{isRetrying ? '⏳' : '🚀'}</span>
                            <span>{isRetrying ? 'Retrying...' : 'Retry Template'}</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Footer */}
        {filtered.length > 0 && (
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '14px 18px', borderTop: `1px solid ${borderCol}`,
            fontSize: 12, color: textMuted, flexWrap: 'wrap', gap: 12,
            background: isDark ? 'rgba(0,0,0,0.15)' : 'rgba(0,0,0,0.01)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <span>
                Showing <strong style={{ color: textCol }}>{(currentPage - 1) * pageSize + 1}</strong> to{' '}
                <strong style={{ color: textCol }}>{Math.min(currentPage * pageSize, filtered.length)}</strong> of{' '}
                <strong style={{ color: textCol }}>{filtered.length}</strong> undelivered messages
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>Per page:</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  style={{
                    background: isDark ? 'rgba(0,0,0,0.3)' : '#ffffff',
                    border: `1px solid ${borderCol}`,
                    borderRadius: 6, padding: '3px 8px',
                    fontSize: 12, color: textCol, outline: 'none',
                    cursor: 'pointer',
                  }}
                >
                  <option value={15}>15</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                style={{
                  background: isDark ? 'rgba(255,255,255,0.06)' : '#ffffff',
                  border: `1px solid ${borderCol}`,
                  borderRadius: 6, padding: '5px 12px',
                  fontSize: 12, color: currentPage <= 1 ? textMuted : textCol,
                  cursor: currentPage <= 1 ? 'not-allowed' : 'pointer',
                  opacity: currentPage <= 1 ? 0.5 : 1,
                  transition: 'all 0.15s ease',
                }}
              >
                Previous
              </button>

              <span style={{ padding: '0 8px', fontWeight: 600, color: textCol }}>
                Page {currentPage} of {totalPages}
              </span>

              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
                style={{
                  background: isDark ? 'rgba(255,255,255,0.06)' : '#ffffff',
                  border: `1px solid ${borderCol}`,
                  borderRadius: 6, padding: '5px 12px',
                  fontSize: 12, color: currentPage >= totalPages ? textMuted : textCol,
                  cursor: currentPage >= totalPages ? 'not-allowed' : 'pointer',
                  opacity: currentPage >= totalPages ? 0.5 : 1,
                  transition: 'all 0.15s ease',
                }}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
