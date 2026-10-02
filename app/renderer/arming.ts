// Two-step confirmation (spec §0.8): the first press arms, a second on the
// same thing acts. It disarms by itself after a few seconds, on a press
// anywhere else, or on Esc (which it claims, so nothing else closes too) —
// the same everywhere it is used.

export const ARM_MS = 4000;

export class Arming<K> {
  private state: { key: K; timer: number; away: (e: Event) => void } | null = null;

  /** `onChange` redraws when what is armed changes (null: nothing). */
  constructor(private readonly onChange: (armed: K | null) => void) {}

  get key(): K | null {
    return this.state?.key ?? null;
  }

  /** One press on `key`: arms it, or — already armed — disarms and returns true (act now). */
  press(key: K, owns: (target: Element) => boolean): boolean {
    if (this.state && this.state.key === key) { this.disarm(); return true; }
    this.arm(key, owns);
    return false;
  }

  /** Arm `key`; a press on an element `owns` accepts is the confirming one, not a press elsewhere. */
  arm(key: K, owns: (target: Element) => boolean) {
    this.clear();
    const away = (e: Event) => {
      if (e.type === 'keydown') {
        if ((e as KeyboardEvent).key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        this.disarm();
        return;
      }
      if (!(e.target instanceof Element && owns(e.target))) this.disarm();
    };
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', away, true);
    this.state = { key, timer: window.setTimeout(() => this.disarm(), ARM_MS), away };
    this.onChange(key);
  }

  disarm() {
    if (!this.state) return;
    this.clear();
    this.onChange(null);
  }

  private clear() {
    const s = this.state;
    if (!s) return;
    this.state = null;
    clearTimeout(s.timer);
    window.removeEventListener('pointerdown', s.away, true);
    window.removeEventListener('keydown', s.away, true);
  }
}
