import * as React from 'react';
export interface SectionLabelProps {
  children: React.ReactNode;
  style?: React.CSSProperties;
}
/** Uppercase accent group label (palette groups, panel headers). Always lowercase source text — CSS uppercases it. */
export function SectionLabel(props: SectionLabelProps): JSX.Element;
