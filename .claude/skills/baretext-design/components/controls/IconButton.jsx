import React from 'react';
import { Icon } from '../icon/Icon.jsx';

/** Round, quiet icon button with a circular state layer. */
export function IconButton({ icon, label, size = 30, iconSize = 15, onClick, children, style = {} }) {
  const [h, setH] = React.useState(false);
  return (
    <button type="button" aria-label={label} onClick={onClick}
      onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{
        width: size, height: size, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        padding: 0, border: 'none', cursor: 'pointer', borderRadius: 'var(--radius-round)',
        background: h ? 'var(--bt-overlay-icon)' : 'transparent',
        color: h ? 'var(--text-strong)' : 'var(--text-muted)',
        transition: 'var(--motion-hover), color var(--dur-1) var(--ease-standard)', ...style,
      }}>
      {children || <Icon name={icon} size={iconSize} strokeWidth={1.7} />}
    </button>
  );
}
