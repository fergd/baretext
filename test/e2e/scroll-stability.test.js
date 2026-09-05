import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchApp } from './harness.js';

const fixtureContent = Array.from({ length: 800 }, (_, index) => {
  if (index % 20 === 0) return `# Chapter ${index / 20 + 1}`;
  if (index % 7 === 0) return `---\n\nScene ${index} begins with **formatted prose** and enough words to exercise normal manuscript layout.`;
  return `Paragraph ${index} contains ordinary manuscript prose, an *emphasized phrase*, and enough additional words to wrap naturally in the editor.`;
}).join('\n\n');

const singleNewlineParagraphs = '# Chapter\n\nFirst paragraph.\nSecond paragraph.\nThird paragraph.';

describe('Baretext E2E: manual manuscript scrolling is authoritative', () => {
  let app;

  before(async () => {
    app = await launchApp({
      fixtureContent,
      mode: 'editor',
      extraSettings: { typewriter: true, lastCursorPos: 0 },
    });
  });

  after(async () => {
    if (app) await app.close();
  });

  test('repeated wheel scrolling never snaps back to the caret or another scene', async () => {
    const point = await app.client.evaluate(`
      await new Promise(r => setTimeout(r, 500));
      const scroller = document.querySelector('.cm-scroller');
      scroller.scrollTop = 0;
      await new Promise(r => requestAnimationFrame(r));
      const rect = scroller.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    `);

    const positions = [];
    for (let i = 0; i < 8; i++) {
      await app.client.mouseWheel(point.x, point.y, 320);
      await new Promise((r) => setTimeout(r, 45));
      positions.push(await app.client.evaluate(`return document.querySelector('.cm-scroller').scrollTop;`));
    }
    await new Promise((r) => setTimeout(r, 800));
    const settled = await app.client.evaluate(`return document.querySelector('.cm-scroller').scrollTop;`);

    assert.ok(positions.at(-1) > 500, `wheel input did not move through enough manuscript: ${positions}`);
    for (let i = 1; i < positions.length; i++) {
      assert.ok(positions[i] >= positions[i - 1] - 2, `scroll reversed unexpectedly: ${positions}`);
    }
    assert.ok(Math.abs(settled - positions.at(-1)) < 3,
      `viewport snapped after scrolling stopped: last=${positions.at(-1)}, settled=${settled}`);

    const bottom = await app.client.evaluate(`
      const scroller = document.querySelector('.cm-scroller');
      scroller.scrollTop = scroller.scrollHeight;
      await new Promise(r => setTimeout(r, 300));
      const visible = [...document.querySelectorAll('.cm-line')]
        .filter(line => {
          const rect = line.getBoundingClientRect();
          return rect.bottom > 0 && rect.top < innerHeight;
        })
        .map(line => line.innerText)
        .join('\\n');
      return {
        scrollTop: scroller.scrollTop,
        max: scroller.scrollHeight - scroller.clientHeight,
        visible,
        paragraphSpacers: document.querySelectorAll('.cm-block-spacer-paragraph').length,
      };
    `);
    assert.ok(Math.abs(bottom.scrollTop - bottom.max) < 3, 'scrolling to the manuscript end must stay at the end');
    assert.ok(!bottom.visible.includes('**'), 'Pretty view must remain rendered in far-off virtualized content');
    assert.ok(bottom.paragraphSpacers > 0, 'far-off paragraphs must retain their bottom spacing');

    const scrollbarSamples = await app.client.evaluate(`
      const scroller = document.querySelector('.cm-scroller');
      const samples = [];
      for (let i = 0; i <= 30; i++) {
        scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) * (i / 30);
        await new Promise(r => setTimeout(r, 60));
        const bounds = scroller.getBoundingClientRect();
        const visibleLines = [...document.querySelectorAll('.cm-line')].filter(line => {
          const rect = line.getBoundingClientRect();
          return rect.bottom > bounds.top && rect.top < bounds.bottom;
        }).length;
        samples.push({ fraction: i / 30, visibleLines, height: scroller.scrollHeight });
      }
      return samples;
    `);
    assert.deepEqual(
      scrollbarSamples.filter(sample => sample.visibleLines === 0),
      [],
      `scrollbar entered a blank virtualized region: ${JSON.stringify(scrollbarSamples)}`,
    );
  });

  test('paragraph rhythm uses measured block spacing, never line padding or margins', async () => {
    const spacing = await app.client.evaluate(`
      const paragraphLine = document.querySelector('.cm-paragraph-line');
      const spacer = document.querySelector('.cm-block-spacer-paragraph');
      const lineStyle = getComputedStyle(paragraphLine);
      const spacerStyle = getComputedStyle(spacer);
      return {
        linePaddingBottom: lineStyle.paddingBottom,
        lineMarginBottom: lineStyle.marginBottom,
        spacerHeight: spacer.getBoundingClientRect().height,
        spacerDisplay: spacerStyle.display,
      };
    `);
    assert.equal(spacing.linePaddingBottom, '0px');
    assert.equal(spacing.lineMarginBottom, '0px');
    assert.equal(spacing.spacerDisplay, 'block');
    assert.ok(spacing.spacerHeight >= 14, `paragraph gap was only ${spacing.spacerHeight}px`);
  });
});

describe('Baretext E2E: hidden Cold Storage creates no phantom scroll region', () => {
  let app;

  before(async () => {
    const manuscript = Array.from({ length: 160 }, (_, index) =>
      `Main manuscript paragraph ${index} remains visible and scrollable.`
    ).join('\n\n');
    const parked = Array.from({ length: 900 }, (_, index) =>
      `Cold Storage paragraph ${index} must contribute no visible height.`
    ).join('\n\n');
    app = await launchApp({
      fixtureContent: `# Main Chapter\n\n${manuscript}\n\n<!-- COLD STORAGE -->\n\n---\n\n${parked}`,
      mode: 'editor',
    });
  });

  after(async () => {
    if (app) await app.close();
  });

  test('the bottom of the scrollbar is the final manuscript paragraph, not concealed content', async () => {
    const result = await app.client.evaluate(`
      const scroller = document.querySelector('.cm-scroller');
      scroller.scrollTop = scroller.scrollHeight;
      await new Promise(r => setTimeout(r, 500));
      return {
        top: scroller.scrollTop,
        max: scroller.scrollHeight - scroller.clientHeight,
        text: document.querySelector('.cm-content').innerText,
        renderedLines: document.querySelectorAll('.cm-line').length,
      };
    `);
    assert.ok(Math.abs(result.top - result.max) < 3);
    assert.ok(result.text.includes('Main manuscript paragraph 159'));
    assert.ok(!result.text.includes('Cold Storage paragraph'));
    assert.ok(result.renderedLines > 0, 'the viewport must never become an empty phantom region');
  });
});

describe('Baretext E2E: single-newline prose retains paragraph rhythm', () => {
  let app;

  before(async () => {
    app = await launchApp({ fixtureContent: singleNewlineParagraphs, mode: 'editor' });
  });

  after(async () => {
    if (app) await app.close();
  });

  test('each prose source line gets its own measured bottom gap', async () => {
    const result = await app.client.evaluate(`
      return {
        proseLines: document.querySelectorAll('.cm-paragraph-line').length,
        spacers: document.querySelectorAll('.cm-block-spacer-paragraph').length,
        heights: [...document.querySelectorAll('.cm-block-spacer-paragraph')]
          .map(spacer => spacer.getBoundingClientRect().height),
      };
    `);
    assert.equal(result.proseLines, 3);
    assert.equal(result.spacers, 3);
    assert.ok(result.heights.every(height => height >= 14));
  });
});
