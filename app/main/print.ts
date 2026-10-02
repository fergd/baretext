// Printing (DECISIONS §23): the manuscript, laid out by the format package,
// rendered in a hidden window (no scripts) and handed to the macOS print
// dialog — which also saves it as a PDF. Written to a temporary file first:
// a long book is past what a URL can carry.

import { BrowserWindow } from 'electron';
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PrintResult } from '../shared/bridge';
import { atomicWrite } from './save';

/** Tests only: write the PDF here instead of showing the print dialog. */
const PRINT_TO = process.env.BARETEXT_PRINT_TO;

export async function printPage(page: string): Promise<PrintResult> {
  const file = path.join(os.tmpdir(), `baretext-print-${randomBytes(6).toString('hex')}.html`);
  const win = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true, contextIsolation: true } });
  try {
    await fs.writeFile(file, page, 'utf8');
    await win.loadFile(file);
    if (PRINT_TO) {
      await atomicWrite(PRINT_TO, await win.webContents.printToPDF({ preferCSSPageSize: true }));
      return { ok: true };
    }
    return await new Promise<PrintResult>((resolve) => {
      win.webContents.print({ printBackground: false }, (success, reason) => {
        if (success) resolve({ ok: true });
        else if (/cancel/i.test(reason)) resolve({ ok: false, canceled: true });
        else resolve({ ok: false, message: reason });
      });
    });
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  } finally {
    win.destroy();
    await fs.rm(file, { force: true });
  }
}
