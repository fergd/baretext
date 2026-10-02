// The sprint timer (DECISIONS §21): a line along the very bottom of the
// window, drawn like the typewriter guides, that grows from left to right as
// the sprint runs (a words sprint: as the words come). During a break it
// drains back. One compositor animation for the whole run (no per-frame
// work); the wall clock decides when a run ends, so a busy or hidden window
// never stretches a sprint.

export type TimerPhase = 'idle' | 'sprint' | 'break' | 'done';

export class SprintTimer {
  readonly el: HTMLElement;
  private readonly bar: HTMLElement;
  private anim: Animation | null = null;
  private timeout: number | undefined;
  private deadline = 0;
  private remaining = 0;
  private onEnd: (() => void) | null = null;
  phase: TimerPhase = 'idle';
  paused = false;

  constructor(host: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'bt-sprint-line';
    this.el.setAttribute('aria-hidden', 'true');
    this.bar = document.createElement('div');
    this.bar.className = 'bt-sprint-line-bar';
    this.el.append(this.bar);
    host.append(this.el);
  }

  /** Run for `ms`: a sprint fills the line, a break drains it. Calls `onEnd` when the time is up. */
  run(ms: number, phase: 'sprint' | 'break', onEnd: () => void) {
    this.clear();
    this.setPhase(phase);
    this.onEnd = onEnd;
    this.remaining = ms;
    const frames = phase === 'sprint' ? ['scaleX(0)', 'scaleX(1)'] : ['scaleX(1)', 'scaleX(0)'];
    this.bar.style.transform = '';
    this.anim = this.bar.animate(frames.map((transform) => ({ transform })), { duration: Math.max(1, ms), easing: 'linear', fill: 'forwards' });
    this.schedule();
  }

  /** A words sprint: the line shows how far toward the target (0–1). */
  progress(fraction: number) {
    if (this.phase === 'idle' || this.phase === 'done') this.setPhase('sprint');
    this.anim?.cancel();
    this.anim = null;
    this.bar.style.transform = `scaleX(${Math.max(0, Math.min(1, fraction))})`;
  }

  get running(): boolean {
    return this.onEnd !== null;
  }

  pause() {
    if (!this.running || this.paused) return;
    this.paused = true;
    this.remaining = Math.max(0, this.deadline - Date.now());
    clearTimeout(this.timeout);
    this.anim?.pause();
    this.el.dataset.paused = 'true';
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.anim?.play();
    this.schedule();
    delete this.el.dataset.paused;
  }

  setHidden(hidden: boolean) {
    this.el.dataset.hidden = String(hidden);
  }

  get hidden(): boolean {
    return this.el.dataset.hidden === 'true';
  }

  /** The time is up now (also used by tests). */
  finishNow() {
    if (!this.running) return;
    clearTimeout(this.timeout);
    this.anim?.finish();
    const done = this.onEnd!;
    this.onEnd = null;
    done();
  }

  /** The session is over: the line stays full and glows once. */
  complete() {
    this.clear();
    this.bar.style.transform = 'scaleX(1)';
    this.setPhase('done');
  }

  stop() {
    this.clear();
    this.bar.style.transform = '';
    this.setPhase('idle');
    this.setHidden(false);
  }

  private schedule() {
    this.deadline = Date.now() + this.remaining;
    clearTimeout(this.timeout);
    this.timeout = window.setTimeout(() => this.finishNow(), this.remaining);
  }

  private clear() {
    clearTimeout(this.timeout);
    this.anim?.cancel();
    this.anim = null;
    this.onEnd = null;
    this.paused = false;
    delete this.el.dataset.paused;
  }

  private setPhase(phase: TimerPhase) {
    this.phase = phase;
    this.el.dataset.phase = phase;
  }
}
