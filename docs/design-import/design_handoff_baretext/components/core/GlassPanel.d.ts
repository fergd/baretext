import * as React from 'react';
export interface GlassPanelProps {
  children: React.ReactNode;
  /** Add the thin accent-tinted top edge (command palette / sprint panel). */
  accentEdge?: boolean;
  /** Corner radius token — 14 palette, 12 panel, 8 picker, 5 toast. */
  radius?: string;
  style?: React.CSSProperties;
}
/** The floating translucent surface behind palette, font picker, sprint panel, toast. */
export function GlassPanel(props: GlassPanelProps): JSX.Element;
