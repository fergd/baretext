import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Block } from '@baretext/format';
import { DEFAULT_SPRINT, type SprintRecord } from '../../shared/bridge';
import { SprintStore, SPRINT_KEEP_DAYS } from '../sprints';

const DAY = 24 * 60 * 60_000;
const writing: Block[] = [
  { type: 'paragraph', content: [{ text: 'She ran ' }, { text: 'fast', italic: true }, { text: '.' }] },
  { type: 'section_break' },
  { type: 'paragraph', content: [{ text: 'Later.' }] },
];
const record = (id: string, status: SprintRecord['status'] = 'active'): SprintRecord => ({ id, status, started: 1, updated: 1, words: 4, book: '/b.md', prefs: DEFAULT_SPRINT });
const store = (now = () => 1000 * DAY) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'bt-sprint-'));
  return { root, s: new SprintStore(root, { now }) };
};

describe('sprint storage', () => {
  it('saves the writing and its record, and reads the writing back exactly', async () => {
    const { root, s } = store();
    await s.write(record('abc'), writing);
    expect(await s.read('abc')).toEqual(writing);
    expect(readdirSync(root).sort()).toEqual(['abc.json', 'abc.md']);
    expect(readFileSync(path.join(root, 'abc.md'), 'utf8')).toContain('*fast*');
  });

  it('saves a blank page (a sprint just started), and reads it back as blank', async () => {
    const { s } = store();
    await s.write(record('blank'), []);
    expect(await s.read('blank')).toEqual([]);
    expect((await s.unfinished())?.id).toBe('blank');
  });

  it('finds a sprint that never ended (crash or quit), and not one that did', async () => {
    const { s } = store();
    expect(await s.unfinished()).toBeNull();
    await s.write(record('one'), writing);
    expect((await s.unfinished())?.id).toBe('one');
    await s.write(record('one', 'kept'), null); // the record changes; the writing stays
    expect(await s.unfinished()).toBeNull();
    expect(await s.read('one')).toEqual(writing);
  });

  it('lists kept sprints, newest first, each with its opening words', async () => {
    let now = 1000 * DAY;
    const { s } = store(() => now);
    await s.write(record('old', 'kept'), writing);
    now += 1000;
    await s.write(record('new', 'kept'), [{ type: 'section_break' }, { type: 'paragraph', content: [{ text: 'x'.repeat(300) }] }]);
    await s.write(record('busy', 'active'), writing);
    await s.write(record('gone', 'discarded'), writing);
    const kept = await s.kept();
    expect(kept.map((k) => k.record.id)).toEqual(['new', 'old']);
    expect(kept[1]!.opening).toBe('She ran fast.');
    expect(kept[0]!.opening).toBe('x'.repeat(160)); // the first words, not the whole sprint
  });

  it('orders the library by when each sprint was written, not when its record last changed', async () => {
    let now = 1000 * DAY;
    const { s } = store(() => now);
    await s.write({ ...record('early', 'kept'), started: 10 }, writing);
    await s.write({ ...record('late', 'kept'), started: 20 }, writing);
    now += 1000;
    await s.write({ ...record('early', 'kept'), started: 10 }, null); // touched again later
    expect((await s.kept()).map((k) => k.record.id)).toEqual(['late', 'early']);
  });

  it('removes discarded and placed sprints after the keep period, never kept or active ones', async () => {
    let now = 1000 * DAY;
    const { s } = store(() => now);
    for (const [id, status] of [['a', 'active'], ['k', 'kept'], ['p', 'placed'], ['d', 'discarded']] as const) await s.write(record(id, status), writing);
    now += (SPRINT_KEEP_DAYS - 1) * DAY;
    expect(await s.purge()).toBe(0);
    now += 2 * DAY;
    expect(await s.purge()).toBe(2);
    expect((await s.list()).map((r) => r.id).sort()).toEqual(['a', 'k']);
  });

  it('refuses bad ids and invalid writing, and skips unreadable records without deleting them', async () => {
    const { root, s } = store();
    await expect(s.write(record('../x'), writing)).rejects.toThrow();
    await expect(s.write(record('bad'), [{ type: 'paragraph', content: [{ text: 'a\nb' }] }] as Block[])).rejects.toThrow();
    writeFileSync(path.join(root, 'zzz.json'), '{ not json');
    await s.write(record('ok'), writing);
    expect((await s.list()).map((r) => r.id)).toEqual(['ok']);
    expect(readdirSync(root)).toContain('zzz.json');
  });
});
