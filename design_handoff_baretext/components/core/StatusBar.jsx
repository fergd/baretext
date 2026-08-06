import React from 'react';

export function StatusBar({ left = [], right = [], mode, style }) {
  return (
    <div style={{
      height: 'var(--statusbar-h)', background: 'var(--bg-alt)', borderTop: '1px solid var(--border)',
      display: 'flex', alignItems: 'center', gap: '16px', padding: '0 18px',
      fontFamily: 'var(--font-ui)', fontSize: 'var(--text-status)', letterSpacing: 'var(--ls-status)',
      color: 'var(--text-dim)', ...style,
    }}>
      {left.map((t, i) => <span key={i} style={i > 0 ? { color: 'var(--text-dimmer)' } : undefined}>{t}</span>)}
      <span style={{ flex: 1 }} />
      {mode && <span style={{ color: 'var(--syntax-2)' }}>{mode}</span>}
      {right.map((t, i) => <span key={i} style={{ color: 'var(--text-dimmer)' }}>{t}</span>)}
    </div>
  );
}
