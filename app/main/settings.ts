// A small, validated settings file. Unknown or malformed values fall back
// to defaults; the file can never crash startup.

import { promises as fs, readFileSync } from 'node:fs';
import path from 'node:path';
import { atomicWrite } from './save';
import { OUTLINE_STATES, PARAGRAPH_SPACINGS, type OutlineState, type ParagraphSpacing } from '../shared/bridge';

export interface Settings {
  lastFile: string | null;
  recent: string[];
  /** Last caret position per file (document position). */
  carets: Record<string, number>;
  theme: string;
  paragraphSpacing: ParagraphSpacing;
  outline: OutlineState;
  saveDir: string | null;
  /** Where the window was (its normal, unzoomed frame) and how. */
  window: { x: number; y: number; width: number; height: number; maximized: boolean; fullscreen: boolean } | null;
}

export const DEFAULT_SETTINGS: Settings = {
  lastFile: null,
  recent: [],
  carets: {},
  theme: 'dracula',
  paragraphSpacing: 'full',
  outline: 'hidden',
  saveDir: null,
  window: null,
};

const isString = (v: unknown): v is string => typeof v === 'string';

export function validateSettings(raw: unknown): Settings {
  const s = { ...DEFAULT_SETTINGS, carets: {}, recent: [] } as Settings;
  if (!raw || typeof raw !== 'object') return s;
  const r = raw as Record<string, unknown>;
  if (isString(r.lastFile)) s.lastFile = r.lastFile;
  if (Array.isArray(r.recent)) s.recent = r.recent.filter(isString).slice(0, 10);
  if (r.carets && typeof r.carets === 'object') {
    for (const [k, v] of Object.entries(r.carets as Record<string, unknown>)) {
      if (Number.isInteger(v) && (v as number) >= 0) s.carets[k] = v as number;
    }
  }
  if (isString(r.theme) && /^[a-z0-9-]{1,32}$/.test(r.theme)) s.theme = r.theme;
  if (PARAGRAPH_SPACINGS.includes(r.paragraphSpacing as ParagraphSpacing)) s.paragraphSpacing = r.paragraphSpacing as ParagraphSpacing;
  if (OUTLINE_STATES.includes(r.outline as OutlineState)) s.outline = r.outline as OutlineState;
  if (isString(r.saveDir)) s.saveDir = r.saveDir;
  const w = r.window as Record<string, unknown> | null | undefined;
  if (w && typeof w === 'object' && ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(w[k]))) {
    s.window = {
      x: Math.round(w.x as number), y: Math.round(w.y as number),
      width: Math.round(w.width as number), height: Math.round(w.height as number),
      maximized: w.maximized === true, fullscreen: w.fullscreen === true,
    };
  }
  return s;
}

export class SettingsStore {
  private data: Settings;
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly file: string) {
    let raw: unknown = null;
    try { raw = JSON.parse(readFileSync(file, 'utf8')); } catch { /* first run or corrupt */ }
    this.data = validateSettings(raw);
  }

  get(): Settings {
    return this.data;
  }

  update(patch: Partial<Settings>): Settings {
    this.data = validateSettings({ ...this.data, ...patch });
    const snapshot = JSON.stringify(this.data, null, 2);
    this.writing = this.writing
      .then(() => fs.mkdir(path.dirname(this.file), { recursive: true }))
      .then(() => atomicWrite(this.file, snapshot))
      .catch((e) => console.error('settings write failed:', e));
    return this.data;
  }

  flush(): Promise<void> {
    return this.writing;
  }
}
