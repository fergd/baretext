import { describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { emptyManuscript, parse, serialize, type Manuscript } from '@baretext/format';
import { fileKey, isDestructive, RECOVERY_KEEP, saveManuscript } from '../save';

const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'bt-save-'));

function book(paragraphs: number, scenes = 1): Manuscript {
  const m = emptyManuscript('Book');
  m.chapters[0]!.id = 'c1'; // fixed identities: the same call makes the same book
  const text = 'A long paragraph of the novel, written over many mornings, that fills the file.';
  m.chapters[0]!.scenes = Array.from({ length: scenes }, (_, i) => ({
    id: `s${i}`, name: `Scene ${i + 1}`, link: null,
    blocks: Array.from({ length: paragraphs }, () => ({ type: 'paragraph' as const, content: [{ text }] })),
  }));
  return m;
}

/** The same book with every word of prose removed (structure kept). */
function emptied(m: Manuscript): Manuscript {
  return { ...m, chapters: m.chapters.map((c) => ({ ...c, scenes: c.scenes.map((s) => ({ ...s, blocks: [{ type: 'paragraph' as const, content: [] }] })) })) };
}

describe('saveManuscript', () => {
  it('writes the manuscript, and the file reads back as the same manuscript', async () => {
    const dir = tmp();
    const file = path.join(dir, 'B.md');
    const m = book(3);
    expect(await saveManuscript(file, m, { recoveryRoot: path.join(dir, 'rec') })).toMatchObject({ ok: true });
    expect(parse(readFileSync(file, 'utf8')).manuscript).toEqual(m);
  });

  it('skips the write when nothing changed', async () => {
    const dir = tmp();
    const file = path.join(dir, 'B.md');
    await saveManuscript(file, book(3), { recoveryRoot: path.join(dir, 'rec') });
    expect(await saveManuscript(file, book(3), { recoveryRoot: path.join(dir, 'rec') })).toMatchObject({ ok: true, skipped: true });
  });

  it('keeps the previous file as a recovery copy before overwriting, and keeps the last 100', async () => {
    const dir = tmp();
    const file = path.join(dir, 'B.md');
    const rec = path.join(dir, 'rec');
    for (let i = 0; i < RECOVERY_KEEP + 5; i++) await saveManuscript(file, book(3 + (i % 2)), { recoveryRoot: rec });
    const copies = readdirSync(path.join(rec, fileKey(file)));
    expect(copies).toHaveLength(RECOVERY_KEEP);
  });

  it('refuses to write something that does not read back as the same manuscript (verify)', async () => {
    const dir = tmp();
    const file = path.join(dir, 'B.md');
    writeFileSync(file, serialize(book(3)));
    const broken = book(3);
    broken.chapters[0]!.scenes[0]!.id = ''; // not a valid manuscript
    const result = await saveManuscript(file, broken, { recoveryRoot: path.join(dir, 'rec') });
    expect(result).toMatchObject({ ok: false, reason: 'verify' });
    expect(readFileSync(file, 'utf8')).toBe(serialize(book(3))); // untouched
  });

  it('refuses a sudden gutting by size; Save anyway (force) writes it', async () => {
    const dir = tmp();
    const file = path.join(dir, 'B.md');
    await saveManuscript(file, book(80), { recoveryRoot: path.join(dir, 'rec') });
    const before = readFileSync(file, 'utf8');
    expect(await saveManuscript(file, emptied(book(80)), { recoveryRoot: path.join(dir, 'rec') })).toMatchObject({ ok: false, reason: 'destructive' });
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(await saveManuscript(file, emptied(book(80)), { recoveryRoot: path.join(dir, 'rec'), force: true })).toMatchObject({ ok: true });
  });

  it('refuses removing (nearly) all the prose even when structure keeps the file large', async () => {
    // 40 named scenes: titles and identities keep the emptied file well above 10% of its size.
    const dir = tmp();
    const file = path.join(dir, 'B.md');
    const m = book(2, 40);
    await saveManuscript(file, m, { recoveryRoot: path.join(dir, 'rec') });
    expect(await saveManuscript(file, emptied(m), { recoveryRoot: path.join(dir, 'rec') })).toMatchObject({ ok: false, reason: 'destructive' });
  });

  it('allows ordinary cutting: a short draft, or removing less than 90% of the prose', async () => {
    const dir = tmp();
    const file = path.join(dir, 'B.md');
    await saveManuscript(file, book(1), { recoveryRoot: path.join(dir, 'rec') });
    expect(await saveManuscript(file, emptied(book(1)), { recoveryRoot: path.join(dir, 'rec') })).toMatchObject({ ok: true }); // a short note
    await saveManuscript(file, book(80), { recoveryRoot: path.join(dir, 'rec') });
    expect(await saveManuscript(file, book(20), { recoveryRoot: path.join(dir, 'rec') })).toMatchObject({ ok: true }); // cut 75%
  });
});

describe('isDestructive (size)', () => {
  it('follows the spec thresholds', () => {
    expect(isDestructive(1024, 0)).toBe(true);
    expect(isDestructive(1023, 0)).toBe(false);
    expect(isDestructive(10_000, 900)).toBe(true);
    expect(isDestructive(10_000, 1100)).toBe(false);
    expect(isDestructive(4096, 256)).toBe(true);
    expect(isDestructive(4095, 10)).toBe(false);
  });
});
