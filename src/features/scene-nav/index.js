// Scene/chapter navigation — Editor mode only. Wires the always-visible left
// rail (rail.js) and the summonable full-window corkboard (corkboard.js)
// together on one shared manuscript model (model.js). Both are DOM-only and
// sit outside CodeMirror, so — unlike spellcheck/live-preview/block-spacing,
// which recompute via CodeMirror's own ViewPlugin update cycle — they need
// this module to tell them when to re-render: on doc change / cursor move
// (piggybacked on the same keyup/mouseup pattern app.js already uses for
// reportCursorPosition) and on file load (the one doc-change path that
// doesn't fire a keyup/mouseup on the editor).

import * as rail from './rail.js';
import * as corkboard from './corkboard.js';
import { renameTitle as applyRename } from './rename.js';
import { deleteScene as applyDeleteScene, deleteChapter as applyDeleteChapter } from './reorder.js';

let ctx = null;
let renderTimer = null;
let onHostActivity = null;
let onFileLoaded = null;
let onKeydown = null;

function refreshNow() {
  rail.render();
  if (corkboard.isOpen()) corkboard.render();
}

function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(refreshNow, 180);
}

// Deliberately does NOT touch corkboard open/closed state. The rail's own
// add-scene controls can only ever be clicked while the rail is visible,
// i.e. while the corkboard is already closed, so this only ever mattered
// for corkboard-triggered calls — where staying put (just re-rendering the
// new card in place) is exactly what's wanted: adding a scene should never
// navigate away.
function addNewScene(chapterIndex, chapters) {
  const chapter = chapters[chapterIndex];
  if (!chapter) return;

  const scenes = chapter.scenes;
  const doc = ctx.view.state.doc;

  if (scenes.length) {
    const last = scenes[scenes.length - 1];
    // last.endPos is the START of the next outline item. For the last
    // scene of a chapter that isn't the document's last chapter, that item
    // is the NEXT CHAPTER's own heading line — not a natural end-of-chapter
    // boundary — so raw endPos also swallows the blank-line gap that
    // belongs between the two chapters. Inserting there glued a bare "---"
    // immediately in front of the next chapter's heading, with no scene
    // ever following it (a real bug: the new "scene" was empty and any
    // later rebuild — reorder, rename, delete — silently dropped it,
    // discarding whatever the user had actually typed into it in the
    // meantime). Trimming back to the real end of this scene's own content
    // first, then replacing straight through to endPos with one clean
    // separator, avoids both the stray marker and doubled-up blank lines.
    const raw = doc.sliceString(last.pos, last.endPos);
    const trimmedEnd = last.pos + raw.replace(/\s+$/, '').length;
    const insert = '\n\n---\n\n';
    ctx.view.dispatch({
      changes: { from: trimmedEnd, to: last.endPos, insert },
      selection: { anchor: trimmedEnd + insert.length },
    });
    ctx.view.focus();
  } else {
    const headingLine = doc.lineAt(Math.min(chapter.pos, doc.length));
    const insertPos = Math.min(headingLine.to + 1, doc.length);
    ctx.editor.setCursorPos(ctx.view, insertPos);
    ctx.insertSceneBreak();
  }
  refreshNow();
}

function renameTitle(target, newTitle) {
  applyRename(ctx.view, target, newTitle);
  refreshNow();
}

// Same "never navigate away" rule as addNewScene — deleting from the
// corkboard just re-renders the grid in place, deleting from the rail just
// re-renders the list. Undo (⌘Z in the editor, or ⌘Z/the toolbar button
// while the corkboard is open) is the safety net; the two-click confirm on
// the delete button itself (see rail.js/corkboard.js) is the first one.
function deleteScene(chapterIndex, sceneIndex, chapters) {
  const doc = applyDeleteScene(chapters, { chapterIndex, sceneIndex });
  if (doc === null) return;
  ctx.setDoc(doc);
  refreshNow();
}

function deleteChapter(chapterIndex, chapters) {
  const doc = applyDeleteChapter(chapters, chapterIndex);
  if (doc === null) return;
  ctx.setDoc(doc);
  refreshNow();
}

export default {
  id: 'scene-nav',

  init(localCtx) {
    ctx = localCtx;
    // refreshNav: jump actions (rail row click, corkboard card click) move
    // the cursor programmatically, outside ctx.dom.host — the keyup/mouseup
    // listeners below never fire for those, so each surface calls this
    // directly right after a jump instead of waiting on the debounce.
    const sceneNavCtx = {
      ...ctx, addNewScene, refreshNav: refreshNow, openCorkboard: () => corkboard.show(), renameTitle,
      deleteScene, deleteChapter,
    };

    rail.mount(sceneNavCtx);
    corkboard.mount(sceneNavCtx);

    onHostActivity = () => scheduleRender();
    ctx.dom.host.addEventListener('keyup', onHostActivity);
    ctx.dom.host.addEventListener('mouseup', onHostActivity);

    onFileLoaded = () => scheduleRender();
    ctx.api.onFileLoaded(onFileLoaded);

    onKeydown = (e) => {
      if (!corkboard.isOpen()) return;
      // An inline title-rename input handles its own Escape (cancel) and
      // Mod-Z (native text-field undo) — don't let this capture-phase
      // handler pre-empt those before the input ever sees the keystroke.
      const editing = document.activeElement && document.activeElement.classList.contains('inline-rename-input');
      if (editing) return;

      if (e.key === 'Escape') { e.preventDefault(); corkboard.close(); return; }

      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) ctx.editor.redo(ctx.view); else ctx.editor.undo(ctx.view);
        refreshNow();
      }
    };
    document.addEventListener('keydown', onKeydown, true);
  },

  destroy() {
    clearTimeout(renderTimer);
    if (ctx) {
      ctx.dom.host.removeEventListener('keyup', onHostActivity);
      ctx.dom.host.removeEventListener('mouseup', onHostActivity);
    }
    if (onKeydown) document.removeEventListener('keydown', onKeydown, true);
    rail.unmount();
    corkboard.unmount();
    onHostActivity = onFileLoaded = onKeydown = null;
    ctx = null;
  },

  keybindings() {
    return { 'Mod-Shift-C': () => corkboard.toggle() };
  },

  commandGroups() {
    return [
      { group: 'Editor',
        items: [
          { label: 'Toggle corkboard', icon: 'ti-layout-grid', keys: ['⌘','⇧','C'], checked: corkboard.isOpen(), fn: () => corkboard.toggle() },
        ]
      },
    ];
  },
};
