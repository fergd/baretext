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
  isOn(toggle: 'outline' | 'corkboard' | 'typewriter' | 'focus'): boolean;
  fileCommand(command: 'new' | 'open'): void;
  reveal(): void;
  /** The parked scene open on the page, if any. */
  parked(): string | null;
  mode(): 'manuscript' | 'sprinter';
  timer(): { running: boolean; paused: boolean; hidden: boolean };
  leaveParked(): void;
  restoreParked(): void;
}

/** Items both lists offer (Manuscript's and Sprinter's), defined once. */
const typewriterItem = (ctx: CommandContext): PaletteItem => ({ id: 'typewriter', group: 'View', label: 'Typewriter mode', keywords: 'center line', keys: '⌘⇧T', state: ctx.isOn('typewriter') ? 'on' : 'off', run: () => ctx.run('typewriter') });
const focusItem = (ctx: CommandContext): PaletteItem => ({ id: 'focus', group: 'View', label: 'Focus mode', keywords: 'hide chrome distraction quiet', keys: '⌘.', state: ctx.isOn('focus') ? 'on' : 'off', run: () => ctx.run('focus') });
const saveItem = (ctx: CommandContext): PaletteItem => ({ id: 'save', group: 'File', label: 'Save', keys: '⌘S', run: () => ctx.run('save') });
const pauseItem = (ctx: CommandContext): PaletteItem => ({ id: 'pause', group: 'Insert', label: 'Pause', keywords: 'section break within scene', keys: '⌘⇧↵', run: () => ctx.run('pause') });

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
        pauseItem(ctx),
        { id: 'chapter-break', group: 'Insert', label: 'Chapter break', keywords: 'split new chapter', keys: '⌥⌘↵', run: () => ctx.run('split-chapter') },
      ];
      const here = view ? currentScene(view.state) : null;
      if (here) {
        items.push({ id: 'name-scene', group: 'Insert', label: here.scene.name ? 'Rename scene' : 'Name scene', keywords: 'title heading rename scene name', run: () => ctx.run('name-scene') });
        items.push({ id: 'park-scene', group: 'Insert', label: 'Move scene to Cold Storage', keywords: 'park cut archive set aside cold storage', run: () => ctx.run('park-scene') });
      }
      if (ctx.mode() === 'sprinter') {
        // Sprinter: writing, and the way out.
        return [
          { id: 'end-sprint', group: 'Sprint', label: 'End sprint…', keywords: 'stop finish done keep leave sprinter manuscript', keys: '⌘⇧D', run: () => ctx.run('mode') },
          ...(ctx.timer().running ? [{ id: 'sprint-pause', group: 'Sprint', label: ctx.timer().paused ? 'Resume timer' : 'Pause timer', keywords: 'stop hold break timer clock', run: () => ctx.run('sprint-pause') }] : []),
          { id: 'sprint-hide', group: 'Sprint', label: ctx.timer().hidden ? 'Show timer' : 'Hide timer', keywords: 'timer line progress clock', keys: '⌘⇧H', run: () => ctx.run('sprint-hide') },
          pauseItem(ctx),
          typewriterItem(ctx),
          focusItem(ctx),
          saveItem(ctx),
        ];
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
        { id: 'sprints', group: 'View', label: 'Sprints…', keywords: 'kept sprints library warm-ups exercises saved', run: () => ctx.run('sprints') },
        { id: 'sprint', group: 'View', label: 'Sprint…', keywords: 'sprinter timer word target pomodoro write session mode', keys: '⌘⇧S', run: () => ctx.run('sprint') },
        { id: 'outline', group: 'View', label: 'Outline', keywords: 'sidebar chapters scenes tree navigator', keys: '⌘\\', state: ctx.isOn('outline') ? 'on' : 'off', run: () => ctx.run('outline') },
        { id: 'corkboard', group: 'View', label: 'Corkboard', keywords: 'cards scenes board structure overview index cards', keys: '⌘⇧C', state: ctx.isOn('corkboard') ? 'on' : 'off', run: () => ctx.run('corkboard') },
        typewriterItem(ctx),
        focusItem(ctx),
        { id: 'appearance', group: 'View', label: 'Appearance…', keywords: 'settings preferences theme dark light contrast font serif sans mono size spacing width wide narrow style', keys: '⌘,', run: () => ctx.run('appearance') },
        { id: 'new', group: 'File', label: 'New manuscript', keywords: 'create file', keys: '⌘N', run: () => ctx.fileCommand('new') },
        { id: 'open', group: 'File', label: 'Open…', keywords: 'file', keys: '⌘O', run: () => ctx.fileCommand('open') },
        saveItem(ctx),
        { id: 'history', group: 'File', label: 'History…', keywords: 'versions snapshots restore backup earlier', run: () => ctx.run('history') },
        { id: 'snapshot', group: 'File', label: 'Save snapshot…', keywords: 'version backup checkpoint', run: () => ctx.run('snapshot') },
        { id: 'print', group: 'File', label: 'Print…', keywords: 'paper pdf manuscript standard format', keys: '⌘P', run: () => ctx.run('print') },
        { id: 'export', group: 'File', label: 'Export…', keywords: 'word docx markdown text save as share manuscript', keys: '⇧⌘E', run: () => ctx.run('export') },
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
