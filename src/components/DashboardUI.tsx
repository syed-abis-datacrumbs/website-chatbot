'use client';

import { useState, useRef, useEffect } from 'react';
import { ChatMessage } from '@/lib/redis';

const GREEN = '#2AAA8A';

interface Contact {
  phone: string;
  messages: ChatMessage[];
  lastMessage: ChatMessage;
}

function formatTime(ts: number) {
  const now  = Date.now();
  const diff = now - ts;
  const mins = Math.floor(diff / 60000);
  const hrs  = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hrs  < 24) return `${hrs}h ago`;
  if (days <  7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString('en-PK', { day: 'numeric', month: 'short' });
}

function formatFull(ts: number) {
  return new Date(ts).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' });
}

function phoneInitials(phone: string) { return phone.slice(-2); }

function hueFromPhone(phone: string) {
  let h = 0;
  for (const c of phone) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return [160, 200, 240, 280, 320, 20, 40][h % 7];
}

export default function DashboardUI({
  contacts: initial,
  total,
  systemPrompt: initialPrompt,
}: {
  contacts: Contact[];
  total: number;
  systemPrompt: string;
}) {
  const [tab, setTab]           = useState<'chats' | 'prompt'>('chats');
  const [contacts, setContacts] = useState<Contact[]>(initial);
  const [selected, setSelected] = useState<string | null>(initial[0]?.phone ?? null);
  const [input, setInput]       = useState('');
  const [sending, setSending]   = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'instant' });
    inputRef.current?.focus();
  }, [selected]);
  const [prompt, setPrompt]     = useState(initialPrompt);
  const [promptSaving, setPromptSaving] = useState(false);
  const [promptSaved, setPromptSaved]   = useState(false);

  const active = contacts.find(c => c.phone === selected) ?? null;
  const hue    = active ? hueFromPhone(active.phone) : 160;

  async function savePrompt() {
    if (promptSaving) return;
    setPromptSaving(true);
    try {
      await fetch('/api/system-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      setPromptSaved(true);
      setTimeout(() => setPromptSaved(false), 3000);
    } finally {
      setPromptSaving(false);
    }
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || !selected || sending) return;
    setSending(true);
    setInput('');

    // Optimistic update
    const optimistic: ChatMessage = { from: selected, text: '', reply: text, timestamp: Date.now() };
    setContacts(prev => prev.map(c =>
      c.phone === selected
        ? { ...c, messages: [optimistic, ...c.messages], lastMessage: optimistic }
        : c
    ));

    try {
      await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: selected, message: text }),
      });
    } catch {
      // message already shown optimistically; silently fail
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={{
      display: 'flex', height: '100vh', overflow: 'hidden',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      background: '#f7f8fa',
    }}>

      {/* ── Sidebar ── */}
      <div style={{
        width: 300, flexShrink: 0,
        display: 'flex', flexDirection: 'column',
        background: '#ffffff', borderRight: '1px solid #eef0f3',
      }}>

        {/* Sidebar header */}
        <div style={{
          background: `linear-gradient(135deg, #1e8a6e 0%, ${GREEN} 60%, #35c9a1 100%)`,
          padding: '20px 18px 16px',
          position: 'relative',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <div style={{
              width: 36, height: 36, borderRadius: '50%',
              background: '#ffffff',
              border: '2px solid rgba(255,255,255,0.8)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              overflow: 'hidden', padding: 5, flexShrink: 0,
            }}>
              <img src="/logo-icon.png" alt="DataCrumbs" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            </div>
            <div>
              <div style={{ color: '#fff', fontWeight: 700, fontSize: 14, lineHeight: 1.2 }}>DataCrumbs</div>
              <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: 11 }}>WhatsApp Inbox</div>
            </div>
          </div>
          <div style={{
            background: 'rgba(255,255,255,0.15)', borderRadius: 8,
            padding: '6px 10px', display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#86efac' }} />
            <span style={{ color: '#fff', fontSize: 11.5, fontWeight: 500 }}>
              {contacts.length} contact{contacts.length !== 1 ? 's' : ''} · {total} message{total !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Logout */}
          <button
            onClick={async () => {
              await fetch('/api/auth/logout', { method: 'POST' });
              window.location.href = '/login';
            }}
            style={{
              position: 'absolute', top: 16, right: 16,
              background: 'rgba(255,255,255,0.15)', border: 'none',
              color: '#fff', cursor: 'pointer', borderRadius: 8,
              padding: '5px 10px', fontSize: 11.5, fontFamily: 'inherit',
            }}
          >
            Logout
          </button>

          {/* Tab switcher */}
          <div style={{
            display: 'flex', marginTop: 12, gap: 4,
            background: 'rgba(0,0,0,0.15)', borderRadius: 10, padding: 3,
          }}>
            {(['chats', 'prompt'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)} style={{
                flex: 1, border: 'none', cursor: 'pointer', borderRadius: 8,
                padding: '6px 0', fontSize: 12, fontWeight: 600,
                background: tab === t ? '#fff' : 'transparent',
                color: tab === t ? GREEN : 'rgba(255,255,255,0.75)',
                transition: 'all 0.15s', fontFamily: 'inherit',
              }}>
                {t === 'chats' ? '💬 Chats' : '⚙️ Prompt'}
              </button>
            ))}
          </div>
        </div>

        {/* Contact list — only visible on chats tab */}
        <div style={{ flex: 1, overflowY: 'auto', display: tab === 'prompt' ? 'none' : 'block' }}>
          {contacts.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
              No conversations yet
            </div>
          ) : contacts.map(c => {
            const isActive = c.phone === selected;
            const h = hueFromPhone(c.phone);
            return (
              <button
                key={c.phone}
                onClick={() => setSelected(c.phone)}
                style={{
                  width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer',
                  padding: '13px 16px',
                  background: isActive ? '#f0faf7' : 'transparent',
                  borderLeft: isActive ? `3px solid ${GREEN}` : '3px solid transparent',
                  display: 'flex', alignItems: 'center', gap: 11,
                  transition: 'background 0.15s',
                  borderBottom: '1px solid #f3f4f6',
                }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = '#f9fafb'; }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
              >
                <div style={{
                  width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
                  background: `hsl(${h},55%,90%)`,
                  border: `2px solid hsl(${h},55%,80%)`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 700, color: `hsl(${h},45%,38%)`,
                }}>
                  {phoneInitials(c.phone)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <span style={{ fontWeight: 600, fontSize: 13, color: isActive ? '#0a0a0a' : '#374151' }}>
                      +{c.phone}
                    </span>
                    <span style={{ fontSize: 10.5, color: '#9ca3af', flexShrink: 0, marginLeft: 6 }}>
                      {formatTime(c.lastMessage.timestamp)}
                    </span>
                  </div>
                  <div style={{
                    fontSize: 12, color: '#6b7280', marginTop: 2,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {c.lastMessage.text || c.lastMessage.reply}
                  </div>
                  <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                    {c.messages.length} exchange{c.messages.length !== 1 ? 's' : ''}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Main area ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* System Prompt editor */}
        {tab === 'prompt' && (
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            padding: '32px 40px', background: '#f7f8fa', overflow: 'auto',
          }}>
            <div style={{ maxWidth: 760, width: '100%', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>

              {/* Header */}
              <div>
                <h2 style={{ fontSize: 20, fontWeight: 700, color: '#0a0a0a', margin: 0 }}>
                  System Prompt
                </h2>
                <p style={{ fontSize: 13, color: '#6b7280', marginTop: 6 }}>
                  This is the instruction the AI follows for every conversation. Edit it and click Save — the change takes effect immediately on both the website chat and WhatsApp.
                </p>
              </div>

              {/* Textarea */}
              <textarea
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                rows={22}
                style={{
                  width: '100%', padding: '16px', fontSize: 13.5,
                  lineHeight: 1.65, fontFamily: '"SF Mono", "Fira Code", monospace',
                  color: '#1f2937', background: '#ffffff',
                  border: '1.5px solid #e5e7eb', borderRadius: 12,
                  outline: 'none', resize: 'vertical',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
                  boxSizing: 'border-box',
                }}
                onFocus={e => { e.currentTarget.style.borderColor = GREEN; }}
                onBlur={e => { e.currentTarget.style.borderColor = '#e5e7eb'; }}
              />

              {/* Actions */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <button
                  onClick={savePrompt}
                  disabled={promptSaving}
                  style={{
                    padding: '10px 28px', borderRadius: 10, border: 'none',
                    background: promptSaving ? '#d1d5db' : `linear-gradient(135deg, ${GREEN}, #1e8a6e)`,
                    color: '#fff', fontWeight: 600, fontSize: 14,
                    cursor: promptSaving ? 'not-allowed' : 'pointer',
                    fontFamily: 'inherit',
                    boxShadow: promptSaving ? 'none' : '0 2px 8px rgba(42,170,138,0.35)',
                    transition: 'all 0.2s',
                  }}
                >
                  {promptSaving ? 'Saving…' : 'Save Prompt'}
                </button>

                {promptSaved && (
                  <span style={{ fontSize: 13, color: GREEN, fontWeight: 500 }}>
                    ✓ Saved! Chatbot is now using the updated prompt.
                  </span>
                )}
              </div>

              {/* Info note */}
              <div style={{
                background: '#f0faf7', border: `1px solid #c6f0e4`,
                borderRadius: 10, padding: '12px 16px',
                fontSize: 12.5, color: '#374151', lineHeight: 1.6,
              }}>
                <strong style={{ color: GREEN }}>Tip:</strong> The <code>## RELEVANT KNOWLEDGE</code> section is appended automatically by RAG — you don&apos;t need to include it here. Just focus on tone, rules, and persona.
              </div>
            </div>
          </div>
        )}

        {tab === 'chats' && active ? (
          <>
            {/* Chat header */}
            <div style={{
              background: '#fff', borderBottom: '1px solid #eef0f3',
              padding: '14px 24px',
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <div style={{
                width: 40, height: 40, borderRadius: '50%',
                background: `hsl(${hue},55%,90%)`,
                border: `2px solid hsl(${hue},55%,80%)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, fontWeight: 700, color: `hsl(${hue},45%,38%)`,
              }}>
                {phoneInitials(active.phone)}
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15, color: '#0a0a0a' }}>+{active.phone}</div>
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 1 }}>
                  {active.messages.length} exchange{active.messages.length !== 1 ? 's' : ''}
                </div>
              </div>
              <div style={{ marginLeft: 'auto', fontSize: 12, color: '#9ca3af' }}>
                First contact: {formatFull(active.messages[active.messages.length - 1]?.timestamp ?? Date.now())}
              </div>
            </div>

            {/* Messages thread */}
            <div style={{
              flex: 1, overflowY: 'auto',
              padding: '24px 32px',
              display: 'flex', flexDirection: 'column', gap: 20,
              background: '#f7f8fa',
            }}>
              {[...active.messages].reverse().map((msg, i) => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

                  {/* Timestamp separator */}
                  <div style={{ textAlign: 'center' }}>
                    <span style={{
                      fontSize: 11, color: '#9ca3af',
                      background: '#eef0f3', borderRadius: 20, padding: '3px 10px',
                    }}>
                      {formatFull(msg.timestamp)}
                    </span>
                  </div>

                  {/* Customer message — skip if admin-initiated */}
                  {msg.text !== '' && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                      <div style={{ maxWidth: '65%' }}>
                        <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 4, textAlign: 'right', paddingRight: 4 }}>
                          Customer
                        </div>
                        <div style={{
                          background: `linear-gradient(135deg, ${GREEN}, #1e8a6e)`,
                          color: '#fff', padding: '10px 14px', fontSize: 13.5, lineHeight: 1.55,
                          borderRadius: '16px 16px 4px 16px',
                          boxShadow: '0 2px 8px rgba(42,170,138,0.20)',
                        }}>
                          {msg.text}
                        </div>
                      </div>
                      <div style={{
                        width: 34, height: 34, borderRadius: '50%', flexShrink: 0, alignSelf: 'flex-end',
                        background: `hsl(${hue},55%,90%)`,
                        border: `2px solid hsl(${hue},55%,80%)`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, fontWeight: 700, color: `hsl(${hue},45%,38%)`,
                      }}>
                        {phoneInitials(active.phone)}
                      </div>
                    </div>
                  )}

                  {/* Bot / admin reply */}
                  <div style={{ display: 'flex', gap: 10 }}>
                    <div style={{
                      width: 34, height: 34, borderRadius: '50%', flexShrink: 0, alignSelf: 'flex-end',
                      background: '#ffffff',
                      border: '1.5px solid #e5e7eb',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      overflow: 'hidden', padding: 5,
                      boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                    }}>
                      <img src="/logo-icon.png" alt="DataCrumbs" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                    </div>
                    <div style={{ maxWidth: '65%' }}>
                      <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 4, paddingLeft: 4 }}>
                        {msg.text === '' ? 'You (Admin)' : 'DataCrumbs AI'}
                      </div>
                      <div style={{
                        background: msg.text === '' ? '#f0faf7' : '#ffffff',
                        border: msg.text === '' ? `1.5px solid ${GREEN}` : 'none',
                        color: '#1f2937', padding: '10px 14px', fontSize: 13.5, lineHeight: 1.6,
                        borderRadius: '16px 16px 16px 4px',
                        boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
                        whiteSpace: 'pre-wrap',
                      }}>
                        {msg.reply}
                      </div>
                    </div>
                  </div>

                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            {/* ── Send message input ── */}
            <div style={{
              background: '#ffffff', borderTop: '1px solid #eef0f3',
              padding: '12px 24px 16px',
            }}>
              <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 8 }}>
                Send as admin to <strong style={{ color: '#374151' }}>+{active.phone}</strong>
              </div>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                background: '#f7f8fa', borderRadius: 28,
                padding: '6px 6px 6px 18px',
                border: '1.5px solid #e5e7eb',
              }}>
                <input
                  type="text"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
                  ref={inputRef}
                  placeholder="Type a message..."
                  disabled={sending}
                  style={{
                    flex: 1, border: 'none', outline: 'none',
                    background: 'transparent', fontSize: 13.5,
                    color: '#1f2937', fontFamily: 'inherit',
                  }}
                />
                <button
                  onClick={handleSend}
                  disabled={sending || !input.trim()}
                  style={{
                    width: 40, height: 40, borderRadius: '50%', border: 'none',
                    background: sending || !input.trim()
                      ? '#d1d5db'
                      : `linear-gradient(135deg, ${GREEN}, #1e8a6e)`,
                    cursor: sending || !input.trim() ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0, transition: 'background 0.2s',
                    boxShadow: sending || !input.trim() ? 'none' : '0 2px 8px rgba(42,170,138,0.35)',
                  }}
                >
                  {sending ? (
                    <div style={{
                      width: 16, height: 16, border: '2px solid rgba(255,255,255,0.4)',
                      borderTop: '2px solid #fff', borderRadius: '50%',
                      animation: 'spin 0.7s linear infinite',
                    }} />
                  ) : (
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="white">
                      <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </>
        ) : tab === 'chats' ? (
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 12,
          }}>
            <div style={{ fontSize: 48 }}>💬</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#374151' }}>No conversation selected</div>
            <div style={{ fontSize: 13, color: '#9ca3af' }}>Pick a contact from the sidebar to view the chat</div>
          </div>
        ) : null}
      </div>

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
