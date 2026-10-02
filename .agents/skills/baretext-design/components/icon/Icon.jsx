import React from 'react';

const ICONS = {
  chevron: <path d="M6 9l6 6 6-6" />,
  pencil: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" /></>,
  trash: <><path d="M3 6h18" /><path d="M8 6V4.5h8V6" /><path d="M6 6l1 14h10l1-14" /></>,
  plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
  grid: <><rect x="4" y="4" width="6.5" height="6.5" rx="1.6" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6" /></>,
  frost: <><path d="M12 3v18" /><path d="M4.2 7.5l15.6 9" /><path d="M19.8 7.5l-15.6 9" /></>,
};

/** Baretext line-icon glyph. `grab` is the only filled glyph (drag dots). */
export function Icon({ name, size = 20, stroke = 'currentColor', strokeWidth = 1.7, style = {} }) {
  if (name === 'grab') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={stroke}
        style={{ display: 'block', flex: 'none', ...style }} aria-hidden="true">
        <circle cx="9" cy="5" r="1.4" /><circle cx="15" cy="5" r="1.4" />
        <circle cx="9" cy="12" r="1.4" /><circle cx="15" cy="12" r="1.4" />
        <circle cx="9" cy="19" r="1.4" /><circle cx="15" cy="19" r="1.4" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      style={{ display: 'block', flex: 'none', ...style }} aria-hidden="true">
      {ICONS[name] || null}
    </svg>
  );
}
