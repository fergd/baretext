import React from 'react';
import { Icon } from '../icon/Icon.jsx';
import { IconButton } from '../controls/IconButton.jsx';
import { MetaLabel } from '../display/MetaLabel.jsx';

function Trailing({ hovered, meta, tone, italic }) {
  return (
    <span style={{ position: 'relative', height: 30, display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
      <span style={{ position: 'absolute', right: 'var(--space-1)', opacity: hovered ? 0 : 1, transform: hovered ? 'translateX(7px)' : 'translateX(0)', transition: 'var(--motion-swap)', pointerEvents: 'none' }}>
        <MetaLabel tone={tone} italic={italic}>{meta}</MetaLabel>
      </span>
      <span style={{ display: 'flex', gap: 'var(--space-2xs)', opacity: hovered ? 1 : 0, transform: hovered ? 'translateX(0)' : 'translateX(7px)', transition: 'var(--motion-swap)', pointerEvents: hovered ? 'auto' : 'none' }}>
        <IconButton icon="pencil" label="Rename scene" iconSize={14} />
        <IconButton icon="trash" label="Delete scene" iconSize={14} />
      </span>
    </span>
  );
}

/** A single scene in the manuscript rail. Selected = tonal pill; count swaps to controls on hover. */
export function SceneRow({ title, count, status, selected = false, onSelect }) {
  const [h, setH] = React.useState(false);
  const isDraft = status === 'draft' || count == null;
  const background = selected ? 'var(--selected-surface)' : h ? 'var(--bt-overlay-hover)' : 'transparent';
  return (
    <div onClick={onSelect} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{
        display: 'grid', gridTemplateColumns: '24px 1fr 64px', alignItems: 'center', gap: 'var(--space-2)',
        minHeight: 'var(--row-min-h)', padding: 'var(--row-pad-y) var(--row-pad-x)', marginLeft: 'var(--scene-inset)',
        borderRadius: 'var(--radius-row)', background, cursor: 'pointer', transition: 'var(--motion-hover)',
      }}>
      <span style={{ opacity: h ? 1 : 0, color: 'var(--text-faint)', display: 'flex', justifyContent: 'center', transition: 'opacity var(--dur-1) var(--ease-standard)' }}>
        <Icon name="grab" size={14} stroke="var(--text-faint)" />
      </span>
      <span style={{
        font: 'var(--type-body)', color: selected ? 'var(--selected-text)' : 'var(--text-title)',
        fontStyle: isDraft ? 'italic' : 'normal', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>{title}</span>
      <Trailing hovered={h} meta={isDraft ? (status || 'draft') : count} tone={isDraft ? 'accent' : (selected ? 'selected' : 'meta')} italic={isDraft} />
    </div>
  );
}
