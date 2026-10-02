import * as React from 'react';
import type { IconName } from '../icon/Icon';
export interface TextButtonProps {
  /** Leading glyph; null to omit. */
  icon?: IconName | null;
  children?: React.ReactNode;
  onClick?: () => void;
  style?: React.CSSProperties;
}
export declare function TextButton(props: TextButtonProps): React.JSX.Element;
