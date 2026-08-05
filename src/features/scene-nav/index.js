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

function addNewScene(chapterIndex, chapters) {
  const chapter = chapters[chapterIndex];
  if (!chapter) return;

  const scenes = chapter.scenes;
  let insertPos;
  if (scenes.length) {
    insertPos = scenes[scenes.length - 1].endPos;
  } else {
    const doc = ctx.view.state.doc;
    const headingLine = doc.lineAt(Math.min(chapter.pos, doc.length));
    insertPos = Math.min(headingLine.to + 1, doc.length);
  }

  ctx.editor.setCursorPos(ctx.view, insertPos);
  ctx.insertSceneBreak();
  if (corkboard.isOpen()) corkboard.close();
  refreshNow();
}

function renameTitle(target, newTitle) {
  applyRename(ctx.view, target, newTitle);
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
    const sceneNavCtx = { ...ctx, addNewScene, refreshNav: refreshNow, openCorkboard: () => corkboard.show(), renameTitle };

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
