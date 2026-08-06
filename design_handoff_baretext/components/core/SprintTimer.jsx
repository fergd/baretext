import React from 'react';
import { GlassPanel } from './GlassPanel';
import { SectionLabel } from './SectionLabel';

export function SprintTimer({ time = '14:32', progress = 42, words = 180, goal = 500, minimized = false, style }) {
  if (minimized) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px',
        fontFamily: 'var(--font-ui)', fontSize: 'var(--text-status)', color: 'var(--text-dim)', ...style }}>
        <i className="ti ti-run" style={{ fontSize: '13px', color: 'var(--accent)' }} /> Sprinting
      </span>
    );
  }
  return (
    <GlassPanel accentEdge style={{ width: '320px', padding: '16px 18px', ...style }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <SectionLabel>sprint</SectionLabel>
        <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>+{words} · goal {goal}</span>
      </div>
      <div style={{ fontSize: '34px', fontWeight: 700, color: 'var(--text)', letterSpacing: '1px',
        fontVariantNumeric: 'tabular-nums', marginTop: '12px' }}>{time}</div>
      <div style={{ height: '3px', borderRadius: '2px', overflow: 'hidden', marginTop: '12px',
        background: 'color-mix(in srgb, var(--border) 60%, transparent)' }}>
        <div style={{ height: '100%', width: progress + '%', background: 'var(--accent)' }} />
      </div>
    </GlassPanel>
  );
}
