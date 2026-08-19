import React from 'react';

/** Vertical timeline spine segment. Absolutely positioned; the parent must be relative. */
export function Connector({ active = false, top = 0, bottom = 0, left = 20, style = {} }) {
  return (
    <div aria-hidden="true" style={{
      position: 'absolute', left, top, bottom, width: 2, borderRadius: 2,
      background: active ? 'var(--connector-active)' : 'var(--connector)',
      pointerEvents: 'none', ...style,
    }} />
  );
}
