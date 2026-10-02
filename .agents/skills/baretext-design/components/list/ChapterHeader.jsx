import React from 'react';
import { Disclosure } from '../controls/Disclosure.jsx';
import { IconButton } from '../controls/IconButton.jsx';
import { MetaLabel } from '../display/MetaLabel.jsx';

function Trailing({ hovered, meta }) {
  return (
    <span style={{ position: 'relative', height: 30, display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
      <span style={{ position: 'absolute', right: 'var(--space-1)', opacity: hovered ? 0 : 1, transform: hovered ? 'translateX(7px)' : 'translateX(0)', transition: 'var(--motion-swap)', pointerEvents: 'none' }}>
        <MetaLabel tone="meta">{meta}</MetaLabel>
      </span>
      <span style={{ display: 'flex', gap: 'var(--space-2xs)', opacity: hovered ? 1 : 0, transform: hovered ? 'translateX(0)' : 'translateX(7px)', transition: 'var(--motion-swap)', pointerEvents: hovered ? 'auto' : 'none' }}>
        <IconButton icon="pencil" label="Rename chapter" iconSize={15} />
        <IconButton icon="trash" label="Delete chapter" iconSize={15} />
      </span>
    </span>
  );
}

/** A chapter (section) header: chevron · number · title · scenes/words. */
export function ChapterHeader({ number, title, meta, open = true, italic = false, onToggle }) {
  const [h, setH] = React.useState(false);
  return (
    <div onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{
        display: 'grid', gridTemplateColumns: '16px 24px 1fr 64px', alignItems: 'center', gap: 'var(--space-2)',
        minHeight: 'var(--row-min-h)', padding: 'var(--row-pad-y) var(--row-pad-x)', borderRadius: 'var(--radius-row)',
        background: h ? 'var(--bt-overlay-hover)' : 'transparent', transition: 'var(--motion-hover)',
      }}>
      <Disclosure open={open} onToggle={onToggle} size={16} />
      <span style={{ font: 'var(--type-meta)', color: 'var(--text-muted)', textAlign: 'center' }}>{number}</span>
      <span style={{ font: 'var(--type-title)', color: 'var(--text-title)', fontStyle: italic ? 'italic' : 'normal', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
      <Trailing hovered={h} meta={meta} />
    </div>
  );
}
