import React from 'react';

export function GlassPanel({ children, accentEdge = false, radius = 'var(--radius-panel)', style }) {
  return (
    <div style={{
      background: 'var(--glass-bg)',
      backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)',
      border: '1px solid var(--glass-border)',
      borderTop: accentEdge ? '1px solid var(--glass-edge)' : undefined,
      borderRadius: radius,
      boxShadow: 'var(--shadow-panel), var(--glass-highlight)',
      ...style,
    }}>{children}</div>
  );
}
