import * as React from 'react';
export interface KeycapProps {
  /** Key glyph(s): "⌘", "⇧", "N", "esc", "↵" */
  children: React.ReactNode;
  style?: React.CSSProperties;
}
/** A single keycap badge with the 2px bottom-border "lip". */
export function Keycap(props: KeycapProps): JSX.Element;
