// Local snapshots (DECISIONS §6): point-in-time (last 10), daily (30 days),
// and manual (kept until deleted). Stored in the app's data folder, never
// beside the manuscript; content is deduplicated by hash. One queue per
// manuscript so the index is never written by two saves at once.

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { manuscriptWords, parse } from '@baretext/format';
import { atomicWrite, fileKey } from './save';

export type SnapshotKind = 'point' | 'daily' | 'manual';

export interface SnapshotEntry {
  id: string;
  kind: SnapshotKind;
  /** Why it was taken: "Opened", "Autosave", "Before Replace All", "Daily"… */
  reason: string;
  label?: string;
  time: number;
  words: number;
  hash: string;
}

export const POINT_KEEP = 10;
export const DAILY_DAYS = 30;
export const POINT_EVERY_MS = 15 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

const localDay = (t: number) => new Date(t).toDateString();

export class SnapshotStore {
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly now: () => number;

  constructor(private readonly root: string, options: { now?: () => number } = {}) {
    this.now = options.now ?? Date.now;
  }

  private dir(filePath: string) {
    return path.join(this.root, fileKey(filePath));
  }

  /** Run `fn` after every earlier operation on this manuscript. */
  private queue<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
    const key = this.dir(filePath);
    const run = (this.queues.get(key) ?? Promise.resolve()).then(fn, fn);
    this.queues.set(key, run.catch(() => undefined));
    return run;
  }

  // ── index ──

  private async readIndex(dir: string): Promise<SnapshotEntry[]> {
    let raw: string;
    try {
      raw = await fs.readFile(path.join(dir, 'index.json'), 'utf8');
    } catch {
      return []; // no snapshots yet
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter(isEntry);
    } catch { /* fall through to recovery */ }
    return this.recover(dir);
  }

  /** A damaged index is set aside and rebuilt from the stored content. */
  private async recover(dir: string): Promise<SnapshotEntry[]> {
    await fs.rename(path.join(dir, 'index.json'), path.join(dir, `index.corrupt-${this.now()}.json`)).catch(() => undefined);
    const entries: SnapshotEntry[] = [];
    let files: string[] = [];
    try { files = await fs.readdir(path.join(dir, 'objects')); } catch { /* none */ }
    for (const f of files) {
      if (!f.endsWith('.md')) continue;
      const file = path.join(dir, 'objects', f);
      const [text, stat] = await Promise.all([fs.readFile(file, 'utf8'), fs.stat(file)]);
      let words = 0;
      try { words = manuscriptWords(parse(text).manuscript); } catch { /* unreadable: still listed */ }
      const hash = f.slice(0, -3);
      entries.push({ id: `recovered-${hash.slice(0, 12)}`, kind: 'manual', reason: 'Recovered', time: stat.mtimeMs, words, hash });
    }
    entries.sort((a, b) => a.time - b.time);
    await this.writeIndex(dir, entries);
    return entries;
  }

  private async writeIndex(dir: string, entries: SnapshotEntry[]) {
    await fs.mkdir(dir, { recursive: true });
    await atomicWrite(path.join(dir, 'index.json'), JSON.stringify(entries, null, 1));
  }

  // ── public ──

  /** Newest first. */
  list(filePath: string): Promise<SnapshotEntry[]> {
    return this.queue(filePath, async () => (await this.readIndex(this.dir(filePath))).slice().reverse());
  }

  read(filePath: string, id: string): Promise<string> {
    return this.queue(filePath, async () => {
      const dir = this.dir(filePath);
      const entry = (await this.readIndex(dir)).find((e) => e.id === id);
      if (!entry) throw new Error('That snapshot no longer exists.');
      return fs.readFile(path.join(dir, 'objects', `${entry.hash}.md`), 'utf8');
    });
  }

  /**
   * Take a snapshot. An automatic one ("Autosave", "Opened") identical to
   * the newest snapshot is skipped (returns null), and there is one daily
   * per day. Named ones ("Before Replace All", "Before restore", manual) are
   * always listed, so the writer can find them; identical content is still
   * stored only once.
   */
  take(filePath: string, text: string, words: number, kind: SnapshotKind, reason: string, label?: string): Promise<SnapshotEntry | null> {
    return this.queue(filePath, () => this.takeNow(filePath, text, words, kind, reason, label));
  }

  /** On every save: a daily once per day, a point at most every 15 minutes. */
  auto(filePath: string, text: string, words: number): Promise<void> {
    return this.queue(filePath, async () => {
      const entries = await this.readIndex(this.dir(filePath));
      const now = this.now();
      if (!entries.some((e) => e.kind === 'daily' && localDay(e.time) === localDay(now))) {
        await this.takeNow(filePath, text, words, 'daily', 'Daily');
      }
      const lastPoint = entries.filter((e) => e.kind === 'point').at(-1);
      if (!lastPoint || now - lastPoint.time >= POINT_EVERY_MS) {
        await this.takeNow(filePath, text, words, 'point', 'Autosave', undefined, true);
      }
    });
  }

  remove(filePath: string, id: string): Promise<void> {
    return this.queue(filePath, async () => {
      const dir = this.dir(filePath);
      const entries = (await this.readIndex(dir)).filter((e) => e.id !== id);
      await this.writeIndex(dir, entries);
      await this.collect(dir, entries);
    });
  }

  // ── internals (always called inside the queue) ──

  private async takeNow(
    filePath: string, text: string, words: number, kind: SnapshotKind, reason: string, label?: string, force = false,
  ): Promise<SnapshotEntry | null> {
    const dir = this.dir(filePath);
    const entries = await this.readIndex(dir);
    const hash = createHash('sha256').update(text).digest('hex');
    const newest = entries.at(-1);
    const automatic = kind === 'point' && (reason === 'Autosave' || reason === 'Opened');
    if (automatic && !force && newest?.hash === hash) return null;
    if (kind === 'daily' && entries.some((e) => e.kind === 'daily' && localDay(e.time) === localDay(this.now()))) return null;

    const objects = path.join(dir, 'objects');
    await fs.mkdir(objects, { recursive: true });
    const object = path.join(objects, `${hash}.md`);
    try { await fs.access(object); } catch { await atomicWrite(object, text); }

    const time = this.now();
    const entry: SnapshotEntry = { id: `${time.toString(36)}-${hash.slice(0, 8)}-${entries.length}`, kind, reason, time, words, hash };
    if (label?.trim()) entry.label = label.trim().slice(0, 120);
    const next = prune([...entries, entry], time);
    await this.writeIndex(dir, next);
    await this.collect(dir, next);
    return next.includes(entry) ? entry : null;
  }

  /** Delete stored content no entry refers to. */
  private async collect(dir: string, entries: SnapshotEntry[]) {
    const used = new Set(entries.map((e) => `${e.hash}.md`));
    let files: string[] = [];
    try { files = await fs.readdir(path.join(dir, 'objects')); } catch { return; }
    await Promise.all(files.filter((f) => f.endsWith('.md') && !used.has(f)).map((f) => fs.rm(path.join(dir, 'objects', f), { force: true })));
  }
}

function prune(entries: SnapshotEntry[], now: number): SnapshotEntry[] {
  const points = entries.filter((e) => e.kind === 'point');
  const dropPoints = new Set(points.slice(0, Math.max(0, points.length - POINT_KEEP)));
  return entries.filter((e) =>
    !dropPoints.has(e) && !(e.kind === 'daily' && now - e.time >= DAILY_DAYS * DAY_MS));
}

function isEntry(e: unknown): e is SnapshotEntry {
  const x = e as SnapshotEntry;
  return !!x && typeof x.id === 'string' && typeof x.hash === 'string' && /^[0-9a-f]{64}$/.test(x.hash) &&
    (x.kind === 'point' || x.kind === 'daily' || x.kind === 'manual') && typeof x.time === 'number' && typeof x.words === 'number';
}
