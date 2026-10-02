// A small, validated settings file. Unknown or malformed values fall back
// to defaults; the file can never crash startup.

import { promises as fs, readFileSync } from 'node:fs';
import path from 'node:path';
import { atomicWrite } from './save';
import { DEFAULT_APPEARANCE, DEFAULT_EXPORT, DEFAULT_SPRINT, validCorkboardLayout, validSprint, type CorkboardLayout, type SprintPrefs, OUTLINE_STATES, validAppearance, validExport, type AppearancePrefs, type ExportPrefs, type OutlineState } from '../shared/bridge';

export interface Settings extends AppearancePrefs {
  lastFile: string | null;
  recent: string[];
  /** Last caret position per file (document position). */
  carets: Record<string, number>;
  outline: OutlineState;
  saveDir: string | null;
  export: ExportPrefs;
  sprint: SprintPrefs;
  corkboardLayout: CorkboardLayout;
  /** Where the last export was saved. */
  exportDir: string | null;
  /** Where the window was (its normal, unzoomed frame) and how. */
  window: { x: number; y: number; width: number; height: number; maximized: boolean; fullscreen: boolean } | null;
}

export const DEFAULT_SETTINGS: Settings = {
  lastFile: null,
  recent: [],
  carets: {},
  ...DEFAULT_APPEARANCE,
  outline: 'hidden',
  saveDir: null,
  export: DEFAULT_EXPORT,
  sprint: DEFAULT_SPRINT,
  corkboardLayout: 'rows',
  exportDir: null,
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
  Object.assign(s, validAppearance(r));
  if (OUTLINE_STATES.includes(r.outline as OutlineState)) s.outline = r.outline as OutlineState;
  if (isString(r.saveDir)) s.saveDir = r.saveDir;
  s.export = validExport(r.export);
  s.sprint = validSprint(r.sprint);
  s.corkboardLayout = validCorkboardLayout(r.corkboardLayout);
  if (isString(r.exportDir)) s.exportDir = r.exportDir;
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
