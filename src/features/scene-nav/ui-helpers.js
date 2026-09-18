// Interactive UI primitives shared by rail.js and corkboard.js — both
// render the same manuscript model with different chrome, and both had
// grown byte-identical (or near enough — only the CSS class name differed)
// copies of these two pieces. Extracted here once an architecture review
// flagged the duplication.
import { btn, icon } from '../../dom.js';
import { getManuscript } from './model.js';
import { textToCopy } from './copy.js';
import { sceneGroup } from './links.js';

export function markSceneGroup(element, scenes, si) {
  const { start, end } = sceneGroup(scenes, si);
  element.dataset.groupId = scenes[si].groupId || '';
  element.dataset.groupStart = start;
  element.dataset.groupEnd = end;
  if (end - start < 2 && !scenes[si].groupId) return;
  element.classList.add('scene-linked');
  element.classList.toggle('scene-linked-next', si < end - 1);
  element.classList.toggle('scene-linked-prev', si > start);
  const name = element.querySelector('.rail-scene-name, .peek-scene-name');
  if (name) {
    const glyph = icon('lucide-link');
    glyph.classList.add('scene-link-mark');
    name.prepend(glyph);
  }
  const label = scenes[si].groupId ? `linked group · ${scenes[si].groupSize} scenes · drag to move together` : `linked scenes ${start + 1}–${end} · drag to move together`;
  element.title = label;
  element.setAttribute('aria-description', label);
}

// Two-click confirm: first click arms it (icon turns danger-colored, shows
// "delete?"), a second click on the SAME button within 3s actually deletes.
// Clicking elsewhere, arming a different delete button, or the timeout
// disarms it — no native confirm() dialog, consistent with the rest of this
// app never using one, but still real friction against a stray click, on
// top of undo already being available as the last line of defense.
//
// deleteBtnClass scopes the "disarm every OTHER delete button" query to
// just this surface's own buttons — rail.js and corkboard.js each render
// their own independent set of delete buttons, and arming one in the rail
// has no business disarming one in the corkboard (or vice versa). May be a
// single class or a space-separated list (e.g. a shared icon-button style
// plus the scoping class); turned into a compound selector below rather
// than interpolated as one raw string, which would parse a space as a
// descendant combinator instead of a second class.
export function makeDeleteButton(deleteBtnClass, label, onConfirm) {
  const button = btn(deleteBtnClass);
  const disarmSelector = '.' + deleteBtnClass.trim().split(/\s+/).join('.');
  let armed = false;
  let timer = null;

  function paint() {
    button.innerHTML = '';
    button.appendChild(icon('lucide-trash'));
    if (armed) {
      button.appendChild(document.createTextNode(' delete?'));
      button.title = 'click again to delete ' + label;
      button.setAttribute('aria-label', 'Confirm delete ' + label);
    } else {
      button.title = 'delete ' + label;
      button.setAttribute('aria-label', 'Delete ' + label);
    }
    button.classList.toggle('confirm', armed);
    // Bubbles up to the row so a trailing-slot hover/focus swap (rail.js)
    // can re-evaluate visibility right when arm state changes -- most
    // importantly the 3s auto-disarm timeout, which fires with no
    // mouse/focus event of its own to trigger that re-check otherwise.
    button.dispatchEvent(new Event('btconfirmchange', { bubbles: true }));
  }

  function disarm() {
    clearTimeout(timer);
    armed = false;
    paint();
  }
  button._disarm = disarm;

  button.addEventListener('mousedown', (e) => e.stopPropagation());
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    if (armed) {
      disarm();
      onConfirm();
      return;
    }
    document.querySelectorAll(disarmSelector).forEach((b) => { if (b !== button && b._disarm) b._disarm(); });
    armed = true;
    paint();
    timer = setTimeout(disarm, 3000);
  });

  paint();
  return button;
}

// Swaps a title's display span for an inline <input>. Enter or blur commits
// (whenever the value actually changed, including clearing it to blank —
// blank is a real, valid title that falls back to the "Untitled"/"Scene N"
// placeholder, not a cancel); Escape cancels. On either path a re-render
// restores the row — via ctx.refreshNav() after a real commit, or a plain
// local render() when nothing changed.
//
// render is passed in rather than imported: rail.js and corkboard.js each
// own their own render() closure, and this helper has no rendering context
// of its own to fall back to.
export function beginEdit(displayEl, currentValue, onCommit, render) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'inline-rename-input';
  input.value = currentValue;
  displayEl.replaceWith(input);
  input.focus({ preventScroll: true });
  input.select();

  let done = false;
  function finish(shouldCommit) {
    if (done) return;
    done = true;
    input.removeEventListener('blur', onBlur);
    const v = input.value.trim();
    if (shouldCommit && v !== currentValue) { onCommit(v); return; }
    render();
  }
  function onBlur() { finish(true); }
  input.addEventListener('blur', onBlur);
  // mousedown alone isn't enough -- the row's own jump/toggle handler listens
  // for 'click', a separate event that still bubbles up on a plain
  // click-to-place-the-caret even though its mousedown was already stopped
  // here. Without this, clicking into the input to reposition the caret
  // (rather than just typing after the initial focus+select) got read as a
  // click on the row underneath, which jumped/toggled it and blew away the
  // edit in progress.
  input.addEventListener('mousedown', (e) => e.stopPropagation());
  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    e.stopPropagation();
  });
}

// Buttons stop row activation, preserving the writer's caret and selection.
export function makeCopyButton(className, kind, ctx, ci, si) {
  const button = btn(className + ' copy-' + kind + '-btn');
  button.append(icon('lucide-copy'));
  button.title = 'copy ' + kind + ' to clipboard';
  button.setAttribute('aria-label', 'Copy ' + kind + ' to clipboard');
  button.addEventListener('mousedown', e => e.stopPropagation());
  button.addEventListener('click', async e => {
    e.stopPropagation();
    try {
      const chapters = getManuscript(ctx.view);
      const text = textToCopy(window.BaretextEditor.getDoc(ctx.view), chapters, ci, si);
      await navigator.clipboard.writeText(text);
      ctx.showToast(kind + ' copied');
    } catch {
      ctx.showToast('could not copy ' + kind + ' — try again');
    }
  });
  return button;
}
