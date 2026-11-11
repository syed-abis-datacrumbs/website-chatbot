'use client';

import { useState, useRef } from 'react';
import { BotConfig } from '@/lib/redis';
import { useTheme } from '@/context/ThemeContext';
import ThemeToggle from './ThemeToggle';

const NEON = '#5ce46d';

function Label({ text, sub, textCol, textMuted }: { text: string; sub?: string; textCol?: string; textMuted?: string }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: textCol || '#d1d5db' }}>{text}</div>
      {sub && <div style={{ fontSize: 11, color: textMuted || '#6b7280', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export default function ConfigUI({
  initial,
  currentBrochure,
}: {
  initial: BotConfig;
  currentBrochure: { filename: string; uploadedAt: number } | null;
}) {
  const { isDark } = useTheme();
  const [cfg,         setCfg]         = useState<BotConfig>(initial);
  const [saving,      setSaving]      = useState(false);
  const [saved,       setSaved]       = useState(false);
  const [uploading,   setUploading]   = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const [confirmAll,  setConfirmAll]  = useState(false);
  const [uploadedName, setUploadedName] = useState<string | null>(currentBrochure?.filename ?? null);
  const [uploadedAt,  setUploadedAt]  = useState<number | null>(currentBrochure?.uploadedAt ?? null);
  const [uploadError, setUploadError] = useState('');

  const [f1, setF1] = useState(false);
  const [f2, setF2] = useState(false);
  const [f3, setF3] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const glassBg = isDark
    ? 'linear-gradient(180deg, rgba(20,29,25,0.8) 0%, rgba(13,20,17,0.9) 100%)'
    : '#ffffff';
  const borderCol = isDark ? '#202d26' : '#e2e8f0';
  const textCol = isDark ? '#ffffff' : '#0f172a';
  const textMuted = isDark ? '#9ca3af' : '#64748b';
  const labelCol = isDark ? '#d1d5db' : '#334155';

  const inputStyle = (focused: boolean): React.CSSProperties => ({
    width: '100%', height: 42, padding: '0 14px',
    border: `1.5px solid ${focused ? (isDark ? NEON : '#10b981') : borderCol}`,
    borderRadius: 8, fontSize: 13.5,
    color: textCol,
    background: isDark ? 'rgba(9,13,11,0.7)' : '#ffffff',
    outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
    boxShadow: focused ? `0 0 0 3px ${isDark ? 'rgba(92,228,109,0.1)' : 'rgba(16,185,129,0.1)'}` : (isDark ? 'none' : '0 1px 2px rgba(0,0,0,0.04)'),
    transition: 'border-color 0.15s, box-shadow 0.15s',
  });

  function update(key: keyof BotConfig, val: string) {
    setCfg(prev => ({ ...prev, [key]: val }));
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  }

  async function deleteAllChats() {
    if (!confirmAll) { setConfirmAll(true); return; }
    setDeletingAll(true);
    try {
      await fetch('/api/messages', { method: 'DELETE' });
      window.location.reload();
    } finally {
      setDeletingAll(false);
      setConfirmAll(false);
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== 'application/pdf') {
      setUploadError('Only PDF files are accepted');
      return;
    }
    setUploadError('');
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/brochure', { method: 'POST', body: fd });
      if (!res.ok) {
        const err = await res.json();
        setUploadError(err.error || 'Upload failed');
        return;
      }
      setUploadedName(file.name);
      setUploadedAt(Date.now());
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto' }}>
      <div style={{ padding: '32px 36px' }}>
        <div style={{ maxWidth: 640 }}>

          {/* Header */}
          <div style={{ marginBottom: 28, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <h1 style={{ fontSize: 28, fontWeight: 700, color: textCol, margin: 0 }}>Configuration</h1>
              <p style={{ fontSize: 13, color: textMuted, marginTop: 4 }}>
                Manage brochure, batch dates, and bot settings.
              </p>
            </div>
            <ThemeToggle />
          </div>

          {/* Card */}
          <div style={{
            background: glassBg, border: `1px solid ${borderCol}`,
            borderRadius: 16, padding: 28,
            boxShadow: isDark ? 'none' : '0 1px 3px rgba(0,0,0,0.05)',
            display: 'flex', flexDirection: 'column', gap: 24,
          }}>

            {/* Brochure */}
            <div>
              <Label
                text="Brochure PDF"
                sub="Uploaded PDF will be sent automatically to students who ask for it."
                textCol={labelCol}
                textMuted={textMuted}
              />

              {uploadedName ? (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  background: isDark ? 'rgba(92,228,109,0.05)' : '#ecfdf5',
                  border: `1px solid ${isDark ? 'rgba(92,228,109,0.2)' : '#a7f3d0'}`,
                  borderRadius: 8, padding: '10px 14px', marginBottom: 10,
                }}>
                  <span style={{ fontSize: 20 }}>📄</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: isDark ? '#fff' : '#065f46', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                      {uploadedName}
                    </div>
                    {uploadedAt && (
                      <div style={{ fontSize: 11, color: textMuted }}>
                        Uploaded {new Date(uploadedAt).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </div>
                    )}
                  </div>
                  <a
                    href="/api/brochure"
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      fontSize: 12, color: isDark ? NEON : '#059669', textDecoration: 'none',
                      fontWeight: 600, padding: '4px 8px', borderRadius: 6,
                      background: isDark ? 'rgba(92,228,109,0.1)' : '#d1fae5',
                    }}
                  >
                    View
                  </a>
                </div>
              ) : (
                <div style={{ fontSize: 12, color: textMuted, marginBottom: 10 }}>
                  No brochure uploaded yet.
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                onChange={handleFileUpload}
                style={{ display: 'none' }}
              />

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  padding: '9px 16px', borderRadius: 8,
                  background: isDark ? 'rgba(92,228,109,0.08)' : '#ecfdf5',
                  border: `1px solid ${isDark ? 'rgba(92,228,109,0.3)' : '#a7f3d0'}`,
                  color: isDark ? NEON : '#059669', fontSize: 13, fontWeight: 600,
                  cursor: uploading ? 'not-allowed' : 'pointer',
                  opacity: uploading ? 0.6 : 1,
                  transition: 'all 0.15s',
                }}
              >
                <span>📤</span>
                <span>{uploading ? 'Uploading…' : uploadedName ? 'Replace PDF Brochure' : 'Upload PDF Brochure'}</span>
              </button>

              {uploadError && (
                <div style={{ fontSize: 12, color: '#f87171', marginTop: 8 }}>
                  {uploadError}
                </div>
              )}
            </div>

            <div style={{ height: 1, background: isDark ? '#1a251f' : '#f1f5f9' }} />

            {/* Batch dates */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <Label text="Batch Start Date" textCol={labelCol} textMuted={textMuted} />
                <input
                  type="date"
                  value={cfg.batchStartDate}
                  onChange={e => update('batchStartDate', e.target.value)}
                  onFocus={() => setF1(true)}
                  onBlur={() => setF1(false)}
                  style={inputStyle(f1)}
                />
              </div>
              <div>
                <Label text="Batch End Date" textCol={labelCol} textMuted={textMuted} />
                <input
                  type="date"
                  value={cfg.batchEndDate}
                  onChange={e => update('batchEndDate', e.target.value)}
                  onFocus={() => setF2(true)}
                  onBlur={() => setF2(false)}
                  style={inputStyle(f2)}
                />
              </div>
            </div>

            {/* Next batch note */}
            <div>
              <Label
                text="Next Batch Note"
                sub="Shown to students asking about upcoming batches."
                textCol={labelCol}
                textMuted={textMuted}
              />
              <textarea
                value={cfg.nextBatchNote}
                onChange={e => update('nextBatchNote', e.target.value)}
                onFocus={() => setF3(true)}
                onBlur={() => setF3(false)}
                rows={3}
                placeholder="Next batch starts August 1st — only 20 seats remaining!"
                style={{
                  ...inputStyle(f3),
                  height: 'auto', padding: '10px 14px',
                  resize: 'vertical', lineHeight: 1.55,
                }}
              />
            </div>

            {/* Save */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button
                onClick={save}
                disabled={saving}
                style={{
                  background: isDark ? NEON : '#10b981', color: isDark ? '#000' : '#fff',
                  border: 'none', borderRadius: 8,
                  padding: '10px 24px', fontSize: 13.5, fontWeight: 700,
                  cursor: saving ? 'not-allowed' : 'pointer',
                  opacity: saving ? 0.6 : 1,
                  boxShadow: isDark ? '0 0 16px rgba(92,228,109,0.35)' : '0 2px 8px rgba(16,185,129,0.3)',
                  transition: 'opacity 0.15s',
                }}
              >
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
              {saved && (
                <span style={{ fontSize: 13, color: isDark ? NEON : '#059669', fontWeight: 600 }}>
                  ✓ Saved successfully
                </span>
              )}
            </div>

          </div>

          {/* Danger zone */}
          <div style={{
            marginTop: 32,
            background: isDark ? 'rgba(239,68,68,0.05)' : '#fef2f2',
            border: '1px solid rgba(239,68,68,0.25)',
            borderRadius: 16, padding: 24,
          }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#f87171', marginBottom: 4 }}>
              Danger Zone
            </div>
            <div style={{ fontSize: 12, color: textMuted, marginBottom: 16 }}>
              Permanently delete all WhatsApp chat messages and lead conversations from the database.
            </div>

            <button
              onClick={deleteAllChats}
              disabled={deletingAll}
              style={{
                background: confirmAll ? '#dc2626' : 'rgba(239,68,68,0.12)',
                border: '1px solid #dc2626',
                color: '#fff', borderRadius: 8,
                padding: '9px 18px', fontSize: 13, fontWeight: 600,
                cursor: deletingAll ? 'not-allowed' : 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {deletingAll ? 'Deleting…' : confirmAll ? 'Are you sure? Click again to delete ALL chats' : 'Delete All Chat History'}
            </button>
            {confirmAll && (
              <button
                onClick={() => setConfirmAll(false)}
                style={{
                  background: 'transparent', border: 'none',
                  color: textMuted, fontSize: 12, cursor: 'pointer',
                  marginLeft: 12,
                }}
              >
                Cancel
              </button>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
