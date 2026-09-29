// Dev tool: render the real app hidden and save screenshots for review.
import { launch } from '../test/e2e/launch.ts';
import { sampleFile } from '../test/fixtures/sample.ts';

const out = process.argv[2] ?? 'shot';
const { app, page } = await launch({ file: { name: 'Novel.md', content: sampleFile() }, settings: JSON.parse(process.env.SETTINGS ?? '{}') });
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1100, 760));
const m = await page.evaluate(() => (window as any).__baretext.model());
await page.evaluate((id) => (window as any).__baretext.navigate(id), m.chapters[3].scenes[1].id);
await page.waitForTimeout(400);
if (process.env.SCROLL) await page.evaluate((y) => { document.querySelector('.bt-scroller')!.scrollTop += Number(y); }, process.env.SCROLL);
await page.waitForTimeout(200);
await page.screenshot({ path: `${out}.png` });
await app.close();
