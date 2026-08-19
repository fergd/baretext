import React from 'react';
import { Icon } from '../icon/Icon.jsx';

/** Low-emphasis text action (e.g. "add scene") in the accent colour. */
export function TextButton({ icon = 'plus', children, onClick, style = {} }) {
  const [h, setH] = React.useState(false);
  return (
    <button type="button" onClick={onClick}
      onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)',
        padding: 'var(--space-2) var(--space-3)', border: 'none', cursor: 'pointer',
        borderRadius: 'var(--radius-row)', font: 'var(--type-meta)', fontWeight: 'var(--weight-medium)',
        color: 'var(--accent)', background: h ? 'var(--bt-accent-wash)' : 'transparent',
        transition: 'var(--motion-hover)', ...style,
      }}>
      {icon && <Icon name={icon} size={15} stroke="currentColor" strokeWidth={1.9} />}
      {children}
    </button>
  );
}
