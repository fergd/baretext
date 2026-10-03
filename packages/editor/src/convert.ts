// Manuscript model ⇄ ProseMirror document. Lossless in both directions for
// valid manuscripts (scenes are normalized to end in a paragraph on load).

import type { Mark, Node as PMNode } from 'prosemirror-model';
import { bookSetup, normalizeRuns, type Block, type Chapter, type Manuscript, type Run, type Scene } from '@baretext/format';
import { schema } from './schema';

function runsToNodes(runs: readonly Run[]): PMNode[] {
  return normalizeRuns(runs).map((r) => {
    const marks: Mark[] = [];
    if (r.bold) marks.push(schema.marks.bold!.create());
    if (r.italic) marks.push(schema.marks.italic!.create());
    if (r.link) marks.push(schema.marks.link!.create({ href: r.link }));
    return schema.text(r.text, marks);
  });
}

const paragraph = (runs: readonly Run[]) => schema.nodes.paragraph!.create(null, runsToNodes(runs));
const plain = (text: string) => (text ? [schema.text(text)] : []);

function blockToNode(b: Block): PMNode {
  switch (b.type) {
    case 'paragraph':
      return paragraph(b.content);
    case 'section_break':
      return schema.nodes.section_break!.create();
    case 'quote':
      return schema.nodes.quote!.create(null, (b.paragraphs.length ? b.paragraphs : [[]]).map(paragraph));
  }
}

export function sceneToNode(s: Scene): PMNode {
  const content: PMNode[] = [];
  if (s.name !== null) content.push(schema.nodes.scene_heading!.create(null, plain(s.name)));
  for (const b of s.blocks) content.push(blockToNode(b));
  if (content.length === 0 || content[content.length - 1]!.type !== schema.nodes.paragraph) {
    content.push(paragraph([]));
  }
  return schema.nodes.scene!.create({ id: s.id, link: s.link, origin: s.origin ?? null, beat: s.beat ?? null }, content);
}

export function chapterToNode(c: Chapter): PMNode {
  return schema.nodes.chapter!.create({ id: c.id }, [
    schema.nodes.chapter_title!.create(null, plain(c.title)),
    ...c.scenes.map(sceneToNode),
  ]);
}

export function modelToDoc(m: Manuscript): PMNode {
  const { author = null, structure = null, target = null } = bookSetup(m);
  const doc = schema.nodes.doc!.create({ author, structure, target }, [
    schema.nodes.book_title!.create(null, plain(m.title)),
    ...m.chapters.map(chapterToNode),
    schema.nodes.cold_storage!.create(null, m.coldStorage.map(sceneToNode)),
  ]);
  doc.check();
  return doc;
}

export function nodeToRuns(textblock: PMNode): Run[] {
  const runs: Run[] = [];
  textblock.forEach((child) => {
    const r: Run = { text: child.text ?? '' };
    for (const mark of child.marks) {
      if (mark.type.name === 'bold') r.bold = true;
      else if (mark.type.name === 'italic') r.italic = true;
      else if (mark.type.name === 'link') r.link = mark.attrs.href;
    }
    runs.push(r);
  });
  return normalizeRuns(runs);
}

export function nodeToScene(node: PMNode): Scene {
  let name: string | null = null;
  const blocks: Block[] = [];
  node.forEach((child) => {
    switch (child.type.name) {
      case 'scene_heading':
        name = child.textContent;
        break;
      case 'paragraph':
        blocks.push({ type: 'paragraph', content: nodeToRuns(child) });
        break;
      case 'section_break':
        blocks.push({ type: 'section_break' });
        break;
      case 'quote': {
        const paragraphs: Run[][] = [];
        child.forEach((p) => paragraphs.push(nodeToRuns(p)));
        blocks.push({ type: 'quote', paragraphs });
        break;
      }
    }
  });
  const scene: Scene = { id: node.attrs.id, name, link: node.attrs.link ?? null, blocks };
  if (node.attrs.origin) scene.origin = { ...node.attrs.origin };
  if (node.attrs.beat) scene.beat = node.attrs.beat;
  return scene;
}

export function docToModel(doc: PMNode): Manuscript {
  let title = '';
  const chapters: Chapter[] = [];
  const coldStorage: Scene[] = [];
  doc.forEach((child) => {
    if (child.type.name === 'book_title') title = child.textContent;
    else if (child.type.name === 'chapter') {
      const scenes: Scene[] = [];
      let chapterTitle = '';
      child.forEach((c) => {
        if (c.type.name === 'chapter_title') chapterTitle = c.textContent;
        else scenes.push(nodeToScene(c));
      });
      chapters.push({ id: child.attrs.id, title: chapterTitle, scenes });
    } else if (child.type.name === 'cold_storage') {
      child.forEach((s) => coldStorage.push(nodeToScene(s)));
    }
  });
  const { author, structure, target } = doc.attrs;
  return { title, ...bookSetup({ author: author ?? undefined, structure: structure ?? undefined, target: target ?? undefined }), chapters, coldStorage };
}
