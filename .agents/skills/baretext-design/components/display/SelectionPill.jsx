import React from 'react';

/** Filled active-indicator surface for a selected/hovered row (M3 secondary-container). */
export function SelectionPill({ selected = false, hovered = false, radius = 'var(--radius-row)', children, style = {}, ...rest }) {
  const background = selected ? 'var(--selected-surface)' : hovered ? 'var(--bt-overlay-hover)' : 'transparent';
  return (
    <div style={{ background, borderRadius: radius, transition: 'var(--motion-hover)', ...style }} {...rest}>
      {children}
    </div>
  );
}
