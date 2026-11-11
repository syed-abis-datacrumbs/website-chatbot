'use client';

import { useState, useRef, useEffect } from 'react';
import { ChatMessage } from '@/lib/redis';
import { WELCOME_GREETING } from '@/lib/knowledge';
import { useTheme } from '@/context/ThemeContext';

const NEON = '#5ce46d';
const BG = '#090d0b';
const GLASS = 'linear-gradient(180deg, rgba(20,29,25,0.8) 0%, rgba(13,20,17,0.9) 100%)';
const BORDER = '#202d26';

// Quick-reply buttons above the admin input — click to send instantly, no typing needed
const QUICK_ACTIONS: { label: string; message?: string; sendBrochure?: boolean }[] = [
  { label: 'Greetings', message: WELCOME_GREETING },
  { label: 'Send Brochure', sendBrochure: true, message: 'Here is our complete Data Science & AI Bootcamp brochure! It covers the full curriculum, pricing, internship details, and instructor profiles. Let me know if you have any questions 😊' },
  { label: 'Curriculum', message: `Here's our 16-week curriculum:\n\n*Weeks 1-2:* Python & AI Tools Foundations\n*Weeks 3-4:* Python for Data (NumPy, Pandas)\n*Weeks 5-6:* AI & Machine Learning Fundamentals\n*Weeks 7-8:* AI & ML Projects (hands-on)\n*Weeks 9-10:* N8N Automation Foundations\n*Weeks 11-12:* GenAI Apps & Agentic Workflows\n*Weeks 13-14:* Deep Learning (TensorFlow)\n*Weeks 15-16:* Portfolio, Deployment & Career Support` },
  { label: 'Timings', message: 'Our live classes are held on *Saturday and Sunday*, *4:00 PM – 5:30 PM*. All sessions are recorded and available on our Cognos LMS if you miss a class!' },
  { label: 'Duration', message: `Our AI & Data Science Bootcamp is *4 Months (16 Weeks)*.\n\nUpon completion, you'll also get a *guaranteed 1-2 month industry internship*! 🚀` },
];

const EMOJI_PICKS = ['😊', '👍', '🙏', '🎉', '❤️', '🔥', '✅', '😀', '🚀', '👋', '💡', '📅', '💰', '📄', '🤝', '😅'];

interface Contact {
  phone: string;
  messages: ChatMessage[];
  lastMessage: ChatMessage;
}

