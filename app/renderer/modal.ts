// The frame every panel that covers the window shares (palette, Appearance,
// Export, History, the sprint panels): a scrim behind it (a press there
// dismisses), role=dialog, open/closed in data-open (CSS animates it), Esc
// claimed and dismissing (DECISIONS: Esc layering), and Tab kept inside.

export interface ModalOptions {
  className: string;
  /** The dialog's accessible name: its own label, or the id of its title. */
  label?: string;
  labelledBy?: string;
  /** Esc or a press on the scrim: close, or step back. */
  onDismiss(): void;
}

const FOCUSABLE = 'button, input, select, textarea, [tabindex]';

export class Modal {
  readonly el: HTMLElement;
  readonly scrim: HTMLElement;

  constructor(host: HTMLElement, o: ModalOptions) {
    this.scrim = document.createElement('div');
    this.scrim.className = 'bt-palette-scrim';
    this.el = document.createElement('div');
    this.el.className = o.className;
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-modal', 'true');
    if (o.label) this.el.setAttribute('aria-label', o.label);
    if (o.labelledBy) this.el.setAttribute('aria-labelledby', o.labelledBy);
    this.el.dataset.open = 'false';
    host.append(this.scrim, this.el);

    this.scrim.addEventListener('mousedown', (e) => { e.preventDefault(); o.onDismiss(); });
    // First in line: Esc and Tab never reach the panel's own keys.
    this.el.addEventListener('keydown', (e) => {
      if (e.isComposing) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); o.onDismiss(); }
      else if (e.key === 'Tab') { e.stopImmediatePropagation(); this.trapTab(e); }
    });
  }

  get isOpen(): boolean {
    return this.el.dataset.open === 'true';
  }

  show() {
    this.el.dataset.open = 'true';
    this.scrim.dataset.open = 'true';
  }

  hide() {
    this.el.dataset.open = 'false';
    this.scrim.dataset.open = 'false';
  }

  /** Tab and Shift-Tab cycle through what can take focus, never leaving the dialog. */
  private trapTab(e: KeyboardEvent) {
    e.preventDefault();
    const stops = [...this.el.querySelectorAll<HTMLElement>(FOCUSABLE)]
      .filter((el) => el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled && el.getClientRects().length > 0);
    if (!stops.length) return;
    const i = stops.indexOf(document.activeElement as HTMLElement);
    stops[e.shiftKey ? (i <= 0 ? stops.length - 1 : i - 1) : (i + 1) % stops.length]!.focus();
  }
}

/** The arrow keys within a group of radios (wrapping): the radio to move to, or null for any other key. */
export function arrowStep(e: KeyboardEvent, radios: readonly HTMLElement[], from: HTMLElement): HTMLElement | null {
  const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
  const i = radios.indexOf(from);
  if (!step || i < 0) return null;
  e.preventDefault();
  return radios[(i + step + radios.length) % radios.length]!;
}
