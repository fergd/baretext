// Copy a scene, a chapter or a group of scenes as text (spec §8.6, DECISIONS
// §28): to paste into an email body, a message or a document — rich text with
// a plain fallback, never the app's bookkeeping.

import { nodeToScene } from '@baretext/editor';
import { passageClipboard, sceneClipboard } from '@baretext/format';
import type { EditorView } from 'prosemirror-view';
import type { BaretextBridge } from '../shared/bridge';
import { outlineOf, type SceneEntry } from './outline';
import type { ToastKind } from './status';

export interface PassageCopyHost {
  bridge: BaretextBridge;
  view(): EditorView | null;
  toast(message: string, kind?: ToastKind): void;
}

const quoted = (name: string | null | undefined) => (name ? ` “${name}”` : '');

export class PassageCopy {
  constructor(private readonly h: PassageCopyHost) {}

  readonly scene = (id: string) => {
    const scene = this.find((o) => o.chapters.flatMap((c) => c.scenes).find((s) => s.id === id));
    if (!scene) return;
    const { html, text } = sceneClipboard(scene.name || `Scene ${scene.label}`, this.blocks(scene));
    void this.put(html, text, `${scene.label}${quoted(scene.name)}`);
  };

  readonly chapter = (id: string) => {
    const chapter = this.find((o) => o.chapters.find((c) => c.id === id));
    if (!chapter) return;
    const { html, text } = passageClipboard(`Chapter ${chapter.number}${chapter.title ? `: ${chapter.title}` : ''}`, this.scenes(chapter.scenes));
    void this.put(html, text, `chapter ${chapter.number}${quoted(chapter.title)}`);
  };

  /** A group of scenes (named or not): its scenes' text. */
  readonly group = (sceneIds: readonly string[], name: string | null) => {
    const all = this.find((o) => o.chapters.flatMap((c) => c.scenes)) ?? [];
    const scenes = all.filter((s) => sceneIds.includes(s.id));
    if (!scenes.length) return;
    const { html, text } = passageClipboard(name, this.scenes(scenes));
    void this.put(html, text, name ? `“${name}”` : `${scenes[0]!.label}–${scenes.at(-1)!.label}`);
  };

  private find<T>(pick: (outline: ReturnType<typeof outlineOf>) => T | undefined): T | undefined {
    const view = this.h.view();
    return view ? pick(outlineOf(view.state.doc)) : undefined;
  }

  private blocks(scene: SceneEntry) {
    return nodeToScene(this.h.view()!.state.doc.nodeAt(scene.pos)!).blocks;
  }

  private scenes(scenes: readonly SceneEntry[]) {
    return scenes.map((s) => ({ name: s.name, blocks: this.blocks(s) }));
  }

  private async put(html: string, text: string, what: string) {
    if (await this.h.bridge.copyRich(html, text)) this.h.toast(`Copied ${what}.`);
    else this.h.toast('Couldn’t copy it.', 'error');
  }
}

