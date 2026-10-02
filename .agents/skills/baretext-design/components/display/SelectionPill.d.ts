import * as React from 'react';
export interface SelectionPillProps {
  selected?: boolean;
  hovered?: boolean;
  radius?: string;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}
export declare function SelectionPill(props: SelectionPillProps): React.JSX.Element;
