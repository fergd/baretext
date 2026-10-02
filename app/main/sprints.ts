// Sprint pages (DECISIONS §21): stored in the app's data folder, never beside
// a manuscript. Each sprint is its writing (<id>.md, a one-scene Baretext
// file, round-trip verified like every save) and its record (<id>.json).
// A sprint is saved as it is written, so a crash or quit loses nothing;
// the next launch finds it still "active" and asks what to do with it.
// Discarded and placed sprints are kept 30 days, then removed.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ID_PATTERN, parse, validate, verifyRoundTrip, type Block, type Manuscript } from '@baretext/format';
import { SPRINT_STATUSES, validSprint, type SprintRecord, type SprintStatus, type SprintSummary } from '../shared/bridge';
import { atomicWrite } from './save';

export const SPRINT_KEEP_DAYS = 30;
/** How much of a sprint's opening the library shows. */
const OPENING_CHARS = 160;
const DAY_MS = 24 * 60 * 60_000;

/** A sprint record from untrusted input, or null. */
export function validRecord(raw: unknown): SprintRecord | null {
  const r = (raw && typeof raw === 'object' ? raw : null) as Record<string, unknown> | null;
  if (!r || typeof r.id !== 'string' || !ID_PATTERN.test(r.id)) return null;
  if (!SPRINT_STATUSES.includes(r.status as SprintStatus)) return null;
  const time = (v: unknown) => (Number.isFinite(v) && (v as number) >= 0 ? (v as number) : null);
  const started = time(r.started);
  const updated = time(r.updated);
  if (started === null || updated === null) return null;
  return {
    id: r.id,
    status: r.status as SprintStatus,
    started,
    updated,
    words: Number.isInteger(r.words) && (r.words as number) >= 0 ? (r.words as number) : 0,
    book: typeof r.book === 'string' ? r.book : null,
    prefs: validSprint(r.prefs),
  };
}

export class SprintStore {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly now: () => number;

  constructor(private readonly root: string, options: { now?: () => number } = {}) {
    this.now = options.now ?? Date.now;
  }

  /** One write at a time, in order. */
  private run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private file(id: string, ext: 'md' | 'json') {
    if (!ID_PATTERN.test(id)) throw new Error('Not a sprint id.');
    return path.join(this.root, `${id}.${ext}`);
  }

  /** Save a sprint: its writing (when given) first, then its record. */
  write(record: SprintRecord, blocks: Block[] | null): Promise<SprintRecord> {
    return this.run(async () => {
      const r = validRecord({ ...record, updated: this.now() });
      if (!r) throw new Error('Not a sprint record.');
      await fs.mkdir(this.root, { recursive: true });
      if (blocks) {
        // A blank page is stored as one empty paragraph (a scene is never empty).
        const content: Block[] = blocks.length ? blocks : [{ type: 'paragraph', content: [] }];
        const page: Manuscript = { title: 'Sprint', chapters: [{ id: 'sprint', title: '', scenes: [{ id: r.id, name: null, link: null, blocks: content }] }], coldStorage: [] };
        if (validate(page).length) throw new Error('Not valid sprint writing.');
        const text = verifyRoundTrip(page);
        await atomicWrite(this.file(r.id, 'md'), text);
      }
      await atomicWrite(this.file(r.id, 'json'), JSON.stringify(r, null, 2));
      return r;
    });
  }

  /**
   * A sprint's writing: [] if none was ever saved; throws if it is there but
   * can't be read now (so nothing mistakes it for empty).
   */
  async read(id: string): Promise<Block[]> {
    let text: string;
    try {
      text = await fs.readFile(this.file(id, 'md'), 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw e;
    }
    const blocks = parse(text).manuscript.chapters[0]?.scenes[0]?.blocks ?? [];
    const blank = blocks.every((b) => b.type === 'paragraph' && b.content.every((r) => !r.text.trim()));
    return blank ? [] : blocks;
  }

  /** Every readable record, newest first. */
  async list(): Promise<SprintRecord[]> {
    let names: string[];
    try {
      names = await fs.readdir(this.root);
    } catch {
      return [];
    }
    const records: SprintRecord[] = [];
    for (const name of names.filter((n) => n.endsWith('.json'))) {
      try {
        const r = validRecord(JSON.parse(await fs.readFile(path.join(this.root, name), 'utf8')));
        if (r && `${r.id}.json` === name) records.push(r);
      } catch {
        // unreadable: left alone, never deleted
      }
    }
    return records.sort((a, b) => b.updated - a.updated);
  }

  /** A sprint that never ended (the app quit or crashed during it). */
  async unfinished(): Promise<SprintRecord | null> {
    return (await this.list()).find((r) => r.status === 'active') ?? null;
  }

  /** The sprints kept in Sprints, most recently written first, each with its opening words. */
  async kept(): Promise<SprintSummary[]> {
    const out: SprintSummary[] = [];
    const kept = (await this.list()).filter((r) => r.status === 'kept').sort((a, b) => b.started - a.started);
    for (const record of kept) {
      // Unreadable writing is still listed (its opening blank), never hidden.
      const blocks = await this.read(record.id).catch(() => []);
      const first = blocks.find((b) => b.type === 'paragraph' && b.content.some((r) => r.text.trim()));
      const text = first?.type === 'paragraph' ? first.content.map((r) => r.text).join('').trim() : '';
      out.push({ record, opening: text.slice(0, OPENING_CHARS) });
    }
    return out;
  }

  /** Remove discarded and placed sprints older than the keep period. */
  purge(): Promise<number> {
    return this.run(async () => {
      const cutoff = this.now() - SPRINT_KEEP_DAYS * DAY_MS;
      let removed = 0;
      for (const r of await this.list()) {
        if ((r.status === 'discarded' || r.status === 'placed') && r.updated < cutoff) {
          await fs.rm(this.file(r.id, 'md'), { force: true });
          await fs.rm(this.file(r.id, 'json'), { force: true });
          removed++;
        }
      }
      return removed;
    });
  }
}
