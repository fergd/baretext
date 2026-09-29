// Presentation that is not content: margin numbers (chapter 6, scene 6.4,
// pause 6.4.1), scene-boundary ornaments, and "Untitled" placeholders. Rebuilt only when structure or
// title emptiness changes; otherwise mapped through edits.

import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { schema } from './schema';
import { structureSignature } from './structure';

function numberWidget(text: string, kind: 'chapter' | 'scene'): HTMLElement {
  const el = document.createElement('span');
  el.className = `bt-num bt-num-${kind}`;
  el.contentEditable = 'false';
  el.setAttribute('aria-hidden', 'true');
  el.textContent = text;
  return el;
}

function sceneBoundaryWidget(label: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'bt-scene-boundary';
  el.contentEditable = 'false';
  el.setAttribute('aria-hidden', 'true');
  const num = document.createElement('span');
  num.className = 'bt-num bt-num-scene';
  num.textContent = label;
  const ornament = document.createElement('span');
  ornament.className = 'bt-scene-ornament';
  el.append(num, ornament);
  return el;
}

function titlesKey(doc: PMNode): string {
  let key = '';
  doc.forEach((top) => {
    if (top.type === schema.nodes.book_title || top.type === schema.nodes.chapter_title) key += top.content.size ? '1' : '0';
    if (top.type === schema.nodes.chapter) {
      top.forEach((c) => {
        if (c.type === schema.nodes.chapter_title) key += c.content.size ? '1' : '0';
        else {
          const first = c.firstChild;
          if (first && first.type === schema.nodes.scene_heading) key += first.content.size ? '1' : '0';
          // Pauses are numbered within their scene: adding or removing one renumbers.
          let pauses = 0;
          c.forEach((b) => { if (b.type === schema.nodes.section_break) pauses++; });
          if (pauses) key += `p${pauses}`;
        }
      });
    }
  });
  return structureSignature(doc) + '|' + key;
}

export interface Placeholders {
  book: string;
  chapter: string;
  scene: string;
}

export function buildDecorations(doc: PMNode, placeholders: Placeholders): DecorationSet {
  const decos: Decoration[] = [];
  const placeholder = (pos: number, node: PMNode, text: string) => {
    if (node.content.size === 0) decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'bt-empty', 'data-placeholder': text }));
  };
  let chapterNo = 0;
  doc.forEach((top, offset) => {
    if (top.type === schema.nodes.book_title) {
      placeholder(offset, top, placeholders.book);
      return;
    }
    if (top.type !== schema.nodes.chapter) return;
    chapterNo++;
    const c = chapterNo;
    let sceneNo = 0;
    top.forEach((child, childOffset) => {
      const pos = offset + 1 + childOffset;
      if (child.type === schema.nodes.chapter_title) {
        placeholder(pos, child, placeholders.chapter);
        decos.push(Decoration.widget(pos + 1, () => numberWidget(String(c), 'chapter'), { side: -1, key: `c${c}`, ignoreSelection: true }));
        return;
      }
      sceneNo++;
      const label = `${c}.${sceneNo}`;
      decos.push(Decoration.node(pos, pos + child.nodeSize, { 'data-scene-number': label }));
      const heading = child.firstChild?.type === schema.nodes.scene_heading ? child.firstChild : null;
      if (heading) {
        placeholder(pos + 1, heading, placeholders.scene);
        decos.push(Decoration.widget(pos + 2, () => numberWidget(label, 'scene'), { side: -1, key: `s${label}`, ignoreSelection: true }));
      } else if (sceneNo > 1) {
        decos.push(Decoration.widget(pos + 1, () => sceneBoundaryWidget(label), { side: -1, key: `b${label}`, ignoreSelection: true }));
      }
      let pauseNo = 0;
      child.forEach((block, blockOffset) => {
        if (block.type !== schema.nodes.section_break) return;
        const at = pos + 1 + blockOffset;
        decos.push(Decoration.node(at, at + block.nodeSize, { 'data-number': `${label}.${++pauseNo}` }));
      });
    });
  });
  return DecorationSet.create(doc, decos);
}

interface DecoState { key: string; set: DecorationSet }

export const structureDecorationsKey = new PluginKey<DecoState>('structureDecorations');

export function structureDecorations(placeholders: Placeholders): Plugin<DecoState> {
  return new Plugin<DecoState>({
    key: structureDecorationsKey,
    state: {
      init: (_, state) => ({ key: titlesKey(state.doc), set: buildDecorations(state.doc, placeholders) }),
      apply(tr, prev) {
        if (!tr.docChanged) return prev;
        const key = titlesKey(tr.doc);
        if (key === prev.key) return { key, set: prev.set.map(tr.mapping, tr.doc) };
        return { key, set: buildDecorations(tr.doc, placeholders) };
      },
    },
    props: {
      decorations: (state) => structureDecorationsKey.getState(state)?.set,
    },
  });
}
