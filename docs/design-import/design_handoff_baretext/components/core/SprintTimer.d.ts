import * as React from 'react';
/**
 * @startingPoint section="Baretext" subtitle="Subtle, minimizable sprint timer" viewport="360x180"
 */
export interface SprintTimerProps {
  /** Remaining time "mm:ss". */
  time?: string;
  /** Elapsed percent 0–100 (progress bar fill). */
  progress?: number;
  words?: number;
  goal?: number;
  /** Collapsed to the runner + "Sprinting" status chip. */
  minimized?: boolean;
  style?: React.CSSProperties;
}
/** The Sprinter mode timer — a quiet glass panel, or a minimized status chip. */
export function SprintTimer(props: SprintTimerProps): JSX.Element;
