// The writer's manuscripts, for choosing where a sprint goes (DECISIONS §21):
// the open one first, then the recent ones, each named by its title. Only a
// file's head is read for the list; a chosen book's chapters need a full,
// read-only parse. Nothing here ever writes.

import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { parse, peekTitle } from '@baretext/format';
import type { BookInfo } from '../shared/bridge';

/** Enough of a file to hold its front matter. */
const HEAD_BYTES = 8192;

const fallbackTitle = (filePath: string) => path.basename(filePath, path.extname(filePath));

async function headOf(filePath: string): Promise<string> {
  const handle = await fs.open(filePath, 'r');
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(HEAD_BYTES), 0, HEAD_BYTES, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

/** A manuscript as the chooser names it; null if it can't be read. */
export async function bookInfo(filePath: string, current = false): Promise<BookInfo | null> {
  try {
    return { path: filePath, title: peekTitle(await headOf(filePath)) || fallbackTitle(filePath), current };
  } catch {
    return null;
  }
}

/** The open manuscript, then the recent ones that still exist (each once). */
export async function listBooks(current: string | null, recent: readonly string[]): Promise<BookInfo[]> {
  const paths = [...new Set([current, ...recent].filter((p): p is string => !!p && existsSync(p)))];
  const books = await Promise.all(paths.map((p) => bookInfo(p, p === current)));
  return books.filter((b): b is BookInfo => b !== null);
}

/** A manuscript's chapter titles, in order; null if it can't be read. */
export async function bookChapters(filePath: string): Promise<string[] | null> {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    return parse(text, fallbackTitle(filePath)).manuscript.chapters.map((c) => c.title);
  } catch {
    return null;
  }
}
