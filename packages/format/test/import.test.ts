import { describe, expect, it } from 'vitest';
import { parse, sceneText, type Manuscript } from '../src';

const shape = (m: Manuscript) =>
  m.chapters.map((c) => ({ title: c.title, scenes: c.scenes.map((s) => ({ name: s.name, text: sceneText(s) })) }));

describe('import (files Baretext did not write)', () => {
  it('turns headings into chapters and scenes, --- rules into scene breaks', () => {
    const r = parse('# One\n\nOpening.\n\n## Named\n\nText.\n\n---\n\nAfter rule.\n\n# Two\n\nMore.\n', 'fallback');
    expect(r.native).toBe(false);
    expect(r.manuscript.title).toBe('fallback');
    expect(shape(r.manuscript)).toEqual([
      { title: 'One', scenes: [{ name: null, text: 'Opening.' }, { name: 'Named', text: 'Text.' }, { name: null, text: 'After rule.' }] },
      { title: 'Two', scenes: [{ name: null, text: 'More.' }] },
    ]);
  });

  it('turns * * * into a pause within the scene; --- and ___ into scene breaks', () => {
    const r = parse('# One\n\nA.\n\n* * *\n\nB.\n\n***\n\nC.\n\n___\n\nD.\n');
    const [first, second] = r.manuscript.chapters[0]!.scenes;
    expect(first!.blocks.map((b) => b.type)).toEqual(['paragraph', 'section_break', 'paragraph', 'section_break', 'paragraph']);
    expect(sceneText(second!)).toBe('D.');
  });

  it('keeps prose before the first heading in an untitled chapter', () => {
    const r = parse('Just some text.\n\nSecond paragraph.');
    expect(shape(r.manuscript)).toEqual([{ title: '', scenes: [{ name: null, text: 'Just some text.\nSecond paragraph.' }] }]);
  });

  // Manuscript convention (and the previous app's): one line is one
  // paragraph, whether or not blank lines separate them.
  it('treats every line as its own paragraph', () => {
    const r = parse('# One\n\nFirst line.\nSecond line with *italic*.\n"Dialogue," she said.\n\nAfter a blank line.');
    const blocks = r.manuscript.chapters[0]!.scenes[0]!.blocks;
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'paragraph', 'paragraph', 'paragraph']);
    expect(sceneText(r.manuscript.chapters[0]!.scenes[0]!)).toBe(
      'First line.\nSecond line with italic.\n"Dialogue," she said.\nAfter a blank line.');
  });

  it('reads plain text without inventing emphasis', () => {
    const r = parse('2 * 3 * 4 = 24\n\nsnake_case_name and file__name__x\n\n* not a list? *');
    const s = r.manuscript.chapters[0]!.scenes[0]!;
    expect(sceneText(s)).toBe('2 * 3 * 4 = 24\nsnake_case_name and file__name__x\n* not a list? *');
    for (const b of s.blocks) if (b.type === 'paragraph') for (const run of b.content) expect(run.bold || run.italic).toBeFalsy();
  });

  it('converts real Markdown emphasis and links into marks', () => {
    const r = parse('A **bold** and *italic* and _also_ and [link](http://x.y "t").');
    const p = r.manuscript.chapters[0]!.scenes[0]!.blocks[0]!;
    expect(p).toEqual({ type: 'paragraph', content: [
      { text: 'A ' }, { text: 'bold', bold: true }, { text: ' and ' }, { text: 'italic', italic: true },
      { text: ' and ' }, { text: 'also', italic: true }, { text: ' and ' }, { text: 'link', link: 'http://x.y' }, { text: '.' },
    ] });
  });

  it('supports setext headings and front matter titles', () => {
    const r = parse('---\ntitle: My Novel\nauthor: Me\n---\nPart\n====\n\nScene\n-----\n\nText');
    expect(r.manuscript.title).toBe('My Novel');
    expect(shape(r.manuscript)).toEqual([{ title: 'Part', scenes: [{ name: 'Scene', text: 'Text' }] }]);
  });

  it('keeps unknown constructs as text instead of dropping them', () => {
    const src = '```js\nconst x = 1;\n```\n\n- item one\n- item two\n\n| a | b |\n\n<div>html</div>';
    const all = sceneText(parse(src).manuscript.chapters[0]!.scenes[0]!);
    for (const piece of ['```js', 'const x = 1;', '- item one', '- item two', '| a | b |', '<div>html</div>']) {
      expect(all).toContain(piece);
    }
  });

  it('handles pathological input', () => {
    for (const src of ['', '\n\n\n', '   ', '#', '---', '---\n---', '﻿# T\r\nCRLF text\r\n', '>', '* * *', '&nbsp;']) {
      const r = parse(src);
      expect(r.manuscript.chapters.length).toBeGreaterThan(0);
      for (const c of r.manuscript.chapters) {
        expect(c.scenes.length).toBeGreaterThan(0);
        for (const s of c.scenes) expect(s.blocks.length).toBeGreaterThan(0);
      }
    }
    expect(shape(parse('﻿# T\r\nCRLF text\r\n').manuscript)).toEqual([{ title: 'T', scenes: [{ name: null, text: 'CRLF text' }] }]);
  });

  it('handles a huge file quickly', () => {
    const para = 'The quick brown fox jumps over the lazy dog, again and again. '.repeat(4);
    const chapters: string[] = [];
    for (let c = 0; c < 40; c++) {
      chapters.push(`# Chapter ${c + 1}`);
      for (let s = 0; s < 5; s++) {
        chapters.push(`## Scene ${s + 1}`);
        for (let p = 0; p < 20; p++) chapters.push(para);
      }
    }
    const src = chapters.join('\n\n');
    const t0 = performance.now();
    const r = parse(src);
    const ms = performance.now() - t0;
    expect(r.manuscript.chapters).toHaveLength(40);
    expect(ms).toBeLessThan(1500);
  });
});
