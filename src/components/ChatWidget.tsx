'use client';

import { useState, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

interface Message {
  role: 'user' | 'bot';
  content: string;
  time: string;
}

interface HistoryMessage {
  role: 'user' | 'model';
  parts: { text: string }[];
}

const STORAGE_KEY = 'dc_chat_history';
const THEME_KEY = 'dc_widget_theme';
const GREEN = '#2AAA8A';

export default function ChatWidget() {
  const pathname                = usePathname();
  const [open, setOpen]         = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [theme, setTheme]       = useState<'light' | 'dark'>('light');
  const bottomRef               = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) setMessages(JSON.parse(saved));
    const savedTheme = localStorage.getItem(THEME_KEY);
    if (savedTheme === 'light' || savedTheme === 'dark') {
      setTheme(savedTheme);
    }
  }, []);

  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    localStorage.setItem(THEME_KEY, next);
  };

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Hidden on the Chats dashboard tab — the real WhatsApp conversation view
  // already lives there, and the floating widget just clutters it
  if (pathname === '/chats') return null;

  function getTime() {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function formatMessage(text: string) {
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, `<a href="$2" target="_blank" style="color:${GREEN};font-weight:600;text-decoration:underline;">$1</a>`)
      .replace(/\n/g, '<br>');
  }

  function buildHistory(): HistoryMessage[] {
    return messages.map(m => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content }],
    }));
  }

  async function sendMessage(overrideText?: string) {
    const text = (overrideText ?? input).trim();
    if (!text || loading) return;

    const userMsg: Message = { role: 'user', content: text, time: getTime() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history: buildHistory() }),
      });
      const data = await res.json();
      setMessages(prev => [...prev, {
        role: 'bot',
        content: data.reply || 'Sorry, something went wrong.',
        time: getTime(),
      }]);
    } catch {
      setMessages(prev => [...prev, {
        role: 'bot',
        content: 'Connection error. Please try again.',
        time: getTime(),
      }]);
    } finally {
      setLoading(false);
    }
  }

  const isEmpty = messages.length === 0;

  return (
    <>
      {/* Floating launcher button */}
      <button
        onClick={() => setOpen(o => !o)}
        aria-label="Open chat"
        style={{
          position: 'fixed', bottom: 24, right: 24,
          width: 60, height: 60, borderRadius: '50%',
          background: `linear-gradient(135deg, ${GREEN}, #1e8a6e)`,
          border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 6px 24px rgba(42,170,138,0.50)',
          zIndex: 9999, transition: 'transform 0.2s, box-shadow 0.2s',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.transform = 'scale(1.08)';
          e.currentTarget.style.boxShadow = '0 8px 28px rgba(42,170,138,0.60)';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.transform = 'scale(1)';
          e.currentTarget.style.boxShadow = '0 6px 24px rgba(42,170,138,0.50)';
        }}
      >
        {open ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
            stroke="white" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        ) : (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
            <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
          </svg>
        )}
      </button>

      {/* Chat panel */}
      {open && (
        <div style={{
          position: 'fixed', bottom: 96, right: 24,
          width: 370, height: 540,
          background: theme === 'dark' ? '#0f1715' : '#ffffff',
          borderRadius: 20,
          boxShadow: theme === 'dark' ? '0 12px 48px rgba(0,0,0,0.5)' : '0 12px 48px rgba(0,0,0,0.18)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          zIndex: 9998,
          border: theme === 'dark' ? '1px solid #1a2a24' : 'none',
          animation: 'slideUp 0.22s cubic-bezier(0.16,1,0.3,1)',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        }}>

          {/* ── Header ── */}
          <div style={{
            background: `linear-gradient(135deg, #1e8a6e 0%, ${GREEN} 60%, #35c9a1 100%)`,
            padding: '18px 16px 14px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
              {/* Avatar */}
              <div style={{
                width: 44, height: 44, borderRadius: '50%',
                background: 'rgba(255,255,255,0.2)',
                border: '2.5px solid rgba(255,255,255,0.6)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 20, flexShrink: 0,
              }}>
                🤖
              </div>

              {/* Name + subtitle */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  color: '#fff', fontWeight: 700, fontSize: 15,
                  letterSpacing: '-0.2px', lineHeight: 1.2,
                }}>
                  DataCrumbs AI
                </div>
                <div style={{ color: 'rgba(255,255,255,0.80)', fontSize: 11.5, marginTop: 2 }}>
                  AI &amp; Data Science Bootcamp
                </div>
              </div>

              {/* Header actions */}
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <button
                  onClick={toggleTheme}
                  title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
                  style={{
                    background: 'rgba(255,255,255,0.15)', border: 'none',
                    color: '#fff', cursor: 'pointer', borderRadius: 6,
                    padding: '4px 8px', fontSize: 12, fontFamily: 'inherit',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.25)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.15)'}
                >
                  {theme === 'light' ? '🌙' : '☀️'}
                </button>
                <button
                  onClick={() => setMessages([])}
                  title="Clear chat"
                  style={{
                    background: 'rgba(255,255,255,0.15)', border: 'none',
                    color: '#fff', cursor: 'pointer', borderRadius: 6,
                    padding: '4px 8px', fontSize: 11, fontFamily: 'inherit',
                  }}
                >
                  Clear
                </button>
                <button
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  style={{
                    background: 'rgba(255,255,255,0.15)', border: 'none',
                    color: '#fff', cursor: 'pointer', borderRadius: 6,
                    width: 28, height: 28, display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                    stroke="white" strokeWidth="2.5" strokeLinecap="round">
                    <polyline points="18 15 12 9 6 15"/>
                  </svg>
                </button>
              </div>
            </div>
          </div>

          {/* ── Online status strip ── */}
          <div style={{
            background: theme === 'dark' ? '#131e1a' : '#f8fffe',
            borderBottom: `1px solid ${theme === 'dark' ? '#1a2a24' : '#e8f5f1'}`,
            padding: '7px 16px',
            display: 'flex', alignItems: 'center', gap: 7,
          }}>
            <div style={{
              width: 8, height: 8, borderRadius: '50%',
              background: '#22c55e',
              boxShadow: '0 0 0 2px rgba(34,197,94,0.25)',
            }}/>
            <span style={{ fontSize: 12, color: theme === 'dark' ? '#9ca3af' : '#374151', fontWeight: 500 }}>
              We are online!
            </span>
          </div>

          {/* ── Messages ── */}
          <div style={{
            flex: 1, overflowY: 'auto', padding: '14px 12px',
            display: 'flex', flexDirection: 'column', gap: 10,
            background: theme === 'dark' ? '#090d0b' : '#f7f8fa',
          }}>

            {/* Always-visible greeting */}
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%',
                background: GREEN, display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                fontSize: 13, flexShrink: 0,
              }}>🤖</div>
              <div>
                <div style={{
                  background: theme === 'dark' ? '#141d19' : '#ffffff',
                  borderRadius: '16px 16px 16px 4px',
                  padding: '10px 14px', fontSize: 13, lineHeight: 1.55,
                  color: theme === 'dark' ? '#e5e7eb' : '#1f2937',
                  border: theme === 'dark' ? '1px solid #202d26' : 'none',
                  maxWidth: 260,
                  boxShadow: theme === 'dark' ? '0 1px 4px rgba(0,0,0,0.3)' : '0 1px 4px rgba(0,0,0,0.07)',
                }}>
                  👋 Hi! Would you like to know more about our <strong>AI &amp; Data Science Bootcamp</strong>?
                </div>
                <div style={{ fontSize: 10, color: theme === 'dark' ? '#6b7280' : '#9ca3af', marginTop: 4, paddingLeft: 4 }}>
                  DataCrumbs AI
                </div>
              </div>
            </div>

            {/* Quick action chips (only when no messages yet) */}
            {isEmpty && (
              <div style={{ paddingLeft: 36, display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: -2 }}>
                {['Course details', 'Pricing', 'Get Brochure'].map(q => (
                  <button
                    key={q}
                    onClick={() => sendMessage(q)}
                    style={{
                      background: theme === 'dark' ? 'rgba(42,170,138,0.12)' : '#fff',
                      border: `1.5px solid ${GREEN}`,
                      color: theme === 'dark' ? '#5ce46d' : GREEN,
                      borderRadius: 20,
                      padding: '6px 14px', fontSize: 12, fontWeight: 500,
                      cursor: 'pointer', fontFamily: 'inherit',
                      transition: 'background 0.15s, color 0.15s',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = GREEN;
                      e.currentTarget.style.color = '#fff';
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = theme === 'dark' ? 'rgba(42,170,138,0.12)' : '#fff';
                      e.currentTarget.style.color = theme === 'dark' ? '#5ce46d' : GREEN;
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}

            {/* Conversation messages */}
            {messages.map((msg, i) => (
              <div key={i} style={{
                display: 'flex',
                flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                alignItems: 'flex-end', gap: 8,
              }}>
                {msg.role === 'bot' && (
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%',
                    background: GREEN, display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                    fontSize: 13, flexShrink: 0,
                  }}>🤖</div>
                )}

                <div style={{ maxWidth: 260 }}>
                  <div
                    style={{
                      background: msg.role === 'user'
                        ? `linear-gradient(135deg, ${GREEN}, #1e8a6e)`
                        : theme === 'dark' ? '#141d19' : '#ffffff',
                      color: msg.role === 'user' ? '#fff' : (theme === 'dark' ? '#e5e7eb' : '#1f2937'),
                      border: msg.role === 'bot' && theme === 'dark' ? '1px solid #202d26' : 'none',
                      padding: '10px 14px', fontSize: 13, lineHeight: 1.55,
                      borderRadius: msg.role === 'user'
                        ? '16px 16px 4px 16px'
                        : '16px 16px 16px 4px',
                      boxShadow: msg.role === 'bot'
                        ? (theme === 'dark' ? '0 1px 4px rgba(0,0,0,0.3)' : '0 1px 4px rgba(0,0,0,0.07)') : 'none',
                    }}
                    dangerouslySetInnerHTML={{ __html: formatMessage(msg.content) }}
                  />
                  <div style={{
                    fontSize: 10, color: theme === 'dark' ? '#6b7280' : '#9ca3af', marginTop: 3,
                    textAlign: msg.role === 'user' ? 'right' : 'left',
                    paddingLeft: msg.role === 'bot' ? 4 : 0,
                    paddingRight: msg.role === 'user' ? 4 : 0,
                  }}>
                    {msg.time}
                  </div>
                </div>
              </div>
            ))}

            {/* Typing indicator */}
            {loading && (
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: '50%',
                  background: GREEN, display: 'flex',
                  alignItems: 'center', justifyContent: 'center', fontSize: 13,
                }}>🤖</div>
                <div style={{
                  background: theme === 'dark' ? '#141d19' : '#ffffff',
                  borderRadius: '16px 16px 16px 4px',
                  border: theme === 'dark' ? '1px solid #202d26' : 'none',
                  padding: '12px 16px',
                  boxShadow: theme === 'dark' ? '0 1px 4px rgba(0,0,0,0.3)' : '0 1px 4px rgba(0,0,0,0.07)',
                }}>
                  <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                    {[0, 1, 2].map(i => (
                      <div key={i} style={{
                        width: 7, height: 7, borderRadius: '50%',
                        background: theme === 'dark' ? '#4b5563' : '#d1d5db',
                        animation: `bounce 1.2s infinite ${i * 0.18}s`,
                      }} />
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* ── Input area ── */}
          <div style={{
            background: theme === 'dark' ? '#0f1715' : '#ffffff',
            borderTop: `1px solid ${theme === 'dark' ? '#1a2a24' : '#f0f0f0'}`,
            padding: '10px 12px 12px',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: theme === 'dark' ? '#141d19' : '#f3f4f6',
              borderRadius: 24,
              padding: '6px 6px 6px 16px',
              border: `1.5px solid ${theme === 'dark' ? '#202d26' : 'transparent'}`,
              transition: 'border-color 0.2s',
            }}
              onFocus={() => {}}
            >
              <input
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                placeholder="Enter your message..."
                disabled={loading}
                style={{
                  flex: 1, border: 'none', outline: 'none',
                  background: 'transparent', fontSize: 13,
                  color: theme === 'dark' ? '#e5e7eb' : '#1f2937', fontFamily: 'inherit',
                }}
              />
              <button
                onClick={() => sendMessage()}
                disabled={loading || !input.trim()}
                style={{
                  width: 36, height: 36, borderRadius: '50%', border: 'none',
                  background: loading || !input.trim()
                    ? (theme === 'dark' ? '#374151' : '#d1d5db')
                    : `linear-gradient(135deg, ${GREEN}, #1e8a6e)`,
                  cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0, transition: 'background 0.2s',
                  boxShadow: loading || !input.trim()
                    ? 'none' : '0 2px 8px rgba(42,170,138,0.40)',
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
                </svg>
              </button>
            </div>

            {/* Branding */}
            <div style={{
              textAlign: 'center', marginTop: 8,
              fontSize: 10.5, color: theme === 'dark' ? '#6b7280' : '#9ca3af', letterSpacing: '0.3px',
            }}>
              POWERED BY{' '}
              <span style={{ color: GREEN, fontWeight: 600 }}>DataCrumbs</span>
            </div>
          </div>

        </div>
      )}

      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(16px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes bounce {
          0%, 60%, 100% { transform: translateY(0); }
          30%  { transform: translateY(-5px); }
        }
      `}</style>
    </>
  );
}
