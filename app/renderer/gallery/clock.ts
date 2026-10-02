// Time stands still in the gallery, so every frame looks the same on every
// run: "now" is fixed, and timers of a second or more never fire (a sprint
// never ends, an armed Discard never disarms, a toast never fades). Imported
// first, before any component.

export const NOW = new Date(2026, 9, 2, 9, 41).getTime();

class FrozenDate extends Date {
  constructor(...args: [] | [number | string | Date] | [number, number, number?, number?, number?, number?, number?]) {
    if (args.length === 0) super(NOW);
    else super(...(args as [number]));
  }

  static override now(): number {
    return NOW;
  }
}
globalThis.Date = FrozenDate as DateConstructor;

const setTimeoutReal = window.setTimeout.bind(window);
window.setTimeout = ((handler: TimerHandler, ms?: number, ...rest: unknown[]) =>
  (ms ?? 0) >= 1000 ? 0 : setTimeoutReal(handler, ms, ...rest)) as typeof window.setTimeout;
