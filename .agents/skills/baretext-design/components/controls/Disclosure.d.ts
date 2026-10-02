import * as React from 'react';
export interface DisclosureProps {
  open?: boolean;
  onToggle?: () => void;
  size?: number;
  color?: string;
  style?: React.CSSProperties;
}
export declare function Disclosure(props: DisclosureProps): React.JSX.Element;
