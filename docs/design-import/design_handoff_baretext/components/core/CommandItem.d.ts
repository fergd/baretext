import * as React from 'react';
export interface CommandItemProps {
  /** Tabler icon name without the "ti-" prefix, e.g. "file-plus". */
  icon?: string;
  label: string;
  /** Shortcut keys shown as keycaps on the right. */
  keys?: string[];
  /** Highlighted row: inset accent stripe + faint wash, no layout shift. */
  active?: boolean;
  /** Right-aligned checkmark (e.g. active theme / mode). */
  checked?: boolean;
  style?: React.CSSProperties;
}
/** A single command-palette row: icon, label, optional keycaps or checkmark. */
export function CommandItem(props: CommandItemProps): JSX.Element;
