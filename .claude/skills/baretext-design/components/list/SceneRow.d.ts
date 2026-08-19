import * as React from 'react';
export interface SceneRowProps {
  /** Scene title, shown verbatim (truncates with ellipsis). */
  title: string;
  /** Word count. Omit (or pass status) for a draft. */
  count?: number | string;
  /** 'draft' shows an italic status word instead of a count. */
  status?: 'draft';
  selected?: boolean;
  onSelect?: () => void;
}
/**
 * Selectable scene row with hover-revealed edit/delete controls.
 * @startingPoint section="Manuscript" subtitle="Scene row with hover controls" viewport="380x44"
 */
export declare function SceneRow(props: SceneRowProps): React.JSX.Element;
