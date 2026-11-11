'use client';

import { useState } from 'react';
import { CORE_SYSTEM_PROMPT } from '@/lib/knowledge';
import { useTheme } from '@/context/ThemeContext';
import ThemeToggle from './ThemeToggle';

const NEON = '#5ce46d';

export default function PromptUI({ initialPrompt }: { initialPrompt: string }) {
  const { isDark } = useTheme();
  const [prompt,  setPrompt]  = useState(initialPrompt);
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);
  const [focused, setFocused] = useState(false);

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      await fetch('/api/system-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  }

  async function resetToDefault() {
    setPrompt(CORE_SYSTEM_PROMPT);
    setSaving(true);
    try {
      await fetch('/api/system-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: CORE_SYSTEM_PROMPT }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  }

  const glassBg = isDark
    ? 'linear-gradient(180deg, rgba(20,29,25,0.8) 0%, rgba(13,20,17,0.9) 100%)'
    : '#ffffff';
  const borderCol = isDark ? '#202d26' : '#e2e8f0';
  const textCol = isDark ? '#ffffff' : '#0f172a';
  const textMuted = isDark ? '#9ca3af' : '#64748b';

  return (
    <div style={{ flex: 1, overflowY: 'auto' }}>
      <div style={{ padding: '32px 36px' }}>
        <div style={{ maxWidth: 820 }}>

          {/* Header */}
          <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <h1 style={{ fontSize: 28, fontWeight: 700, color: textCol, margin: 0 }}>System Prompt</h1>
              <p style={{ fontSize: 13, color: textMuted, marginTop: 6 }}>
                The AI follows this instruction for every conversation. Changes take effect immediately on both website chat and WhatsApp.
              </p>
            </div>
            <ThemeToggle />
          </div>

          {/* Textarea card */}
          <div style={{
            background: glassBg,
            border: `1px solid ${borderCol}`,
            borderRadius: 16,
            padding: 20,
            marginBottom: 16,
            boxShadow: isDark ? 'none' : '0 1px 3px rgba(0,0,0,0.05)',
          }}>
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              rows={22}
              style={{
                width: '100%', padding: '14px',
                fontSize: 13, lineHeight: 1.75,
                fontFamily: '"SF Mono", "Fira Code", "Cascadia Code", monospace',
                color: isDark ? '#d1fae5' : '#065f46',
                background: isDark ? 'rgba(9,13,11,0.8)' : '#f8fafc',
                border: `1.5px solid ${focused ? (isDark ? NEON : '#10b981') : borderCol}`,
                borderRadius: 10,
                outline: 'none', resize: 'vertical',
                boxSizing: 'border-box',
                boxShadow: focused ? `0 0 0 3px ${isDark ? 'rgba(92,228,109,0.1)' : 'rgba(16,185,129,0.1)'}` : 'none',
                transition: 'border-color 0.15s, box-shadow 0.15s',
              }}
            />
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
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
              {saving ? 'Saving…' : 'Save Prompt'}
            </button>

            <button
              onClick={resetToDefault}
              disabled={saving}
              style={{
                background: 'transparent',
                border: `1px solid ${borderCol}`,
                color: textMuted, borderRadius: 8,
                padding: '10px 18px', fontSize: 13, fontWeight: 500,
                cursor: saving ? 'not-allowed' : 'pointer',
                transition: 'all 0.15s',
              }}
            >
              Reset to Default
            </button>

            {saved && (
              <span style={{ fontSize: 13, color: isDark ? NEON : '#059669', fontWeight: 600 }}>
                ✓ Prompt saved &amp; active
              </span>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
