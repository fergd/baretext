// A name edited in place (the outline's rows, the corkboard's cards): a text
// field that ↵ keeps, Esc leaves as it was, and clicking away keeps. Its keys
// are its own (the list's keys wait); text being composed (an input method)
// is never cut short. The caller places the field and decides where the
// keyboard goes after.

export interface InlineEditOptions {
  value: string;
  placeholder: string;
  label: string;
  className: string;
  /** The edit ended: keep `value` (`save`) or not; `refocus`: false when the writer clicked away (the keyboard is already elsewhere). */
  onDone(save: boolean, value: string, refocus: boolean): void;
}

export class InlineEdit {
  readonly input: HTMLInputElement;
  private ended = false;

  constructor(private readonly o: InlineEditOptions) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = o.className;
    input.value = o.value;
    input.placeholder = o.placeholder;
    input.spellcheck = false;
    input.setAttribute('aria-label', o.label);
    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // the list's own keys wait
      if (e.isComposing) return;
      if (e.key === 'Enter') { e.preventDefault(); this.finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); this.finish(false); }
    });
    input.addEventListener('blur', () => this.finish(true, false));
    this.input = input;
  }

  /** Give it the keyboard, its text selected (placed first by the caller). */
  focus() {
    this.input.focus();
    this.input.select();
  }

  /** End it (once): keep the text or not. */
  finish(save: boolean, refocus = true) {
    if (this.ended) return;
    this.ended = true;
    this.o.onDone(save, this.input.value, refocus);
  }
}
