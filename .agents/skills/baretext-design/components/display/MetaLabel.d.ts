import * as React from 'react';
export interface MetaLabelProps {
  children?: React.ReactNode;
  /** 'meta' (muted) | 'accent' | 'selected' (both coral). */
  tone?: 'meta' | 'accent' | 'selected';
  italic?: boolean;
  style?: React.CSSProperties;
}
export declare function MetaLabel(props: MetaLabelProps): React.JSX.Element;
