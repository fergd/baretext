import React from 'react';
import { Keycap } from './Keycap';

export function CommandItem({ icon, label, keys = [], active = false, checked = false, style }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 18px',
      fontFamily: 'var(--font-ui)', fontSize: 'var(--text-ui)',
      color: active ? 'var(--text)' : 'var(--text-dim)',
      background: active ? 'var(--wash-accent)' : 'transparent',
      boxShadow: active ? 'var(--stripe-accent)' : 'none', ...style,
    }}>
      {icon && <i className={'ti ti-' + icon} style={{ fontSize: '16px', width: '16px', color: active ? 'var(--accent)' : 'var(--text-dim)' }} />}
      <span style={{ flex: 1 }}>{label}</span>
      {checked && <i className="ti ti-check" style={{ fontSize: '15px', color: 'var(--accent)' }} />}
      {keys.length > 0 && (
        <span style={{ display: 'flex', gap: '4px' }}>
          {keys.map((k, i) => <Keycap key={i}>{k}</Keycap>)}
        </span>
      )}
    </div>
  );
}
