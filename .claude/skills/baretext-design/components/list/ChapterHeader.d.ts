import * as React from 'react';
export interface ChapterHeaderProps {
  /** Chapter number (shown bare, no "Ch." prefix). */
  number: number | string;
  title: string;
  /** Trailing summary — scenes/words, e.g. "6/4557". */
  meta: string;
  open?: boolean;
  /** Render the title italic (placeholder / untitled chapters). */
  italic?: boolean;
  onToggle?: () => void;
}
/**
 * Collapsible chapter header for the manuscript rail.
 * @startingPoint section="Manuscript" subtitle="Chapter header with scenes/words" viewport="380x48"
 */
export declare function ChapterHeader(props: ChapterHeaderProps): React.JSX.Element;
