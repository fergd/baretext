import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export interface Launched {
  app: ElectronApplication;
  page: Page;
  userData: string;
  saveDir: string;
}

/** Launch the real app hidden, with throwaway settings and save directories. */
export async function launch(options: { file?: { name: string; content: string }; settings?: object } = {}): Promise<Launched> {
  const root = mkdtempSync(path.join(os.tmpdir(), 'baretext-e2e-'));
  const userData = path.join(root, 'userData');
  const saveDir = path.join(root, 'manuscripts');
  const { mkdirSync } = await import('node:fs');
  mkdirSync(userData, { recursive: true });
  mkdirSync(saveDir, { recursive: true });
  let settings: object = options.settings ?? {};
  if (options.file) {
    const filePath = path.join(saveDir, options.file.name);
    writeFileSync(filePath, options.file.content);
    settings = { ...settings, lastFile: filePath };
  }
  writeFileSync(path.join(userData, 'settings.json'), JSON.stringify(settings));
  const app = await electron.launch({
    args: [path.join(here, '../../build/main/main.cjs')],
    env: { ...process.env, BARETEXT_HIDDEN: '1', BARETEXT_USER_DATA: userData, BARETEXT_SAVE_DIR: saveDir },
  });
  const page = await app.firstWindow();
  await page.waitForFunction(() => (window as any).__baretext?.model?.());
  return { app, page, userData, saveDir };
}

export const model = (page: Page) => page.evaluate(() => (window as any).__baretext.model());
