import React from 'react';
import { Icon } from '../icon/Icon.jsx';

/** Rotating chevron toggle for collapsible sections. */
export function Disclosure({ open = true, onToggle, size = 18, color = 'var(--text-muted)', style = {} }) {
  return (
    <button type="button" aria-expanded={open} aria-label={open ? 'Collapse' : 'Expand'} onClick={onToggle}
      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'inline-flex', color, ...style }}>
      <Icon name="chevron" size={size} strokeWidth={2}
        style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'var(--motion-rotate)' }} />
    </button>
  );
}
