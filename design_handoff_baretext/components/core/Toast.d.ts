import * as React from 'react';
export interface ToastProps {
  /** Optional leading Tabler icon (name without "ti-"). */
  icon?: string;
  /** Message — lowercase, terse ("focus mode on", "sprint complete · +342 words"). */
  children: React.ReactNode;
  style?: React.CSSProperties;
}
/** Small glass toast, bottom-center. Lowercase, no exclamation. */
export function Toast(props: ToastProps): JSX.Element;
