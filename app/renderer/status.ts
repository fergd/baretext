// What the window tells the writer in passing: a toast (a message that
// fades once read), and the status bar's word count.

import { numberFormat } from './dom';

export type ToastKind = 'info' | 'error';

export class Status {
  private toastTimer: number | undefined;

  constructor(private readonly toastEl: HTMLElement, private readonly wordsEl: HTMLElement) {}

  /** A message for as long as it takes to read: about a second per ten words, never less than a minimum (longer for errors). */
  readonly toast = (message: string, kind: ToastKind = 'info') => {
    const el = this.toastEl;
    el.textContent = message;
    el.dataset.kind = kind;
    el.dataset.visible = 'true';
    clearTimeout(this.toastTimer);
    const readMs = Math.min(15_000, Math.max(kind === 'error' ? 8000 : 2400, message.split(/\s+/).length * 400));
    this.toastTimer = window.setTimeout(() => { el.dataset.visible = 'false'; }, readMs);
  };

  /** "12,400 words", or against a target, "12,400 of 90,000 words"; `suffix` follows ("in this scene"). */
  readonly words = (count: number, target: number | null = null, suffix = '') => {
    // The counts in the number face, the words in the interface face.
    const num = (n: number) => Object.assign(document.createElement('span'), { className: 'bt-num-text', textContent: numberFormat.format(n) });
    const unit = ` ${count === 1 && !target ? 'word' : 'words'}${suffix ? ` ${suffix}` : ''}`;
    this.wordsEl.replaceChildren(...(target ? [num(count), ' of ', num(target), unit] : [num(count), unit]));
  };
}
