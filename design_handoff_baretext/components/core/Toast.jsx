import React from 'react';

export function Toast({ icon, children, style }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: '9px',
      fontFamily: 'var(--font-ui)', fontSize: 'var(--text-ui)', color: 'var(--text)',
      background: 'var(--glass-bg)', backdropFilter: 'var(--glass-blur)', WebkitBackdropFilter: 'var(--glass-blur)',
      border: '1px solid var(--glass-border)', borderRadius: 'var(--radius-toast)',
      boxShadow: 'var(--shadow-toast), var(--glass-highlight)', padding: '10px 15px', ...style,
    }}>
      {icon && <i className={'ti ti-' + icon} style={{ fontSize: '15px', color: 'var(--accent)' }} />}
      {children}
    </div>
  );
}
