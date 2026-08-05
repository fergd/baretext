import * as React from 'react';
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Selected state: solid accent fill, bg-colored text, bold. */
  active?: boolean;
}
/** Text-first ghost button (font picker, panel controls). Hover = accent wash + scale(1.04). Active = inverted solid accent. */
export function Button(props: ButtonProps): JSX.Element;
