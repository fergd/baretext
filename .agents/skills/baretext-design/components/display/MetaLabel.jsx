import React from 'react';

/** Tabular meta text — word counts, scene/word totals, status words. */
export function MetaLabel({ children, tone = 'meta', italic = false, style = {} }) {
  const color = (tone === 'accent' || tone === 'selected') ? 'var(--accent)' : 'var(--text-meta)';
  return (
    <span style={{
      font: 'var(--type-meta)', fontVariantNumeric: 'tabular-nums',
      fontStyle: italic ? 'italic' : 'normal', color, ...style,
    }}>{children}</span>
  );
}
