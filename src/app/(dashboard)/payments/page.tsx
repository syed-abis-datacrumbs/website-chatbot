'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import DownloadCsvButton from '@/components/dashboard/DownloadCsvButton';

interface PaymentItem {
  rowIndex?: number;
  name: string;
  email: string;
  phone: string;
  submitted: string;
  driveLink: string;
  status: string;
  normalizedStatus: 'approved' | 'rejected' | 'pending';
  timestamp?: number;
}

const NEON = '#5ce46d';
const GLASS = 'linear-gradient(180deg, rgba(20,29,25,0.85) 0%, rgba(13,20,17,0.95) 100%)';
const BORDER = '1px solid #202d26';

const PRESET_REASONS = [
  'Screenshot is blurry or illegible',
  'Transaction ID / Ref number not visible',
  'Fee amount does not match Rs 7,499 / 7,500',
  'Account title does not match Data Crumbs / HabibMetro / JazzCash',
  'Duplicate or already submitted receipt',
];

export default function PaymentsPage() {
  const [payments, setPayments] = useState<PaymentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Modals state
  const [rejectTarget, setRejectTarget] = useState<PaymentItem | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectMessage, setRejectMessage] = useState('');
  const [approveTarget, setApproveTarget] = useState<PaymentItem | null>(null);
  const [approveMessage, setApproveMessage] = useState('');

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  function buildRejectMessage(studentName: string, reasonText: string) {
    const reasonBlock = reasonText.trim() ? `\n\n👉 *Reason:* ${reasonText.trim()}` : '';
    return `Assalam-o-Alaikum ${studentName},

Our admissions team reviewed your payment screenshot, but we could not verify your transaction.${reasonBlock}

Please send a clear screenshot showing the transaction ID, date, and fee amount (Rs 7,499 / 7,500) so we can verify and confirm your seat.

If you have already paid or need assistance, reply here or contact us at +92 329 2020497.`;
  }

  function openApproveModal(item: PaymentItem) {
    setApproveTarget(item);
    setApproveMessage(`🎉 *Payment Verified & Enrollment Confirmed!*

Assalam-o-Alaikum ${item.name}, your payment has been *verified* and your seat in the DataCrumbs AI & Data Science Bootcamp is *officially confirmed*! 🎓

Here are your onboarding links:
1. Create your student account on our LMS:
   🔗 https://lms.datacrumbs.org
2. Join the Official Student Community:
   💬 https://chat.whatsapp.com/Hu6jC1O0LrhBs9WesBlqFT

Welcome to DataCrumbs! Our team will share your orientation schedule right here shortly. 🚀`);
  }

  function openRejectModal(item: PaymentItem) {
    setRejectTarget(item);
    setRejectReason('');
    setRejectMessage(buildRejectMessage(item.name, ''));
  }

  function handleReasonChange(newReason: string) {
    setRejectReason(newReason);
    if (rejectTarget) {
      setRejectMessage(buildRejectMessage(rejectTarget.name, newReason));
    }
  }

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await fetch('/api/enrollments');
      const data = await res.json() as { enrollments: PaymentItem[] };
      setPayments(data.enrollments ?? []);
    } catch (err) {
      console.error('Failed to load payments:', err);
      showToast('Failed to load payment records', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function executeStatusChange(
    phone: string,
    status: 'approved' | 'rejected' | 'pending',
    reason?: string,
    customMessage?: string,
  ) {
    setActing(phone + status);
    try {
      const res = await fetch(`/api/enrollments/${encodeURIComponent(phone)}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, reason, customMessage }),
      });

      if (!res.ok) {
        throw new Error('Failed to update status');
      }

      // Optimistically update status in local state
      setPayments(prev => prev.map(item => {
        if (item.phone === phone) {
          const displayStatus = status === 'approved'
            ? 'Approved ✅'
            : status === 'rejected'
            ? (reason ? `Rejected ❌ (${reason})` : 'Rejected ❌')
            : 'Pending Verification';
          return {
            ...item,
            status: displayStatus,
            normalizedStatus: status,
          };
        }
        return item;
      }));

      const statusLabel = status === 'approved' ? 'Approved' : status === 'rejected' ? 'Rejected' : 'Set to Pending';
      showToast(`Status updated to "${statusLabel}" for +${phone}. WhatsApp notification sent!`);
      
      // Close any open modals
      setRejectTarget(null);
      setRejectReason('');
      setRejectMessage('');
      setApproveTarget(null);
      setApproveMessage('');
    } catch (err) {
      console.error('Status change error:', err);
      showToast('Failed to update status', 'error');
    } finally {
      setActing(null);
    }
  }

  // Summary counts
  const totalCount = payments.length;
  const pendingCount = payments.filter(p => p.normalizedStatus === 'pending').length;
  const approvedCount = payments.filter(p => p.normalizedStatus === 'approved').length;
  const rejectedCount = payments.filter(p => p.normalizedStatus === 'rejected').length;

  // Filter & Search
  const filteredPayments = useMemo(() => {
    return payments.filter(item => {
      // Status filter
      if (filter !== 'all' && item.normalizedStatus !== filter) {
        return false;
      }
      // Text search
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchName = (item.name || '').toLowerCase().includes(q);
        const matchEmail = (item.email || '').toLowerCase().includes(q);
        const matchPhone = (item.phone || '').toLowerCase().includes(q);
        if (!matchName && !matchEmail && !matchPhone) return false;
      }
      return true;
    });
  }, [payments, filter, search]);

  return (
    <div style={{ flex: 1, overflowY: 'auto' }}>
      <div style={{ padding: '32px 36px', maxWidth: 1400, margin: '0 auto' }}>

        {/* Toast Alert */}
        {toast && (
          <div style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            zIndex: 9999,
            background: toast.type === 'success' ? '#142a1b' : '#331212',
            border: `1px solid ${toast.type === 'success' ? NEON : '#f87171'}`,
            color: toast.type === 'success' ? NEON : '#fca5a5',
            padding: '12px 20px',
            borderRadius: 10,
            boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
            fontSize: 13,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            animation: 'fadeIn 0.2s ease-in-out',
          }}>
            <span>{toast.type === 'success' ? '✓' : '⚠'}</span>
            <span>{toast.message}</span>
          </div>
        )}

        {/* ── Approval Confirmation Modal ─────────────────────────────────────── */}
        {approveTarget && (
          <div style={{
            position: 'fixed', inset: 0, zIndex: 10000,
            background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
          }}>
            <div style={{
              background: '#0e1612', border: `1px solid ${NEON}44`, borderRadius: 16,
              width: '100%', maxWidth: 540, padding: 24, boxShadow: '0 20px 50px rgba(0,0,0,0.8)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 22 }}>🎓</span>
                  <h2 style={{ fontSize: 18, fontWeight: 700, color: '#fff', margin: 0 }}>
                    Approve Payment & Confirm Seat
                  </h2>
                </div>
                <button
                  onClick={() => setApproveTarget(null)}
                  style={{ background: 'none', border: 'none', color: '#9ca3af', fontSize: 18, cursor: 'pointer' }}
                >
                  ✕
                </button>
              </div>

              <div style={{ fontSize: 13, color: '#9ca3af', marginBottom: 16 }}>
                You are approving the payment for <strong style={{ color: '#fff' }}>{approveTarget.name}</strong> (+{approveTarget.phone}).
              </div>

              {/* Message preview / editor */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: NEON, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    💬 WhatsApp Message (Editable & Customizable):
                  </label>
                  <span style={{ fontSize: 10, color: '#9ca3af' }}>Editable before sending</span>
                </div>
                <textarea
                  rows={9}
                  value={approveMessage}
                  onChange={e => setApproveMessage(e.target.value)}
                  style={{
                    width: '100%',
                    background: 'rgba(20,45,30,0.6)',
                    border: '1px solid rgba(92,228,109,0.35)',
                    borderRadius: 10,
                    padding: 12,
                    fontSize: 12,
                    color: '#fff',
                    lineHeight: 1.5,
                    outline: 'none',
                    fontFamily: 'inherit',
                    resize: 'vertical',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button
                  onClick={() => setApproveTarget(null)}
                  disabled={Boolean(acting)}
                  style={{
                    padding: '8px 16px', borderRadius: 8, border: BORDER,
                    background: 'transparent', color: '#9ca3af', fontSize: 13, fontWeight: 500, cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => executeStatusChange(approveTarget.phone, 'approved', undefined, approveMessage)}
                  disabled={Boolean(acting)}
                  style={{
                    padding: '8px 20px', borderRadius: 8, border: 'none',
                    background: NEON, color: '#090d0b', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                  }}
                >
                  {acting ? 'Approving & Sending…' : 'Approve & Send WhatsApp ✅'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Rejection Reason Modal ─────────────────────────────────────────── */}
        {rejectTarget && (
          <div style={{
            position: 'fixed', inset: 0, zIndex: 10000,
            background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
          }}>
            <div style={{
              background: '#160e0e', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 16,
              width: '100%', maxWidth: 560, padding: 24, boxShadow: '0 20px 50px rgba(0,0,0,0.8)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 20 }}>❌</span>
                  <h2 style={{ fontSize: 18, fontWeight: 700, color: '#fff', margin: 0 }}>
                    Reject Payment Receipt
                  </h2>
                </div>
                <button
                  onClick={() => { setRejectTarget(null); setRejectReason(''); }}
                  style={{ background: 'none', border: 'none', color: '#9ca3af', fontSize: 18, cursor: 'pointer' }}
                >
                  ✕
                </button>
              </div>

              <div style={{ fontSize: 13, color: '#9ca3af', marginBottom: 16 }}>
                Rejecting receipt for <strong style={{ color: '#fff' }}>{rejectTarget.name}</strong> (+{rejectTarget.phone}). Specify the reason so the student knows what to fix.
              </div>

              {/* Preset Reason Chips */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Quick Select Reason:
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {PRESET_REASONS.map(r => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => handleReasonChange(r)}
                      style={{
                        padding: '4px 10px', borderRadius: 20,
                        border: rejectReason === r ? '1px solid #f87171' : '1px solid rgba(255,255,255,0.1)',
                        background: rejectReason === r ? 'rgba(248,113,113,0.2)' : 'rgba(255,255,255,0.03)',
                        color: rejectReason === r ? '#fca5a5' : '#9ca3af',
                        fontSize: 11, cursor: 'pointer', transition: 'all 0.15s ease',
                      }}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              {/* Rejection Reason Input Field */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#f87171', marginBottom: 6 }}>
                  Rejection Reason (Input field):
                </label>
                <input
                  type="text"
                  placeholder="e.g. Transaction ID is blurry, or amount does not match Rs 7,499"
                  value={rejectReason}
                  onChange={e => handleReasonChange(e.target.value)}
                  style={{
                    width: '100%', padding: '10px 14px', borderRadius: 8,
                    border: '1px solid rgba(248,113,113,0.4)', background: '#0d0808',
                    color: '#fff', fontSize: 13, outline: 'none', fontFamily: 'inherit',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              {/* WhatsApp message editor */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: '#fca5a5', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    💬 WhatsApp Message (Editable & Customizable):
                  </label>
                  <span style={{ fontSize: 10, color: '#9ca3af' }}>Editable before sending</span>
                </div>
                <textarea
                  rows={8}
                  value={rejectMessage}
                  onChange={e => setRejectMessage(e.target.value)}
                  style={{
                    width: '100%',
                    background: 'rgba(40,15,15,0.7)',
                    border: '1px solid rgba(248,113,113,0.35)',
                    borderRadius: 10,
                    padding: 12,
                    fontSize: 12,
                    color: '#fff',
                    lineHeight: 1.4,
                    outline: 'none',
                    fontFamily: 'inherit',
                    resize: 'vertical',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button
                  onClick={() => { setRejectTarget(null); setRejectReason(''); setRejectMessage(''); }}
                  disabled={Boolean(acting)}
                  style={{
                    padding: '8px 16px', borderRadius: 8, border: BORDER,
                    background: 'transparent', color: '#9ca3af', fontSize: 13, fontWeight: 500, cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => executeStatusChange(rejectTarget.phone, 'rejected', rejectReason, rejectMessage)}
                  disabled={Boolean(acting)}
                  style={{
                    padding: '8px 20px', borderRadius: 8, border: 'none',
                    background: '#f87171', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                  }}
                >
                  {acting ? 'Rejecting & Sending…' : 'Send Rejection Message ❌'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Top Header ─────────────────────────────────────────────────────── */}
        <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <h1 style={{ fontSize: 28, fontWeight: 700, color: '#fff', margin: 0 }}>
                Payments & Verification
              </h1>
              {pendingCount > 0 && (
                <span style={{
                  background: 'rgba(251,146,60,0.15)',
                  border: '1px solid rgba(251,146,60,0.4)',
                  color: '#fb923c',
                  borderRadius: 20,
                  fontSize: 12,
                  fontWeight: 700,
                  padding: '3px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fb923c', display: 'inline-block' }} />
                  {pendingCount} Pending Review
                </span>
              )}
            </div>
            <p style={{ fontSize: 13, color: '#9ca3af', marginTop: 4 }}>
              Admissions team reviews receipts and manages approvals. Approving or rejecting instantly triggers a WhatsApp update with custom reasons.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={() => load(true)}
              disabled={refreshing || loading}
              style={{
                background: 'rgba(20,29,25,0.8)',
                border: BORDER,
                color: '#9ca3af',
                padding: '8px 14px',
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span style={{ display: 'inline-block', transform: refreshing ? 'rotate(360deg)' : 'none', transition: 'transform 0.5s' }}>
                ↻
              </span>
              Refresh
            </button>
            <DownloadCsvButton
              filename="datacrumbs-payments.csv"
              headers={['Name', 'Email', 'Phone', 'Submitted', 'Status', 'Screenshot Link']}
              rows={filteredPayments.map(e => [
                e.name ?? '',
                e.email ?? '',
                `+${e.phone}`,
                e.submitted,
                e.status,
                e.driveLink ?? '',
              ])}
            />
          </div>
        </div>

        {/* ── Metric KPI Cards ─────────────────────────────────────────────────── */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 16,
          marginBottom: 24,
        }}>
          {/* Card: Total */}
          <div
            onClick={() => setFilter('all')}
            style={{
              background: filter === 'all' ? 'rgba(30,45,38,0.9)' : GLASS,
              border: filter === 'all' ? `1px solid ${NEON}` : BORDER,
              borderRadius: 12,
              padding: '16px 20px',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Total Submissions
            </div>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#fff', marginTop: 4 }}>
              {totalCount}
            </div>
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
              All payment submissions
            </div>
          </div>

          {/* Card: Pending */}
          <div
            onClick={() => setFilter('pending')}
            style={{
              background: filter === 'pending' ? 'rgba(45,35,20,0.9)' : GLASS,
              border: filter === 'pending' ? '1px solid #fb923c' : BORDER,
              borderRadius: 12,
              padding: '16px 20px',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 600, color: '#fb923c', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Pending Verification
            </div>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#fb923c', marginTop: 4 }}>
              {pendingCount}
            </div>
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
              Requires admissions action
            </div>
          </div>

          {/* Card: Approved */}
          <div
            onClick={() => setFilter('approved')}
            style={{
              background: filter === 'approved' ? 'rgba(20,45,30,0.9)' : GLASS,
              border: filter === 'approved' ? `1px solid ${NEON}` : BORDER,
              borderRadius: 12,
              padding: '16px 20px',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 600, color: NEON, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Approved ✅
            </div>
            <div style={{ fontSize: 28, fontWeight: 700, color: NEON, marginTop: 4 }}>
              {approvedCount}
            </div>
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
              Confirmed & LMS invited
            </div>
          </div>

          {/* Card: Rejected */}
          <div
            onClick={() => setFilter('rejected')}
            style={{
              background: filter === 'rejected' ? 'rgba(45,20,20,0.9)' : GLASS,
              border: filter === 'rejected' ? '1px solid #f87171' : BORDER,
              borderRadius: 12,
              padding: '16px 20px',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 600, color: '#f87171', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Rejected ❌
            </div>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#f87171', marginTop: 4 }}>
              {rejectedCount}
            </div>
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
              Invalid or illegible receipts
            </div>
          </div>
        </div>

        {/* ── Filter Tabs & Search Bar ─────────────────────────────────────────── */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
          marginBottom: 16,
        }}>
          {/* Status Filter Tabs */}
          <div style={{ display: 'flex', gap: 6, background: '#0d1511', padding: 4, borderRadius: 10, border: BORDER }}>
            {(['all', 'pending', 'approved', 'rejected'] as const).map(tab => {
              const active = filter === tab;
              const count = tab === 'all' ? totalCount : tab === 'pending' ? pendingCount : tab === 'approved' ? approvedCount : rejectedCount;
              return (
                <button
                  key={tab}
                  onClick={() => setFilter(tab)}
                  style={{
                    padding: '6px 14px',
                    borderRadius: 7,
                    border: 'none',
                    background: active ? '#1a2821' : 'transparent',
                    color: active ? '#fff' : '#9ca3af',
                    fontSize: 12,
                    fontWeight: active ? 600 : 500,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    transition: 'all 0.15s ease',
                  }}
                >
                  <span style={{ textTransform: 'capitalize' }}>{tab}</span>
                  <span style={{
                    fontSize: 10,
                    padding: '1px 6px',
                    borderRadius: 10,
                    background: active ? (tab === 'pending' ? 'rgba(251,146,60,0.3)' : tab === 'approved' ? 'rgba(92,228,109,0.3)' : 'rgba(248,113,113,0.3)') : 'rgba(255,255,255,0.06)',
                    color: active ? '#fff' : '#6b7280',
                  }}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Search Input */}
          <div style={{ position: 'relative', minWidth: 280 }}>
            <input
              type="text"
              placeholder="Search by name, phone, or email..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px 8px 34px',
                borderRadius: 8,
                border: BORDER,
                background: '#0d1511',
                color: '#fff',
                fontSize: 12,
                outline: 'none',
                fontFamily: 'inherit',
              }}
            />
            <span style={{ position: 'absolute', left: 11, top: 8, color: '#6b7280', fontSize: 13 }}>
              🔍
            </span>
            {search && (
              <button
                onClick={() => setSearch('')}
                style={{
                  position: 'absolute',
                  right: 8,
                  top: 7,
                  background: 'none',
                  border: 'none',
                  color: '#9ca3af',
                  cursor: 'pointer',
                  fontSize: 13,
                }}
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* ── Data Table ──────────────────────────────────────────────────────── */}
        {loading ? (
          <div style={{ color: '#6b7280', fontSize: 14, paddingTop: 48, textAlign: 'center' }}>
            Loading payments…
          </div>
        ) : filteredPayments.length === 0 ? (
          <div style={{
            background: GLASS, border: BORDER, borderRadius: 16,
            padding: '48px 24px', textAlign: 'center',
            color: '#6b7280', fontSize: 14,
          }}>
            {search ? 'No payments matching your search.' : filter !== 'all' ? `No ${filter} payments found.` : 'No payment submissions yet.'}
          </div>
        ) : (
          <div style={{ background: GLASS, border: BORDER, borderRadius: 16, overflow: 'hidden' }}>

            {/* Header row */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1.2fr 1.1fr 140px 140px 150px 200px',
              padding: '14px 20px',
              background: 'rgba(13,20,17,0.7)',
              borderBottom: '1px solid #1a251f',
              fontSize: 11,
              fontWeight: 600,
              color: '#6b7280',
              textTransform: 'uppercase',
              letterSpacing: '0.6px',
            }}>
              <div>Student</div>
              <div>Phone & Chat</div>
              <div>Submitted</div>
              <div>Receipt</div>
              <div>Status</div>
              <div style={{ textAlign: 'right' }}>Admin Actions</div>
            </div>

            {filteredPayments.map((item, i) => {
              const isActing = acting?.startsWith(item.phone);

              return (
                <div
                  key={item.phone + (item.rowIndex ?? i)}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1.2fr 1.1fr 140px 140px 150px 200px',
                    padding: '16px 20px',
                    borderBottom: i < filteredPayments.length - 1 ? '1px solid #1a251f' : 'none',
                    alignItems: 'center',
                    fontSize: 13,
                    background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)',
                  }}
                >
                  {/* Student Name & Email */}
                  <div style={{ overflow: 'hidden', paddingRight: 10 }}>
                    <div style={{ fontWeight: 600, color: '#f3f4f6', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                      {item.name || <span style={{ color: '#6b7280' }}>Student</span>}
                    </div>
                    <div style={{ color: '#9ca3af', fontSize: 11, marginTop: 2, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                      {item.email || <span style={{ color: '#4b5563' }}>No email</span>}
                    </div>
                  </div>

                  {/* Phone & WhatsApp link */}
                  <div style={{ paddingRight: 10 }}>
                    <div style={{ color: '#d1d5db', fontSize: 12, fontFamily: 'monospace' }}>
                      +{item.phone}
                    </div>
                    <a
                      href={`https://wa.me/${item.phone}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        fontSize: 11,
                        color: NEON,
                        textDecoration: 'none',
                        marginTop: 2,
                      }}
                    >
                      <span>💬 Open WhatsApp</span>
                    </a>
                  </div>

                  {/* Submitted Time */}
                  <div style={{ color: '#9ca3af', fontSize: 11, lineHeight: 1.3 }}>
                    {item.submitted}
                  </div>

                  {/* Screenshot Link */}
                  <div>
                    {item.driveLink ? (
                      <a
                        href={item.driveLink}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '4px 10px',
                          borderRadius: 6,
                          background: 'rgba(92,228,109,0.1)',
                          border: '1px solid rgba(92,228,109,0.25)',
                          color: NEON,
                          fontSize: 11,
                          fontWeight: 600,
                          textDecoration: 'none',
                        }}
                      >
                        <span>📄 View Receipt</span>
                        <span style={{ fontSize: 10 }}>↗</span>
                      </a>
                    ) : (
                      <span style={{ color: '#4b5563', fontSize: 11, fontStyle: 'italic' }}>
                        No image
                      </span>
                    )}
                  </div>

                  {/* Status Badge */}
                  <div>
                    {item.normalizedStatus === 'approved' ? (
                      <span style={{
                        padding: '4px 10px',
                        borderRadius: 20,
                        fontSize: 11,
                        fontWeight: 600,
                        color: NEON,
                        background: 'rgba(92,228,109,0.12)',
                        border: '1px solid rgba(92,228,109,0.3)',
                        display: 'inline-block',
                      }}>
                        {item.status.includes('✅') ? item.status : 'Approved ✅'}
                      </span>
                    ) : item.normalizedStatus === 'rejected' ? (
                      <span style={{
                        padding: '4px 10px',
                        borderRadius: 20,
                        fontSize: 11,
                        fontWeight: 600,
                        color: '#f87171',
                        background: 'rgba(248,113,113,0.12)',
                        border: '1px solid rgba(248,113,113,0.3)',
                        display: 'inline-block',
                      }}>
                        {item.status.includes('❌') ? item.status : 'Rejected ❌'}
                      </span>
                    ) : (
                      <span style={{
                        padding: '4px 10px',
                        borderRadius: 20,
                        fontSize: 11,
                        fontWeight: 600,
                        color: '#fb923c',
                        background: 'rgba(251,146,60,0.12)',
                        border: '1px solid rgba(251,146,60,0.3)',
                        display: 'inline-block',
                      }}>
                        {item.status.includes('Pending') ? item.status : 'Pending Review ⚠️'}
                      </span>
                    )}
                  </div>

                  {/* Admin Change Status Actions */}
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    {/* Approve button (opens approval modal) */}
                    {item.normalizedStatus !== 'approved' && (
                      <button
                        onClick={() => openApproveModal(item)}
                        disabled={!!acting}
                        title="Approve payment & send LMS/Community confirmation WhatsApp"
                        style={{
                          padding: '5px 12px',
                          borderRadius: 6,
                          border: `1px solid ${NEON}`,
                          background: 'rgba(92,228,109,0.08)',
                          color: NEON,
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: acting ? 'not-allowed' : 'pointer',
                          opacity: isActing ? 0.5 : 1,
                        }}
                      >
                        Approve
                      </button>
                    )}

                    {/* Reject button (opens reject modal with reason input field) */}
                    {item.normalizedStatus !== 'rejected' && (
                      <button
                        onClick={() => openRejectModal(item)}
                        disabled={!!acting}
                        title="Reject payment & specify reason to send on WhatsApp"
                        style={{
                          padding: '5px 12px',
                          borderRadius: 6,
                          border: '1px solid rgba(248,113,113,0.4)',
                          background: 'rgba(248,113,113,0.08)',
                          color: '#f87171',
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: acting ? 'not-allowed' : 'pointer',
                          opacity: isActing ? 0.5 : 1,
                        }}
                      >
                        Reject
                      </button>
                    )}

                    {/* Reset to Pending button */}
                    {item.normalizedStatus !== 'pending' && (
                      <button
                        onClick={() => executeStatusChange(item.phone, 'pending')}
                        disabled={!!acting}
                        title="Reset status back to Pending Review"
                        style={{
                          padding: '5px 8px',
                          borderRadius: 6,
                          border: '1px solid rgba(251,146,60,0.3)',
                          background: 'transparent',
                          color: '#fb923c',
                          fontSize: 11,
                          fontWeight: 500,
                          cursor: acting ? 'not-allowed' : 'pointer',
                          opacity: isActing ? 0.5 : 1,
                        }}
                      >
                        {acting === item.phone + 'pending' ? '…' : 'Set Pending'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
