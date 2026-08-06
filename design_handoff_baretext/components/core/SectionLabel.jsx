import React from 'react';

export function SectionLabel({ children, style }) {
  return (
    <div style={{
      fontFamily: 'var(--font-ui)', fontSize: 'var(--text-label)',
      letterSpacing: 'var(--ls-label)', textTransform: 'uppercase',
      color: 'var(--accent)', fontWeight: 600, opacity: 0.85, ...style,
    }}>{children}</div>
  );
}
