import * as React from 'react';
export type IconName = 'chevron' | 'pencil' | 'trash' | 'plus' | 'grid' | 'frost' | 'grab';
export interface IconProps {
  /** Which glyph to render. */
  name: IconName;
  /** Pixel size (16 | 20 | 24 recommended). */
  size?: number;
  /** Stroke colour (or fill, for `grab`). Defaults to currentColor. */
  stroke?: string;
  strokeWidth?: number;
  style?: React.CSSProperties;
}
export declare function Icon(props: IconProps): React.JSX.Element;
