// The command palette's lists (⌘K, ⌘⇧O). Targeted: only what exists and
// applies right now. Features add their commands here as they are built.

import type { EditorView } from 'prosemirror-view';
import { hasFormattableText } from '@baretext/editor';
import type { MenuCommand } from '../shared/bridge';
import { currentScene, outlineOf, sceneDisplayName } from './outline';
import type { PaletteItem, PaletteView } from './palette';

export interface CommandContext {
  view(): EditorView | null;
  run(command: MenuCommand): void;
  navigate(sceneId: string): void;
  /** Switch the palette to another list. */
  open(view: PaletteView): void;
  isOn(toggle: 'outline' | 'typewriter' | 'focus'): boolean;
  fileCommand(command: 'new' | 'open'): void;
  reveal(): void;
  /** The parked scene open on the page, if any. */
  parked(): string | null;
  leaveParked(): void;
  restoreParked(): void;
}

export function commandsView(ctx: CommandContext): PaletteView {
  return {
    name: 'commands',
    placeholder: 'Type a command',
    items: () => {
      const view = ctx.view();
      const selection = view ? hasFormattableText(view.state) : false;
      const items: PaletteItem[] = [
        { id: 'goto', group: 'Navigate', label: 'Go to chapter or scene…', keywords: 'jump navigate', keys: '⌘⇧O', keepOpen: true, run: () => ctx.open(jumpView(ctx)) },
        { id: 'find', group: 'Navigate', label: 'Find…', keywords: 'search text', keys: '⌘F', run: () => ctx.run('find') },
        { id: 'find-replace', group: 'Navigate', label: 'Find and replace…', keywords: 'search substitute change', keys: '⌥⌘F', run: () => ctx.run('find-replace') },
        { id: 'scene-break', group: 'Insert', label: 'Scene break', keywords: 'split new scene', keys: '⌘↵', run: () => ctx.run('split-scene') },
        { id: 'new-chapter', group: 'Insert', label: 'New chapter', keywords: 'add create chapter', run: () => ctx.run('new-chapter') },
        { id: 'pause', group: 'Insert', label: 'Pause', keywords: 'section break within scene', keys: '⌘⇧↵', run: () => ctx.run('pause') },
      ];
      const here = view ? currentScene(view.state) : null;
      if (here) {
        items.push({ id: 'name-scene', group: 'Insert', label: here.scene.name ? 'Rename scene' : 'Name scene', keywords: 'title heading rename scene name', run: () => ctx.run('name-scene') });
        items.push({ id: 'park-scene', group: 'Insert', label: 'Move scene to Cold Storage', keywords: 'park cut archive set aside cold storage', run: () => ctx.run('park-scene') });
      }
      if (ctx.parked()) {
        items.unshift(
          { id: 'leave-parked', group: 'Cold Storage', label: 'Back to manuscript', keywords: 'return close cold storage', keys: 'Esc', run: () => ctx.leaveParked() },
          { id: 'restore-parked', group: 'Cold Storage', label: 'Restore this scene', keywords: 'put back unpark cold storage', run: () => ctx.restoreParked() },
        );
      }
      if (selection) {
        items.push(
          { id: 'bold', group: 'Format', label: 'Bold', keys: '⌘B', run: () => ctx.run('bold') },
          { id: 'italic', group: 'Format', label: 'Italic', keys: '⌘I', run: () => ctx.run('italic') },
          { id: 'quote', group: 'Format', label: 'Quote', keywords: 'epigraph blockquote', run: () => ctx.run('quote') },
          { id: 'link', group: 'Format', label: 'Link…', keywords: 'url web address', run: () => ctx.run('link') },
        );
      }
      items.push(
        { id: 'outline', group: 'View', label: 'Outline', keywords: 'sidebar chapters scenes tree navigator', keys: '⌘\\', state: ctx.isOn('outline') ? 'on' : 'off', run: () => ctx.run('outline') },
        { id: 'typewriter', group: 'View', label: 'Typewriter mode', keywords: 'center line', keys: '⌘⇧T', state: ctx.isOn('typewriter') ? 'on' : 'off', run: () => ctx.run('typewriter') },
        { id: 'focus', group: 'View', label: 'Focus mode', keywords: 'hide chrome distraction quiet', keys: '⌘.', state: ctx.isOn('focus') ? 'on' : 'off', run: () => ctx.run('focus') },
        { id: 'appearance', group: 'View', label: 'Appearance…', keywords: 'settings preferences theme dark light contrast font serif sans mono size spacing width wide narrow style', keys: '⌘,', run: () => ctx.run('appearance') },
        { id: 'new', group: 'File', label: 'New manuscript', keywords: 'create file', keys: '⌘N', run: () => ctx.fileCommand('new') },
        { id: 'open', group: 'File', label: 'Open…', keywords: 'file', keys: '⌘O', run: () => ctx.fileCommand('open') },
        { id: 'save', group: 'File', label: 'Save', keys: '⌘S', run: () => ctx.run('save') },
        { id: 'history', group: 'File', label: 'History…', keywords: 'versions snapshots restore backup earlier', run: () => ctx.run('history') },
        { id: 'snapshot', group: 'File', label: 'Save snapshot…', keywords: 'version backup checkpoint', run: () => ctx.run('snapshot') },
        { id: 'reveal', group: 'File', label: 'Reveal in Finder', keywords: 'show file folder', run: () => ctx.reveal() },
      );
      return items;
    },
  };
}

export function jumpView(ctx: CommandContext): PaletteView {
  const view = ctx.view();
  const doc = view?.state.doc;
  const here = view ? currentScene(view.state) : null;
  return {
    name: 'jump',
    placeholder: 'Go to chapter or scene',
    initialId: here ? `scene-${here.scene.id}` : null,
    back: () => commandsView(ctx),
    items: () => {
      if (!doc) return [];
      const items: PaletteItem[] = [];
      for (const chapter of outlineOf(doc).chapters) {
        const title = chapter.title || 'Untitled';
        const first = chapter.scenes[0];
        items.push({
          id: `chapter-${chapter.id}`, group: 'Chapters', label: `${chapter.number} ${title}`,
          run: () => { if (first) ctx.navigate(first.id); },
        });
        for (const scene of chapter.scenes) {
          items.push({
            id: `scene-${scene.id}`, group: 'Chapters', label: `${scene.label} ${sceneDisplayName(scene)}`,
            keywords: title, depth: 1, state: scene.id === here?.scene.id ? 'current' : undefined,
            run: () => ctx.navigate(scene.id),
          });
        }
      }
      return items;
    },
  };
}
