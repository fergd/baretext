import React from 'react';

export function Keycap({ children, style }) {
  return (
    <kbd style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'var(--font-ui)', fontSize: '10px', color: 'var(--text-dim)',
      background: 'var(--kbd-bg)', border: '1px solid var(--kbd-border)',
      borderBottomWidth: '2px', borderRadius: 'var(--radius-kbd)', padding: '2px 6px',
      lineHeight: 1, ...style,
    }}>{children}</kbd>
  );
}
