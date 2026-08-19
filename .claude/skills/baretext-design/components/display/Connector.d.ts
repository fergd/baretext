import * as React from 'react';
export interface ConnectorProps {
  /** Highlight the branch that holds the current selection. */
  active?: boolean;
  top?: number | string;
  bottom?: number | string;
  /** Left offset in px — aligns with the chevron column (default 20). */
  left?: number;
  style?: React.CSSProperties;
}
export declare function Connector(props: ConnectorProps): React.JSX.Element;
