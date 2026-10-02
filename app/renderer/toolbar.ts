// Selection toolbar (DECISIONS §2): a Linear-style popover over selected prose.
//
// Appears when a mouse selection is released or a keyboard selection
// pauses; hides on typing, Esc, collapse, composition, or when the
// selection scrolls out of view (and returns when it scrolls back). It never
// takes focus or drops the selection — except for the link field, which
// shows the selection as a highlight while it has focus.

import { Plugin, PluginKey, type Command, type EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import {
  hasFormattableText,
  markState,
  quoteState,
  removeLink,
  schema,
  selectedLink,
  setLink,
  toggleBold,
  toggleItalic,
  toggleQuote,
  type FormatState,
} from '@baretext/editor';

const KEYBOARD_PAUSE_MS = 400;
/** Space between the selection and the toolbar, and from the workspace edges. */
const GAP = 8;

const ICONS = {
  bold: '<path d="M5 2.75h3.75a2.63 2.63 0 0 1 0 5.25H5zM5 8h4.5a2.75 2.75 0 0 1 0 5.5H5z"/>',
  italic: '<path d="M7 2.75h5M4 13.25h5M9.5 2.75l-3 10.5"/>',
  link: '<path d="M6.5 9.5l3-3M7.25 4.25l.9-.9a2.83 2.83 0 0 1 4 4l-.9.9M8.75 11.75l-.9.9a2.83 2.83 0 0 1-4-4l.9-.9"/>',
  quote: '<path d="M3 3v10M6.5 4.5H13M6.5 8H13M6.5 11.5H11"/>',
  note: '<path d="M3 3.5h10v7H8l-3 2.5v-2.5H3z"/>',
};
const svg = (paths: string) =>
  `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

type Action = 'bold' | 'italic' | 'link' | 'quote' | 'note';
const BUTTONS: { action: Action; label: string; keys?: string }[] = [
  { action: 'bold', label: 'Bold', keys: '⌘B' },
  { action: 'italic', label: 'Italic', keys: '⌘I' },
  { action: 'link', label: 'Link' },
  { action: 'quote', label: 'Quote' },
  { action: 'note', label: 'Add note', keys: '⇧⌘M' },
];

type Range = { from: number; to: number } | null;
const highlightKey = new PluginKey<Range>('toolbar-highlight');

export class SelectionToolbar {
  readonly el: HTMLElement;
  /** Add to the editor's plugins: follows state changes, draws the link-edit highlight. */
  readonly plugin: Plugin;

  private readonly buttons = new Map<Action, HTMLButtonElement>();
  private readonly linkForm: HTMLFormElement;
  private readonly input: HTMLInputElement;
  private readonly removeButton: HTMLButtonElement;

  /** Should be showing (selection settled over prose); may still be off-screen. */
  private armed = false;
  private mode: 'buttons' | 'link' = 'buttons';
  private pointerSelecting = false;
  /** Bumped on every key press: a pending mouse-up check yields to the keyboard. */
  private keyGeneration = 0;
  private applying = false;
  private keyTimer: number | undefined;
  private quietOnce = false;
  private frame = 0;

  constructor(
    private readonly workspace: HTMLElement,
    private readonly scroller: HTMLElement,
    private readonly getView: () => EditorView | null,
    /** Add a note to the selection (the app owns notes). */
    private readonly addNote: () => void = () => {},
  ) {
    this.el = document.createElement('div');
    this.el.className = 'bt-toolbar';
    this.el.setAttribute('role', 'toolbar');
    this.el.setAttribute('aria-label', 'Format');
    this.el.dataset.visible = 'false';
    this.el.dataset.mode = 'buttons';

    const group = document.createElement('div');
    group.className = 'bt-toolbar-buttons';
    BUTTONS.forEach(({ action, label, keys }, i) => {
      if (action === 'quote' || action === 'note') group.append(Object.assign(document.createElement('span'), { className: 'bt-toolbar-sep' }));
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'bt-toolbar-button';
      b.dataset.action = action;
      b.tabIndex = i === 0 ? 0 : -1;
      b.setAttribute('aria-label', label);
      b.setAttribute('aria-pressed', 'false');
      b.dataset.tip = keys ? `${label}  ${keys}` : label;
      b.innerHTML = svg(ICONS[action]);
      group.append(b);
      this.buttons.set(action, b);
    });

    this.linkForm = document.createElement('form');
    this.linkForm.className = 'bt-toolbar-link';
    this.input = document.createElement('input');
    this.input.type = 'text';
    this.input.className = 'bt-toolbar-input';
    this.input.placeholder = 'Paste or type a link';
    this.input.spellcheck = false;
    this.input.setAttribute('aria-label', 'Link address');
    this.removeButton = document.createElement('button');
    this.removeButton.type = 'button';
    this.removeButton.className = 'bt-toolbar-text-button';
    this.removeButton.textContent = 'Remove';
    this.linkForm.append(this.input, this.removeButton);

    this.el.append(group, this.linkForm);
    workspace.append(this.el);

    // Buttons never take focus from the editor (so the selection stays).
    this.el.addEventListener('mousedown', (e) => { if (e.target !== this.input) e.preventDefault(); });
    group.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.bt-toolbar-button');
      if (b) this.act(b.dataset.action as Action);
    });
    group.addEventListener('keydown', (e) => this.onToolbarKey(e));
    this.linkForm.addEventListener('submit', (e) => { e.preventDefault(); this.applyLink(); });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.closeLink(true); }
    });
    this.input.addEventListener('input', () => { this.input.removeAttribute('aria-invalid'); });
    this.input.addEventListener('blur', () => {
      // Clicking elsewhere abandons the edit; the toolbar goes with it.
      if (this.mode === 'link') { this.closeLink(false); this.hide(); }
    });
    this.removeButton.addEventListener('click', () => {
      this.run(removeLink);
      this.closeLink(true);
    });

    window.addEventListener('mouseup', () => {
      if (!this.pointerSelecting) return;
      this.pointerSelecting = false;
      // Let the editor read the final DOM selection first. A key pressed in
      // the meantime makes it a keyboard selection, which waits for its pause.
      const generation = this.keyGeneration;
      setTimeout(() => { if (generation === this.keyGeneration) this.settle(); }, 0);
    }, true);
    scroller.addEventListener('scroll', () => this.schedulePosition(), { passive: true });
    new ResizeObserver(() => this.schedulePosition()).observe(workspace);

    this.plugin = new Plugin<Range>({
      key: highlightKey,
      state: {
        init: (): Range => null,
        apply: (tr, value: Range): Range => {
          const meta = tr.getMeta(highlightKey) as Range | undefined;
          if (meta !== undefined) return meta;
          return value && { from: tr.mapping.map(value.from), to: tr.mapping.map(value.to) };
        },
      },
      props: {
        decorations(state) {
          const r = highlightKey.getState(state);
          return r ? DecorationSet.create(state.doc, [Decoration.inline(r.from, r.to, { class: 'bt-pending-selection' })]) : null;
        },
        handleDOMEvents: {
          mousedown: (_view, e) => {
            if (e.button === 0) { this.pointerSelecting = true; this.hide(); }
            return false;
          },
          compositionstart: () => { this.hide(); return false; },
        },
        handleKeyDown: (_view, e) => {
          this.keyGeneration++;
          // Claim Esc (stop it here) so it doesn't also leave focus mode.
          if (e.key === 'Escape' && this.armed) { e.stopPropagation(); this.hide(); return true; }
          if (e.key === 'F10' && e.altKey && this.armed) { this.focusButtons(); return true; }
          return false;
        },
      },
      view: () => ({ update: (view, prev) => this.onUpdate(view, prev) }),
    });
  }

  /** Edit the link on the selection (toolbar button, Format → Link…). */
  openLink(): boolean {
    const view = this.getView();
    if (!view || !hasFormattableText(view.state)) return false;
    clearTimeout(this.keyTimer);
    this.armed = true;
    this.mode = 'link';
    this.el.dataset.mode = 'link';
    const current = selectedLink(view.state);
    this.input.value = current ?? '';
    this.input.removeAttribute('aria-invalid');
    this.removeButton.hidden = !current;
    const { from, to } = view.state.selection;
    view.dispatch(view.state.tr.setMeta(highlightKey, { from, to }));
    this.position();
    this.input.focus();
    this.input.select();
    return true;
  }

  /** The next selection change (e.g. find landing on a match) shows no toolbar. */
  quiet() {
    this.quietOnce = true;
  }

  get visible(): boolean {
    return this.el.dataset.visible === 'true';
  }

  // ── state ──

  private onUpdate(view: EditorView, prev: EditorState) {
    const state = view.state;
    if (this.mode === 'link') return;
    if (this.applying) { this.refresh(); return; }
    if (state.doc !== prev.doc) {
      // Typing replaces the selection and hides the toolbar; a shortcut
      // (⌘B, ⌘I) keeps the selection and just updates it.
      const { from, to, empty } = state.selection;
      if (this.armed && !empty && from === prev.selection.from && to === prev.selection.to) this.refresh();
      else this.hide();
      return;
    }
    if (state.selection.eq(prev.selection)) return;
    this.hide();
    if (this.quietOnce) { this.quietOnce = false; return; }
    if (this.pointerSelecting || !hasFormattableText(state)) return;
    // Keyboard (or programmatic) selection: show once it pauses.
    this.keyTimer = window.setTimeout(() => this.settle(), KEYBOARD_PAUSE_MS);
  }

  private settle() {
    const view = this.getView();
    if (!view || view.composing || this.pointerSelecting || !hasFormattableText(view.state)) return;
    this.armed = true;
    this.refresh();
  }

  private hide() {
    clearTimeout(this.keyTimer);
    this.armed = false;
    this.el.dataset.visible = 'false';
  }

  private refresh() {
    const view = this.getView();
    if (!view || !this.armed) return;
    const state = view.state;
    if (!hasFormattableText(state)) { this.hide(); return; }
    const pressed: Record<Action, FormatState> = {
      bold: markState(state, schema.marks.bold!),
      italic: markState(state, schema.marks.italic!),
      link: markState(state, schema.marks.link!),
      quote: quoteState(state),
      note: 'off',
    };
    for (const [action, b] of this.buttons) {
      const s = pressed[action];
      b.setAttribute('aria-pressed', s === 'on' ? 'true' : s === 'mixed' ? 'mixed' : 'false');
    }
    this.position();
  }

  // ── actions ──

  private run(cmd: Command) {
    const view = this.getView();
    if (!view) return;
    this.applying = true;
    try { cmd(view.state, view.dispatch); } finally { this.applying = false; }
  }

  private act(action: Action) {
    if (action === 'link') { this.openLink(); return; }
    if (action === 'note') { this.hide(); this.addNote(); return; }
    this.run(action === 'bold' ? toggleBold : action === 'italic' ? toggleItalic : toggleQuote);
    this.refresh();
  }

  private applyLink() {
    const value = this.input.value.trim();
    if (!value) {
      if (!this.removeButton.hidden) this.run(removeLink);
      this.closeLink(true);
      return;
    }
    let ok = false;
    const view = this.getView();
    if (view) {
      this.applying = true;
      try { ok = setLink(value)(view.state, view.dispatch); } finally { this.applying = false; }
    }
    if (!ok) { this.input.setAttribute('aria-invalid', 'true'); return; }
    this.closeLink(true);
  }

  /** Leave the link field; `returnToEditor` puts focus back with the selection intact. */
  private closeLink(returnToEditor: boolean) {
    if (this.mode !== 'link') return;
    this.mode = 'buttons';
    this.el.dataset.mode = 'buttons';
    const view = this.getView();
    if (!view) return;
    view.dispatch(view.state.tr.setMeta(highlightKey, null));
    if (returnToEditor) {
      view.focus();
      this.armed = true;
      this.refresh();
    }
  }

  private focusButtons() {
    const first = [...this.buttons.values()].find((b) => b.tabIndex === 0) ?? this.buttons.get('bold')!;
    first.focus();
  }

  private onToolbarKey(e: KeyboardEvent) {
    const list = [...this.buttons.values()];
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % list.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + list.length) % list.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = list.length - 1;
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.getView()?.focus(); return; }
    if (next < 0) return;
    e.preventDefault();
    list.forEach((b, j) => { b.tabIndex = j === next ? 0 : -1; });
    list[next]!.focus();
  }

  // ── placement ──

  private schedulePosition() {
    if (!this.armed || this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.position(); });
  }

  /** Centered above the selection; below it when there is no room; hidden while the selection is out of view. */
  private position() {
    const view = this.getView();
    if (!view || !this.armed) return;
    const { from, to } = view.state.selection;
    let a: { top: number; bottom: number; left: number; right: number };
    let b: typeof a;
    try { a = view.coordsAtPos(from, 1); b = view.coordsAtPos(to, -1); } catch { this.hide(); return; }
    const ws = this.workspace.getBoundingClientRect();
    const view_ = this.scroller.getBoundingClientRect();
    const top = Math.min(a.top, b.top);
    const bottom = Math.max(a.bottom, b.bottom);
    if (bottom < view_.top || top > view_.bottom) { this.el.dataset.visible = 'false'; return; }

    const oneLine = Math.abs(a.top - b.top) < 2;
    const column = view.dom.getBoundingClientRect();
    const center = oneLine ? (a.left + b.right) / 2 : (column.left + column.right) / 2;
    const w = this.el.offsetWidth;
    const h = this.el.offsetHeight;
    let y = top - ws.top - GAP - h;
    const below = y < GAP;
    if (below) y = bottom - ws.top + GAP;
    const x = Math.min(Math.max(center - ws.left - w / 2, GAP), ws.width - w - GAP);
    this.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    this.el.dataset.placement = below ? 'below' : 'above';
    this.el.dataset.visible = 'true';
  }
}
