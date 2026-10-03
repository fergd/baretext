// The manuscript schema. The ProseMirror document *is* the manuscript model:
// structure lives in nodes (chapter, scene), never in characters.

import { Schema, type DOMOutputSpec, type MarkSpec, type NodeSpec } from 'prosemirror-model';

const nodes: Record<string, NodeSpec> = {
  // The book's setup (DECISIONS §26) rides on the document: null = not set.
  doc: {
    content: 'book_title chapter+ cold_storage',
    attrs: { author: { default: null }, structure: { default: null }, target: { default: null } },
  },

  book_title: {
    content: 'text*',
    marks: '',
    defining: true,
    toDOM: (): DOMOutputSpec => ['h1', { class: 'bt-book-title' }, 0],
  },

  chapter: {
    content: 'chapter_title scene+',
    attrs: { id: { default: '', validate: 'string' } },
    isolating: true,
    defining: true,
    toDOM: (n): DOMOutputSpec => ['section', { class: 'bt-chapter', 'data-id': n.attrs.id }, 0],
  },

  chapter_title: {
    content: 'text*',
    marks: '',
    defining: true,
    toDOM: (): DOMOutputSpec => ['h2', { class: 'bt-chapter-title' }, 0],
  },

  scene: {
    // Every scene ends in a paragraph, so there is always a writable line.
    content: 'scene_heading? block* paragraph',
    // origin: Cold Storage only — { chapter, index } it came from (see SceneOrigin).
    // beat: the story beat it is marked as (an id), or null.
    attrs: { id: { default: '', validate: 'string' }, link: { default: null }, origin: { default: null }, beat: { default: null } },
    isolating: true,
    defining: true,
    toDOM: (n): DOMOutputSpec => ['section', { class: 'bt-scene', 'data-id': n.attrs.id }, 0],
  },

  scene_heading: {
    content: 'text*',
    marks: '',
    defining: true,
    toDOM: (): DOMOutputSpec => ['h3', { class: 'bt-scene-heading' }, 0],
  },

  paragraph: {
    content: 'text*',
    group: 'block',
    parseDOM: [{ tag: 'p' }, { tag: 'h1' }, { tag: 'h2' }, { tag: 'h3' }, { tag: 'h4' }, { tag: 'h5' }, { tag: 'h6' }, { tag: 'li' }],
    toDOM: (): DOMOutputSpec => ['p', 0],
  },

  section_break: {
    group: 'block',
    atom: true,
    selectable: false,
    parseDOM: [{ tag: 'hr' }],
    toDOM: (): DOMOutputSpec => [
      'div',
      { class: 'bt-section-break', contenteditable: 'false', 'aria-hidden': 'true' },
      ['span', { class: 'bt-section-break-mark' }],
    ],
  },

  quote: {
    content: 'paragraph+',
    group: 'block',
    defining: true,
    parseDOM: [{ tag: 'blockquote' }],
    toDOM: (): DOMOutputSpec => ['blockquote', { class: 'bt-quote' }, 0],
  },

  // Parked scenes. Hidden, and out of the caret's reach, except the one scene
  // opened on the page (cold.ts); otherwise they change only through commands.
  cold_storage: {
    content: 'scene*',
    selectable: false,
    toDOM: (): DOMOutputSpec => ['div', { class: 'bt-cold-storage' }, 0],
  },

  text: { group: 'inline' },
};

const boldWeight = (value: string) => /^(bold(er)?|[6-9]\d\d)$/.test(value) && null;

const marks: Record<string, MarkSpec> = {
  bold: {
    parseDOM: [
      { tag: 'strong' },
      // Google Docs wraps everything in <b style="font-weight:normal">.
      { tag: 'b', getAttrs: (node) => node.style.fontWeight !== 'normal' && null },
      { style: 'font-weight', getAttrs: (value) => boldWeight(value) },
    ],
    toDOM: () => ['strong', 0],
  },
  italic: {
    parseDOM: [{ tag: 'em' }, { tag: 'i' }, { style: 'font-style=italic' }],
    toDOM: () => ['em', 0],
  },
  // A note's anchor (notes.ts): bookkeeping, never saved in the manuscript
  // (docToModel ignores it). Notes may overlap; typing at an edge doesn't
  // stretch one; no parseDOM, so pasted HTML can't create one.
  note: {
    attrs: { id: { validate: 'string' } },
    inclusive: false,
    excludes: '',
    toDOM: (m) => ['span', { class: 'bt-note-anchor', 'data-note': m.attrs.id }, 0],
  },
  link: {
    attrs: { href: { validate: 'string' } },
    inclusive: false,
    // No parseDOM: pasted links become clean text (spec §4.1).
    toDOM: (m) => ['a', { href: m.attrs.href, rel: 'noopener noreferrer' }, 0],
  },
};

export const schema = new Schema({ nodes, marks });

export const TITLE_TYPES = new Set(['book_title', 'chapter_title', 'scene_heading']);