function formatTime(ts: number) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  const hrs = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hrs < 24) return `${hrs}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString('en-PK', { day: 'numeric', month: 'short' });
}

function formatFull(ts: number) {
  return new Date(ts).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' });
}

function formatMessageTime(ts: number) {
  return new Date(ts).toLocaleTimeString('en-PK', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function formatDateSeparator(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' });
}

function phoneInitials(phone: string) { return phone.slice(-2); }

function hueFromPhone(phone: string) {
  let h = 0;
  for (const c of phone) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return [140, 160, 180, 200, 220, 260, 280][h % 7];
}

function groupByPhone(messages: ChatMessage[]): Contact[] {
  const map = new Map<string, ChatMessage[]>();
  for (const msg of messages) {
    if (!map.has(msg.from)) map.set(msg.from, []);
    map.get(msg.from)!.push(msg);
  }
  return Array.from(map.entries())
    .map(([phone, msgs]) => ({
      phone,
      messages: msgs.sort((a, b) => b.timestamp - a.timestamp),
      lastMessage: msgs.reduce((l, m) => m.timestamp > l.timestamp ? m : l),
    }))
    .sort((a, b) => b.lastMessage.timestamp - a.lastMessage.timestamp);
}

export default function ChatsUI({ contacts: initial, total }: { contacts: Contact[]; total: number }) {
  const [contacts, setContacts] = useState<Contact[]>(initial);
  const [selected, setSelected] = useState<string | null>(initial[0]?.phone ?? null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [attachBrochure, setAttachBrochure] = useState(false);
  const [hov, setHov] = useState<string | null>(null);
  const [botDisabled, setBotDisabled] = useState<boolean>(false);
  const [toggling, setToggling] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showFilter, setShowFilter] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [timeFrom, setTimeFrom] = useState('');
  const [timeTo, setTimeTo] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const { isDark, toggleTheme } = useTheme();
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const emojiRef = useRef<HTMLDivElement>(null);

  const dateFilterActive = Boolean(dateFrom || dateTo || timeFrom || timeTo);

  const filteredContacts = contacts.filter(c => {
    if (search.trim() && !c.phone.includes(search.trim().replace(/\D/g, ''))) return false;
    if (dateFilterActive) {
      const d = new Date(c.lastMessage.timestamp);
      if (dateFrom && d < new Date(`${dateFrom}T00:00:00`)) return false;
      if (dateTo && d > new Date(`${dateTo}T23:59:59`)) return false;
      if (timeFrom || timeTo) {
        const mins = d.getHours() * 60 + d.getMinutes();
        if (timeFrom) {
          const [fh, fm] = timeFrom.split(':').map(Number);
          if (mins < fh * 60 + fm) return false;
        }
        if (timeTo) {
          const [th, tm] = timeTo.split(':').map(Number);
          if (mins > th * 60 + tm) return false;
        }
      }
    }
    return true;
  });

  function clearDateFilter() {
    setDateFrom(''); setDateTo(''); setTimeFrom(''); setTimeTo('');
  }

  // Close popovers on outside click
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setShowFilter(false);
      if (emojiRef.current && !emojiRef.current.contains(e.target as Node)) setShowEmoji(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  // Poll for new messages every 5 seconds
  useEffect(() => {
    const poll = setInterval(async () => {
      try {
        const res = await fetch('/api/messages');
        const data = await res.json() as { messages: ChatMessage[] };
        setContacts(prev => {
          const updated = groupByPhone(data.messages);
          const prevTotal = prev.reduce((s, c) => s + c.messages.length, 0);
          const newTotal = updated.reduce((s, c) => s + c.messages.length, 0);
          return newTotal !== prevTotal ? updated : prev;
        });
      } catch { /* ignore network errors */ }
    }, 5000);
    return () => clearInterval(poll);
  }, []);

  // Fetch bot status whenever selected contact changes
  useEffect(() => {
    if (!selected) return;
    fetch(`/api/contacts/${encodeURIComponent(selected)}/bot`)
      .then(r => r.json())
      .then((d: { disabled: boolean }) => setBotDisabled(d.disabled))
      .catch(() => { });
  }, [selected]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'instant' });
    setAttachBrochure(false);
    inputRef.current?.focus();
  }, [selected]);

  // Auto-expand textarea as user types or pastes multi-line text
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 140)}px`;
    }
  }, [input]);

  async function toggleBot() {
    if (!selected || toggling) return;
    setToggling(true);
    try {
      const res = await fetch(`/api/contacts/${encodeURIComponent(selected)}/bot`, { method: 'POST' });
      const data = await res.json() as { disabled: boolean };
      setBotDisabled(data.disabled);
    } finally {
      setToggling(false);
    }
  }

  async function deleteChat(phone: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (deleting) return;
    setDeleting(phone);
    try {
      await fetch(`/api/messages/${encodeURIComponent(phone)}`, { method: 'DELETE' });
      setContacts(prev => prev.filter(c => c.phone !== phone));
      if (selected === phone) setSelected(null);
    } finally {
      setDeleting(null);
    }
  }

  const active = contacts.find(c => c.phone === selected) ?? null;

  async function handleSend() {
    const text = input.trim();
    if (!text || !selected || sending) return;
    setSending(true);
    const brochureToSend = attachBrochure;
    setInput('');
    setAttachBrochure(false);
    const optimistic: ChatMessage = {
      from: selected,
      text: '',
      reply: text,
      timestamp: Date.now(),
      ...(brochureToSend ? { mediaType: 'document' as const } : {}),
    };
    setContacts(prev => prev.map(c =>
      c.phone === selected
        ? { ...c, messages: [optimistic, ...c.messages], lastMessage: optimistic }
        : c
    ));
    try {
      await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: selected,
          message: text,
          sendBrochure: brochureToSend,
        }),
      });
    } catch { /* optimistic shown */ }
    finally { setSending(false); }
  }

  function handleQuickAction(action: typeof QUICK_ACTIONS[number]) {
    if (!action.message) return;
    setInput(action.message);
    setAttachBrochure(Boolean(action.sendBrochure));
    inputRef.current?.focus();
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', background: isDark ? BG : '#f8fafc' }}>

      {/* ── Contact list ── */}
      <div style={{
        width: 280, flexShrink: 0,
        display: 'flex', flexDirection: 'column',
        background: isDark ? '#0a0f0d' : '#ffffff',
        borderRight: `1px solid ${isDark ? BORDER : '#e2e8f0'}`,
        transition: 'background 0.2s, border-color 0.2s',
      }}>
        <div style={{ padding: '16px 16px 12px', borderBottom: `1px solid ${isDark ? BORDER : '#e2e8f0'}` }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: isDark ? '#fff' : '#0f172a' }}>Conversations</div>
          <div style={{ fontSize: 11, color: isDark ? '#6b7280' : '#64748b', marginTop: 2, marginBottom: 10 }}>
            {contacts.length} contact{contacts.length !== 1 ? 's' : ''} · {total} message{total !== 1 ? 's' : ''}
          </div>
          <div style={{ display: 'flex', gap: 6, position: 'relative' }}>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by phone number…"
              style={{
                flex: 1, minWidth: 0, boxSizing: 'border-box',
                background: isDark ? '#0d1511' : '#f8fafc',
                border: `1px solid ${isDark ? BORDER : '#cbd5e1'}`,
                borderRadius: 8, padding: '7px 10px', fontSize: 12.5,
                color: isDark ? '#e5e7eb' : '#0f172a', outline: 'none',
              }}
            />
            <div style={{ position: 'relative' }} ref={filterRef}>
              <button
                onClick={() => setShowFilter(v => !v)}
                title="Filter by date & time"
                style={{
                  width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                  background: dateFilterActive
                    ? (isDark ? 'rgba(92,228,109,0.12)' : 'rgba(16,185,129,0.12)')
                    : (isDark ? '#0d1511' : '#f8fafc'),
                  border: `1px solid ${dateFilterActive
                    ? (isDark ? 'rgba(92,228,109,0.4)' : '#10b981')
                    : (isDark ? BORDER : '#cbd5e1')}`,
                  color: dateFilterActive ? (isDark ? NEON : '#059669') : (isDark ? '#9ca3af' : '#64748b'),
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer',
                }}
              >
                <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h18l-7 8v6l-4 2v-8L3 4z" />
                </svg>
              </button>
              {showFilter && (
                <div style={{
                  position: 'absolute', top: 38, right: 0, zIndex: 20,
                  width: 220,
                  background: isDark ? '#0d1511' : '#ffffff',
                  border: `1px solid ${isDark ? BORDER : '#e2e8f0'}`,
                  borderRadius: 10, padding: 12,
                  boxShadow: isDark ? '0 8px 24px rgba(0,0,0,0.5)' : '0 10px 25px -5px rgba(0,0,0,0.1)',
                }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: isDark ? '#9ca3af' : '#475569', marginBottom: 8 }}>Filter by date & time</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <label style={{ fontSize: 10, color: isDark ? '#6b7280' : '#64748b' }}>
                      Date from
                      <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                        style={{ width: '100%', marginTop: 3, boxSizing: 'border-box', background: isDark ? '#090d0b' : '#f8fafc', border: `1px solid ${isDark ? BORDER : '#cbd5e1'}`, borderRadius: 6, padding: '5px 7px', fontSize: 11.5, color: isDark ? '#e5e7eb' : '#0f172a' }} />
                    </label>
                    <label style={{ fontSize: 10, color: isDark ? '#6b7280' : '#64748b' }}>
                      Date to
                      <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                        style={{ width: '100%', marginTop: 3, boxSizing: 'border-box', background: isDark ? '#090d0b' : '#f8fafc', border: `1px solid ${isDark ? BORDER : '#cbd5e1'}`, borderRadius: 6, padding: '5px 7px', fontSize: 11.5, color: isDark ? '#e5e7eb' : '#0f172a' }} />
                    </label>
                    <label style={{ fontSize: 10, color: isDark ? '#6b7280' : '#64748b' }}>
                      Time from
                      <input type="time" value={timeFrom} onChange={e => setTimeFrom(e.target.value)}
                        style={{ width: '100%', marginTop: 3, boxSizing: 'border-box', background: isDark ? '#090d0b' : '#f8fafc', border: `1px solid ${isDark ? BORDER : '#cbd5e1'}`, borderRadius: 6, padding: '5px 7px', fontSize: 11.5, color: isDark ? '#e5e7eb' : '#0f172a' }} />
                    </label>
                    <label style={{ fontSize: 10, color: isDark ? '#6b7280' : '#64748b' }}>
                      Time to
                      <input type="time" value={timeTo} onChange={e => setTimeTo(e.target.value)}
                        style={{ width: '100%', marginTop: 3, boxSizing: 'border-box', background: isDark ? '#090d0b' : '#f8fafc', border: `1px solid ${isDark ? BORDER : '#cbd5e1'}`, borderRadius: 6, padding: '5px 7px', fontSize: 11.5, color: isDark ? '#e5e7eb' : '#0f172a' }} />
                    </label>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                    <button onClick={clearDateFilter}
                      style={{ flex: 1, fontSize: 11, padding: '6px 0', borderRadius: 6, border: `1px solid ${isDark ? BORDER : '#cbd5e1'}`, background: 'transparent', color: isDark ? '#9ca3af' : '#64748b', cursor: 'pointer' }}>
                      Clear
                    </button>
                    <button onClick={() => setShowFilter(false)}
                      style={{ flex: 1, fontSize: 11, fontWeight: 600, padding: '6px 0', borderRadius: 6, border: 'none', background: isDark ? NEON : '#10b981', color: isDark ? '#000' : '#fff', cursor: 'pointer' }}>
                      Apply
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filteredContacts.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: isDark ? '#6b7280' : '#64748b', fontSize: 13 }}>
              {search.trim() || dateFilterActive ? 'No matching conversations' : 'No conversations yet'}
            </div>
          ) : filteredContacts.map(c => {
            const isActive = c.phone === selected;
            const isHovered = hov === c.phone;
            const h = hueFromPhone(c.phone);
            return (
              <div
                key={c.phone}
                onMouseEnter={() => setHov(c.phone)}
                onMouseLeave={() => setHov(null)}
                style={{ position: 'relative', borderBottom: `1px solid ${isDark ? BORDER : '#f1f5f9'}` }}
              >
                <button
                  onClick={() => setSelected(c.phone)}
                  style={{
                    width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer',
                    padding: '12px 14px',
                    background: isActive
                      ? (isDark ? 'linear-gradient(to right, #1a3020, #0e1f14)' : 'linear-gradient(to right, #ecfdf5, #f0fdf4)')
                      : isHovered ? (isDark ? '#121a16' : '#f8fafc') : 'transparent',
                    borderLeft: `3px solid ${isActive ? (isDark ? NEON : '#10b981') : 'transparent'}`,
                    display: 'flex', alignItems: 'center', gap: 10,
                    transition: 'all 0.15s',
                    boxSizing: 'border-box',
                    paddingRight: isHovered ? 44 : 14,
                  }}
                >
                  <div style={{
                    width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
                    background: `hsla(${h},45%,${isDark ? '18%' : '90%'},1)`,
                    border: `1.5px solid hsla(${h},45%,${isDark ? '30%' : '75%'},1)`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 12, fontWeight: 700, color: `hsla(${h},${isDark ? '60%,70%' : '70%,35%'},1)`,
                  }}>
                    {phoneInitials(c.phone)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <span style={{ fontWeight: 600, fontSize: 12.5, color: isActive ? (isDark ? '#fff' : '#0f172a') : (isDark ? '#d1d5db' : '#334155') }}>
                        +{c.phone}
                      </span>
                      <span style={{ fontSize: 10, color: isDark ? '#6b7280' : '#94a3b8', flexShrink: 0, marginLeft: 4 }}>
                        {formatTime(c.lastMessage.timestamp)}
                      </span>
                    </div>
                    <div style={{
                      fontSize: 11.5, color: isDark ? '#6b7280' : '#64748b', marginTop: 2,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {c.lastMessage.text === '[image]' ? '📷 Photo' : (c.lastMessage.reply || c.lastMessage.text)}
                    </div>
                  </div>
                </button>
                {isHovered && (
                  <button
                    onClick={(e) => deleteChat(c.phone, e)}
                    disabled={deleting === c.phone}
                    title="Delete this chat"
                    style={{
                      position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                      width: 28, height: 28, borderRadius: 6, border: 'none',
                      background: 'rgba(220,38,38,0.12)',
                      color: deleting === c.phone ? '#6b7280' : '#f87171',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: deleting === c.phone ? 'not-allowed' : 'pointer',
                      transition: 'all 0.15s',
                      flexShrink: 0,
                    }}
                  >
                    <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Chat area ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: isDark ? BG : '#f8fafc' }}>
        {active ? (
          <>
            {/* Header */}
            <div style={{
              background: isDark ? GLASS : '#ffffff',
              border: 'none',
              borderBottom: `1px solid ${isDark ? BORDER : '#e2e8f0'}`,
              padding: '14px 24px',
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <div style={{
                width: 38, height: 38, borderRadius: '50%',
                background: `hsla(${hueFromPhone(active.phone)},45%,${isDark ? '18%' : '90%'},1)`,
                border: `1.5px solid ${isDark ? NEON : '#10b981'}`,
                boxShadow: isDark ? '0 0 8px rgba(92,228,109,0.2)' : '0 1px 4px rgba(16,185,129,0.2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 700, color: isDark ? NEON : '#059669',
              }}>
                {phoneInitials(active.phone)}
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: isDark ? '#fff' : '#0f172a' }}>+{active.phone}</div>
                <div style={{ fontSize: 11, color: isDark ? '#6b7280' : '#64748b', marginTop: 1 }}>
                  {active.messages.length} exchange{active.messages.length !== 1 ? 's' : ''}
                </div>
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14 }}>
                {/* Theme toggle */}
                <button
                  onClick={toggleTheme}
                  title={`Switch to ${isDark ? 'Light' : 'Dark'} mode`}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '4px 10px', borderRadius: 20,
                    background: isDark ? 'rgba(255,255,255,0.08)' : '#f1f5f9',
                    border: `1px solid ${isDark ? '#202d26' : '#cbd5e1'}`,
                    color: isDark ? '#fef08a' : '#334155',
                    cursor: 'pointer', fontSize: 12, fontWeight: 500,
                    transition: 'all 0.15s',
                  }}
                >
                  <span>{isDark ? '☀️' : '🌙'}</span>
                  <span style={{ fontSize: 11.5, color: isDark ? '#d1d5db' : '#334155' }}>
                    {isDark ? 'Light' : 'Dark'}
                  </span>
                </button>

                {/* Bot toggle */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, color: isDark ? '#6b7280' : '#64748b' }}>
                    Bot: <strong style={{ color: botDisabled ? '#ef4444' : (isDark ? NEON : '#059669') }}>{botDisabled ? 'OFF' : 'ON'}</strong>
                  </span>
                  <button
                    onClick={toggleBot}
                    disabled={toggling}
                    title={botDisabled ? 'Enable bot for this contact' : 'Disable bot — take over manually'}
                    style={{
                      width: 40, height: 22, borderRadius: 11, border: 'none',
                      background: botDisabled ? '#9ca3af' : (isDark ? NEON : '#10b981'),
                      cursor: toggling ? 'not-allowed' : 'pointer',
                      position: 'relative', transition: 'background 0.2s',
                      boxShadow: botDisabled ? 'none' : (isDark ? '0 0 10px rgba(92,228,109,0.4)' : '0 0 8px rgba(16,185,129,0.3)'),
                    }}
                  >
                    <span style={{
                      position: 'absolute', top: 3,
                      left: botDisabled ? 3 : 21,
                      width: 16, height: 16, borderRadius: '50%',
                      background: '#fff', transition: 'left 0.2s',
                      display: 'block',
                    }} />
                  </button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: isDark ? NEON : '#10b981', boxShadow: isDark ? `0 0 8px rgba(92,228,109,0.6)` : '0 0 6px rgba(16,185,129,0.5)' }} />
                  <span style={{ fontSize: 11, color: isDark ? '#6b7280' : '#64748b' }}>Active</span>
                </div>
              </div>
            </div>

            {/* Messages */}
            <div style={{
              flex: 1, overflowY: 'auto', padding: '20px 28px',
              display: 'flex', flexDirection: 'column', gap: 12,
              background: isDark ? BG : '#f8fafc',
            }}>
              {(() => {
                const ordered = [...active.messages].reverse();
                return ordered.map((msg, i) => {
                  const prevMsg = i > 0 ? ordered[i - 1] : null;
                  const showDate = !prevMsg || new Date(msg.timestamp).toDateString() !== new Date(prevMsg.timestamp).toDateString();
                  return (
                    <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {showDate && (
                        <div style={{ textAlign: 'center', margin: '8px 0 4px' }}>
                          <span style={{
                            fontSize: 10.5, fontWeight: 500,
                            color: isDark ? '#9ca3af' : '#64748b',
                            background: isDark ? '#0d1511' : '#e2e8f0',
                            border: `1px solid ${isDark ? '#202d26' : '#cbd5e1'}`,
                            borderRadius: 20, padding: '3px 12px',
                            boxShadow: isDark ? '0 1px 3px rgba(0,0,0,0.3)' : '0 1px 2px rgba(0,0,0,0.05)',
                          }}>
                            {formatDateSeparator(msg.timestamp)}
                          </span>
                        </div>
                      )}

                      {msg.text !== '' && (
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                          <div style={{ maxWidth: '68%' }}>
                            <div style={{ fontSize: 10, color: isDark ? '#6b7280' : '#64748b', marginBottom: 2, textAlign: 'right', paddingRight: 4 }}>Customer</div>
                            <div style={{
                              background: isDark
                                ? `linear-gradient(135deg, ${NEON}, #3db854)`
                                : `linear-gradient(135deg, #10b981, #059669)`,
                              color: isDark ? '#000' : '#ffffff',
                              padding: msg.mediaType === 'image' && msg.mediaUrl ? '6px 6px 4px' : '8px 12px 5px',
                              fontSize: 13, lineHeight: 1.5,
                              borderRadius: '16px 16px 4px 16px',
                              boxShadow: isDark ? '0 0 12px rgba(92,228,109,0.25)' : '0 2px 8px rgba(16,185,129,0.25)',
                              fontWeight: 500, overflow: 'hidden',
                            }}>
                              {msg.mediaType === 'image' && msg.mediaUrl ? (
                                <a
                                  href={`https://drive.google.com/file/d/${msg.mediaUrl}/view`}
                                  target="_blank" rel="noreferrer"
                                >
                                  <img
                                    src={`https://drive.google.com/thumbnail?id=${msg.mediaUrl}&sz=w240`}
                                    alt="Payment screenshot"
                                    style={{ display: 'block', maxWidth: 240, maxHeight: 240, borderRadius: 11 }}
                                  />
                                </a>
                              ) : msg.mediaType === 'image' ? (
                                <span style={{ fontSize: 20 }}>📷</span>
                              ) : msg.text === '[image]' ? (
                                <span style={{ fontSize: 20 }}>📷</span>
                              ) : (
                                <div>{msg.text}</div>
                              )}
                              <div style={{
                                fontSize: 9.5,
                                color: isDark ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.85)',
                                textAlign: 'right',
                                marginTop: 3,
                                fontWeight: 500,
                              }}>
                                {formatMessageTime(msg.timestamp)}
                              </div>
                            </div>
                          </div>
                          <div style={{
                            width: 30, height: 30, borderRadius: '50%', flexShrink: 0, alignSelf: 'flex-end',
                            background: `hsla(${hueFromPhone(active.phone)},45%,${isDark ? '18%' : '90%'},1)`,
                            border: `1.5px solid ${isDark ? NEON : '#10b981'}`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 11, fontWeight: 700, color: isDark ? NEON : '#059669',
                          }}>
                            {phoneInitials(active.phone)}
                          </div>
                        </div>
                      )}

                      {(msg.reply !== '' || msg.text === '') && (
                        <div style={{ display: 'flex', gap: 8 }}>
                          <div style={{
                            width: 30, height: 30, borderRadius: '50%', flexShrink: 0, alignSelf: 'flex-end',
                            background: isDark ? '#1a251f' : '#ecfdf5',
                            border: `1.5px solid ${isDark ? NEON : '#10b981'}`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13,
                          }}>🤖</div>
                          <div style={{ maxWidth: '68%' }}>
                            <div style={{ fontSize: 10, color: isDark ? '#6b7280' : '#64748b', marginBottom: 2, paddingLeft: 4 }}>
                              {msg.text === '' ? 'You (Admin)' : 'DataCrumbs AI'}
                            </div>
                            {msg.mediaType === 'document' && (
                              <div style={{
                                display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 6,
                                background: isDark ? 'rgba(92,228,109,0.08)' : '#ecfdf5',
                                border: `1px solid ${isDark ? 'rgba(92,228,109,0.3)' : '#a7f3d0'}`,
                                borderRadius: 8, padding: '5px 10px', fontSize: 12,
                                color: isDark ? NEON : '#059669',
                              }}>
                                📄 Brochure sent
                              </div>
                            )}
                            <div style={{
                              background: msg.text === ''
                                ? (isDark ? 'linear-gradient(135deg, #1a3020, #0e1f14)' : '#ecfdf5')
                                : (isDark ? 'linear-gradient(180deg, rgba(20,29,25,0.9) 0%, rgba(13,20,17,1) 100%)' : '#ffffff'),
                              border: msg.text === ''
                                ? `1px solid ${isDark ? NEON : '#10b981'}`
                                : `1px solid ${isDark ? BORDER : '#e2e8f0'}`,
                              color: msg.text === '' ? (isDark ? '#e5e7eb' : '#064e3b') : (isDark ? '#e5e7eb' : '#1e293b'),
                              padding: '8px 12px 5px', fontSize: 13, lineHeight: 1.55,
                              borderRadius: '16px 16px 16px 4px',
                              boxShadow: msg.text === ''
                                ? (isDark ? `0 0 10px rgba(92,228,109,0.15)` : '0 1px 3px rgba(16,185,129,0.1)')
                                : (isDark ? 'none' : '0 1px 4px rgba(0,0,0,0.06)'),
                              whiteSpace: 'pre-wrap',
                            }}>
                              <div>{msg.reply}</div>
                              <div style={{
                                fontSize: 9.5,
                                color: isDark ? '#6b7280' : '#94a3b8',
                                textAlign: 'right',
                                marginTop: 3,
                                display: 'flex',
                                justifyContent: 'flex-end',
                                alignItems: 'center',
                                gap: 3,
                              }}>
                                <span>{formatMessageTime(msg.timestamp)}</span>
                                {msg.text === '' && (
                                  <span style={{ fontSize: 10, color: isDark ? NEON : '#10b981', fontWeight: 700 }}>✓✓</span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
              <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div style={{
              background: isDark ? GLASS : '#ffffff',
              borderTop: `1px solid ${isDark ? BORDER : '#e2e8f0'}`,
              padding: '10px 20px 14px',
            }}>
              {/* Quick-reply templates — click to load into message box */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 9 }}>
                {QUICK_ACTIONS.map(action => (
                  <button
                    key={action.label}
                    onClick={() => handleQuickAction(action)}
                    title={`Load "${action.label}" template into message box`}
                    style={{
                      fontSize: 11.5, fontWeight: 500,
                      padding: '5px 12px', borderRadius: 20,
                      background: isDark ? 'rgba(92,228,109,0.08)' : '#ecfdf5',
                      border: `1px solid ${isDark ? 'rgba(92,228,109,0.25)' : '#a7f3d0'}`,
                      color: isDark ? NEON : '#059669',
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
              {attachBrochure && (
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  background: isDark ? 'rgba(92,228,109,0.12)' : '#ecfdf5',
                  border: `1px solid ${isDark ? 'rgba(92,228,109,0.35)' : '#a7f3d0'}`,
                  borderRadius: 8, padding: '4px 10px', fontSize: 11.5,
                  color: isDark ? NEON : '#059669', marginBottom: 7,
                }}>
                  <span>📄 Attached: Bootcamp Brochure PDF (sent with message)</span>
                  <button
                    onClick={() => setAttachBrochure(false)}
                    title="Remove PDF attachment"
                    style={{
                      background: 'transparent', border: 'none', color: isDark ? '#9ca3af' : '#64748b',
                      cursor: 'pointer', fontSize: 13, padding: '0 2px', lineHeight: 1, fontWeight: 700,
                    }}
                  >
                    ✕
                  </button>
                </div>
              )}
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                fontSize: 11, color: isDark ? '#6b7280' : '#64748b', marginBottom: 6,
              }}>
                <div>
                  Send as admin to <strong style={{ color: isDark ? '#9ca3af' : '#334155' }}>+{active.phone}</strong>
                </div>
                <div style={{ fontSize: 10.5, color: isDark ? '#6b7280' : '#94a3b8' }}>
                  <kbd style={{ fontFamily: 'inherit', background: isDark ? '#141d19' : '#e2e8f0', padding: '1px 5px', borderRadius: 4, border: `1px solid ${isDark ? BORDER : '#cbd5e1'}` }}>Enter</kbd> to send • <kbd style={{ fontFamily: 'inherit', background: isDark ? '#141d19' : '#e2e8f0', padding: '1px 5px', borderRadius: 4, border: `1px solid ${isDark ? BORDER : '#cbd5e1'}` }}>Shift + Enter</kbd> for new line
                </div>
              </div>
              <div style={{
                display: 'flex', alignItems: 'flex-end', gap: 8,
                background: isDark ? '#0a0f0d' : '#f8fafc',
                borderRadius: 20,
                padding: '6px 8px 6px 14px',
                border: `1.5px solid ${isDark ? BORDER : '#cbd5e1'}`,
              }}>
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      if (e.shiftKey || e.ctrlKey || e.metaKey) {
                        // Allow line break. If Ctrl/Cmd is used without Shift, manually insert \n
                        if (!e.shiftKey) {
                          e.preventDefault();
                          const target = e.currentTarget;
                          const start = target.selectionStart;
                          const end = target.selectionEnd;
                          const val = target.value;
                          const newVal = val.substring(0, start) + '\n' + val.substring(end);
                          setInput(newVal);
                          requestAnimationFrame(() => {
                            target.selectionStart = target.selectionEnd = start + 1;
                          });
                        }
                        return;
                      }
                      // Plain Enter: send message immediately
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="Type a message… (Enter to send, Shift + Enter for new line)"
                  disabled={sending}
                  rows={1}
                  style={{
                    flex: 1, border: 'none', outline: 'none',
                    background: 'transparent', fontSize: 13.5,
                    lineHeight: 1.45,
                    color: isDark ? '#e5e7eb' : '#0f172a', fontFamily: 'inherit',
                    resize: 'none',
                    minHeight: 22,
                    maxHeight: 140,
                    overflowY: 'auto',
                    padding: '4px 0',
                    margin: 0,
                    whiteSpace: 'pre-wrap',
                  }}
                />
                <div style={{ position: 'relative', marginBottom: 2 }} ref={emojiRef}>
                  <button
                    onClick={() => setShowEmoji(v => !v)}
                    title="Emoji"
                    style={{
                      width: 30, height: 30, borderRadius: '50%', border: 'none',
                      background: 'transparent', color: isDark ? '#9ca3af' : '#64748b',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer', flexShrink: 0, fontSize: 17,
                    }}
                  >
                    🙂
                  </button>
                  {showEmoji && (
                    <div style={{
                      position: 'absolute', bottom: 40, right: 0, zIndex: 20,
                      width: 200,
                      background: isDark ? '#0d1511' : '#ffffff',
                      border: `1px solid ${isDark ? BORDER : '#e2e8f0'}`,
                      borderRadius: 10, padding: 10,
                      boxShadow: isDark ? '0 8px 24px rgba(0,0,0,0.5)' : '0 10px 25px -5px rgba(0,0,0,0.1)',
                      display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 4,
                    }}>
                      {EMOJI_PICKS.map(emo => (
                        <button
                          key={emo}
                          onClick={() => { setInput(prev => prev + emo); setShowEmoji(false); inputRef.current?.focus(); }}
                          style={{
                            fontSize: 18, background: 'transparent', border: 'none',
                            cursor: 'pointer', padding: 4, borderRadius: 6,
                          }}
                        >
                          {emo}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  onClick={handleSend}
                  disabled={sending || !input.trim()}
                  style={{
                    width: 36, height: 36, borderRadius: '50%', border: 'none',
                    background: sending || !input.trim()
                      ? (isDark ? '#1a251f' : '#e2e8f0')
                      : (isDark ? NEON : '#10b981'),
                    cursor: sending || !input.trim() ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    boxShadow: sending || !input.trim()
                      ? 'none'
                      : (isDark ? `0 0 14px rgba(92,228,109,0.45)` : '0 2px 8px rgba(16,185,129,0.35)'),
                    transition: 'all 0.15s',
                  }}
                >
                  {sending ? (
                    <div style={{
                      width: 14, height: 14,
                      border: '2px solid rgba(255,255,255,0.2)',
                      borderTop: `2px solid ${isDark ? NEON : '#10b981'}`,
                      borderRadius: '50%', animation: 'spin 0.7s linear infinite',
                    }} />
                  ) : (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill={sending || !input.trim() ? '#6b7280' : (isDark ? '#000' : '#fff')}>
                      <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </>
        ) : (
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 12,
            background: isDark ? BG : '#f8fafc',
          }}>
            <div style={{
              width: 64, height: 64, borderRadius: '50%',
              background: isDark ? '#0d1511' : '#ffffff',
              border: `1px solid ${isDark ? BORDER : '#e2e8f0'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28,
              boxShadow: isDark ? 'none' : '0 2px 8px rgba(0,0,0,0.05)',
            }}>💬</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: isDark ? '#d1d5db' : '#0f172a' }}>No conversation selected</div>
            <div style={{ fontSize: 13, color: isDark ? '#6b7280' : '#64748b' }}>Pick a contact from the list</div>
          </div>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
