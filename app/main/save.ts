// The save pipeline (spec §10): serialize → verify round trip → refuse
// destructive saves → keep a recovery copy → atomic write.

import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { manuscriptWords, parse, verifyRoundTrip, type Manuscript } from '@baretext/format';

export const RECOVERY_KEEP = 100;

export type SaveResult =
  | { ok: true; bytes: number; skipped?: boolean }
  | { ok: false; reason: 'verify' | 'destructive' | 'io'; message: string };

/** A sudden gutting of an existing file is refused (spec §10.4). */
export function isDestructive(oldBytes: number, newBytes: number): boolean {
  if (oldBytes >= 1024 && newBytes === 0) return true;
  if (oldBytes >= 4096 && newBytes <= Math.max(256, oldBytes * 0.1)) return true;
  return false;
}

/**
 * The same guard measured in prose: removing 90% or more of a manuscript's
 * words at once. (Titles and identities keep a short or many-scened book's
 * file large even when every word of prose is gone, so size alone misses it.)
 */
export function isGutted(oldWords: number, newWords: number): boolean {
  return oldWords >= 100 && newWords <= oldWords * 0.1;
}

/** Word counts of what we last wrote or read, so the previous file is parsed at most once. */
const knownWords = new Map<string, { data: Buffer; words: number }>();

function wordsIn(filePath: string, data: Buffer): number | null {
  const known = knownWords.get(filePath);
  if (known?.data.equals(data)) return known.words;
  try {
    const words = manuscriptWords(parse(data.toString('utf8')).manuscript);
    knownWords.set(filePath, { data, words });
    return words;
  } catch {
    return null; // not a manuscript we can read: the size guard still applies
  }
}

export function fileKey(filePath: string): string {
  const base = path.basename(filePath).replace(/[^\w.-]+/g, '_').slice(0, 40);
  return `${base}-${createHash('sha256').update(path.resolve(filePath)).digest('hex').slice(0, 12)}`;
}

async function readIfExists(filePath: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(filePath);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

async function keepRecoveryCopy(recoveryRoot: string, filePath: string, previous: Buffer): Promise<void> {
  const dir = path.join(recoveryRoot, fileKey(filePath));
  await fs.mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await fs.writeFile(path.join(dir, `${stamp}-${randomBytes(3).toString('hex')}.md`), previous);
  const entries = (await fs.readdir(dir)).filter((f) => f.endsWith('.md')).sort();
  for (const old of entries.slice(0, Math.max(0, entries.length - RECOVERY_KEEP))) {
    await fs.rm(path.join(dir, old), { force: true });
  }
}

/** Write via a temporary sibling, fsync, then rename over the original. */
export async function atomicWrite(filePath: string, data: string | Buffer): Promise<void> {
  const dir = path.dirname(filePath);
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
  const handle = await fs.open(tmp, 'w', 0o644);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fs.rename(tmp, filePath);
  } catch (e) {
    await fs.rm(tmp, { force: true });
    throw e;
  }
  try {
    const dirHandle = await fs.open(dir, 'r');
    try { await dirHandle.sync(); } finally { await dirHandle.close(); }
  } catch { /* directory fsync is best-effort on some filesystems */ }
}

export interface SaveOptions {
  recoveryRoot: string;
  /** Skip the destructive-save guard (only after explicit user confirmation). */
  force?: boolean;
}

export async function saveManuscript(filePath: string, manuscript: Manuscript, options: SaveOptions): Promise<SaveResult> {
  let text: string;
  try {
    text = verifyRoundTrip(manuscript);
  } catch (e) {
    return { ok: false, reason: 'verify', message: (e as Error).message };
  }
  const data = Buffer.from(text, 'utf8');
  try {
    const previous = await readIfExists(filePath);
    if (previous && previous.equals(data)) return { ok: true, bytes: data.length, skipped: true };
    const gutting = previous && !options.force &&
      (isDestructive(previous.length, data.length) || isGutted(wordsIn(filePath, previous) ?? 0, manuscriptWords(manuscript)));
    if (gutting) {
      return { ok: false, reason: 'destructive', message: 'Save refused: this change removes most of the manuscript. Your text is safe in the app.' };
    }
    if (previous) await keepRecoveryCopy(options.recoveryRoot, filePath, previous);
    await atomicWrite(filePath, data);
    knownWords.set(filePath, { data, words: manuscriptWords(manuscript) });
    return { ok: true, bytes: data.length };
  } catch (e) {
    return { ok: false, reason: 'io', message: (e as Error).message };
  }
}
