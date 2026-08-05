import * as React from 'react';
export interface StatusBarProps {
  /** Left cluster — first item full text-dim, the rest dimmer (word/char/mode). */
  left?: React.ReactNode[];
  /** Right cluster — filename etc., all dimmer. */
  right?: React.ReactNode[];
  /** Optional mode label (Editor) in the syntax-accent color. */
  mode?: React.ReactNode;
  style?: React.CSSProperties;
}
/** The thin 30px bottom bar: counts on the left, filename + mode on the right. */
export function StatusBar(props: StatusBarProps): JSX.Element;
