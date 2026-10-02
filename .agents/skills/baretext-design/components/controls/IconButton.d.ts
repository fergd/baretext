import * as React from 'react';
import type { IconName } from '../icon/Icon';
export interface IconButtonProps {
  /** Glyph name (ignored if children are provided). */
  icon?: IconName;
  /** Accessible label — required for screen readers. */
  label: string;
  /** Hit-target size in px. 40 is the standalone minimum; 30 in dense rows. */
  size?: number;
  iconSize?: number;
  onClick?: () => void;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}
export declare function IconButton(props: IconButtonProps): React.JSX.Element;
