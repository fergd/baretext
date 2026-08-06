import React from 'react';

export function Button({ children, active = false, style, ...rest }) {
  const [hover, setHover] = React.useState(false);
  const bg = active ? 'var(--accent)' : (hover ? 'var(--wash-accent-strong)' : 'transparent');
  const color = active ? 'var(--bg)' : (hover ? 'var(--text)' : 'var(--text-dim)');
  return (
    <button {...rest}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        fontFamily: 'var(--font-ui)', fontSize: 'var(--text-ui)', cursor: 'pointer',
        border: 'none', borderRadius: 'var(--radius-item)', padding: '6px 14px',
        background: bg, color, fontWeight: active ? 700 : 400,
        transform: hover && !active ? 'scale(1.04)' : 'none',
        transition: 'background var(--dur-micro) ease, color var(--dur-micro) ease, transform var(--dur-micro) ease',
        ...style,
      }}>{children}</button>
  );
}
