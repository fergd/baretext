import { mkdtempSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SnapshotStore, POINT_KEEP } from '../snapshots';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

function store(start = new Date('2026-09-29T09:00:00').getTime()) {
  let now = start;
  const root = mkdtempSync(path.join(os.tmpdir(), 'bt-snap-'));
  const s = new SnapshotStore(root, { now: () => now });
  return { s, root, file: '/books/Novel.md', advance: (ms: number) => { now += ms; } };
}
const objects = (root: string) => readdirSync(path.join(root, readdirSync(root)[0]!, 'objects'));

describe('snapshot store', () => {
  it('takes, lists (newest first), and reads back snapshots', async () => {
    const { s, file, advance } = store();
    await s.take(file, 'one', 1, 'point', 'Opened');
    advance(MIN);
    await s.take(file, 'two words', 2, 'manual', 'Saved snapshot', 'Before rewrite');
    const list = await s.list(file);
    expect(list.map((e) => [e.kind, e.words, e.label ?? null])).toEqual([['manual', 2, 'Before rewrite'], ['point', 1, null]]);
    expect(await s.read(file, list[1]!.id)).toBe('one');
  });

  it('stores identical content once; skips only automatic snapshots identical to the latest', async () => {
    const { s, root, file, advance } = store();
    await s.take(file, 'same', 1, 'point', 'Opened');
    advance(MIN);
    expect(await s.take(file, 'same', 1, 'point', 'Autosave')).toBeNull();
    expect(await s.take(file, 'same', 1, 'point', 'Before Replace All')).not.toBeNull(); // named: always listed
    await s.take(file, 'same', 1, 'manual', 'Saved snapshot');
    expect((await s.list(file)).map((e) => e.reason)).toEqual(['Saved snapshot', 'Before Replace All', 'Opened']);
    expect(objects(root)).toHaveLength(1);
  });

  it('keeps the last 10 point snapshots and removes unreferenced content', async () => {
    const { s, root, file, advance } = store();
    for (let i = 0; i < POINT_KEEP + 5; i++) { await s.take(file, `v${i}`, i, 'point', 'Autosave'); advance(MIN); }
    const list = await s.list(file);
    expect(list).toHaveLength(POINT_KEEP);
    expect(list.at(-1)!.words).toBe(5);
    expect(objects(root)).toHaveLength(POINT_KEEP);
  });

  it('auto: a daily once per day, a point at most every 15 minutes', async () => {
    const { s, file, advance } = store();
    await s.auto(file, 'a', 1);            // first ever: daily + point
    advance(5 * MIN);
    await s.auto(file, 'ab', 2);           // too soon for a point; daily exists
    advance(11 * MIN);
    await s.auto(file, 'abc', 3);          // 16 min since the last point
    advance(DAY);
    await s.auto(file, 'abcd', 4);         // a new day: daily + point
    const kinds = (await s.list(file)).map((e) => `${e.kind}:${e.words}`);
    expect(kinds).toEqual(['point:4', 'daily:4', 'point:3', 'point:1', 'daily:1']);
  });

  it('keeps daily snapshots for 30 days; manual ones until deleted', async () => {
    const { s, file, advance } = store();
    await s.take(file, 'keep me', 2, 'manual', 'Saved snapshot');
    for (let d = 0; d < 35; d++) { await s.take(file, `day ${d}`, d, 'daily', 'Daily'); advance(DAY); }
    const list = await s.list(file);
    expect(list.filter((e) => e.kind === 'daily')).toHaveLength(30);
    expect(list.filter((e) => e.kind === 'manual')).toHaveLength(1);
    await s.remove(file, list.find((e) => e.kind === 'manual')!.id);
    expect((await s.list(file)).some((e) => e.kind === 'manual')).toBe(false);
  });

  it('keeps each manuscript separate, and concurrent writes never corrupt the index', async () => {
    const { s, file } = store();
    await Promise.all(Array.from({ length: 20 }, (_, i) => s.take(file, `c${i}`, i, 'manual', 'Saved snapshot')));
    expect(await s.list(file)).toHaveLength(20);
    expect(await s.list('/books/Other.md')).toEqual([]);
  });

  it('a corrupt index is set aside and the list rebuilt from the stored content', async () => {
    const { s, root, file, advance } = store();
    await s.take(file, 'Some words here', 3, 'manual', 'Saved snapshot');
    const dir = path.join(root, readdirSync(root)[0]!);
    const { writeFileSync } = await import('node:fs');
    writeFileSync(path.join(dir, 'index.json'), '{ not json');
    const recovered = await s.list(file);
    expect(recovered).toHaveLength(1);
    expect(recovered[0]!.kind).toBe('manual'); // recovered entries are kept until deleted
    expect(recovered[0]!.reason).toBe('Recovered');
    expect(await s.read(file, recovered[0]!.id)).toBe('Some words here');
    expect(readdirSync(dir).some((f) => f.startsWith('index.corrupt-'))).toBe(true);
    advance(MIN);
    await s.take(file, 'y', 1, 'manual', 'Saved snapshot');
    expect(await s.list(file)).toHaveLength(2);
  });
});
