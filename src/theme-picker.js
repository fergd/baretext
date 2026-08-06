// Theme Picker — full-window view (replaces #content-row, same technique as
// scene-nav/corkboard.js) showing every theme rendered in its own scope so
// it can be judged in context, not just as swatches. Mode-agnostic (themes
// apply in both Sprinter and Editor), so this is mounted once at boot
// directly by app.js rather than through the per-mode feature lifecycle.

const THEMES = [
  { id: 'dark', name: 'Ember' },
  { id: 'light', name: 'Parchment' },
  { id: 'amstrad', name: 'Amstrad' },
  { id: 'grove', name: 'Grove' },
  { id: 'dracula', name: 'Dracula' },
];

// Order per THEMES.md's swatch-row spec.
const SWATCH_TOKENS = [
  '--bg', '--bg-alt', '--text', '--text-dim', '--text-dimmer',
  '--accent', '--syntax-2', '--typewriter-focus', '--border',
];

let ctx = null;
let pickerEl = null;
let open = false;
let built = false;
let focusedIndex = 0;
let cardEls = []; // parallel to THEMES

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function injectStyle() {
  if (document.getElementById('theme-picker-style')) return;
  const style = document.createElement('style');
  style.id = 'theme-picker-style';
  style.textContent = `
#theme-picker { font-family: var(--font-mono); background: var(--bg); }
.tp-scroll { flex: 1; overflow: auto; padding: 40px; }
.tp-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 28px; }
.tp-title { font-size: 20px; font-weight: 700; color: var(--text); }
.tp-back { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--text-dim); cursor: pointer; }
.tp-back:hover { color: var(--text); }
.tp-back kbd { background: var(--kbd-bg); border: 1px solid var(--kbd-border); border-bottom-width: 2px; border-radius: 4px; padding: 1px 6px; font-size: 10px; color: var(--text-dim); }

.tp-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 28px; }
@media (max-width: 720px) { .tp-grid { grid-template-columns: 1fr; } }

.tp-card {
  border-radius: var(--radius-card); overflow: hidden; border: 1px solid var(--border);
  background: var(--bg); cursor: pointer; outline: none;
  transition: box-shadow var(--dur-micro, .1s) ease, border-color var(--dur-micro, .1s) ease;
}
.tp-card.applied { border-color: var(--accent); }
.tp-card.kbd-focus {
  box-shadow: 0 0 0 2px var(--accent), 0 0 0 4px color-mix(in srgb, var(--accent) 25%, transparent);
}

.tp-card-header {
  background: var(--bg-alt); border-bottom: 1px solid var(--border); padding: 12px 16px;
  display: flex; align-items: center; justify-content: space-between;
}
.tp-card-name { font-size: 15px; font-weight: 600; color: var(--text); display: flex; align-items: center; gap: 8px; }
.tp-card-id { font-size: 11px; color: var(--text-dim); }
.tp-card-check { color: var(--accent); font-weight: 700; font-size: 13px; visibility: hidden; }
.tp-card.applied .tp-card-check { visibility: visible; }

.tp-swatch-row { display: flex; flex-wrap: wrap; gap: 10px; padding: 16px; }
.tp-swatch { width: 52px; }
.tp-swatch-block { width: 52px; height: 52px; border-radius: 4px; border: 1px solid var(--border); }
.tp-swatch-name { font-size: 10px; color: var(--text); margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tp-swatch-hex { font-size: 9px; color: var(--text-dim); }

.tp-specimen { padding: 4px 16px 18px; }
.tp-specimen-chapter { font-size: 16px; font-weight: 700; color: var(--accent); }
.tp-specimen-date { font-size: 12px; font-weight: 700; color: var(--syntax-2); margin-top: 2px; margin-bottom: 10px; }
.tp-specimen-lines { display: flex; flex-direction: column; gap: 4px; }
.tp-specimen-line { font-size: 12px; line-height: 1.6; color: var(--text); }
.tp-specimen-line.dim { opacity: .28; }
.tp-specimen-line.focus { color: var(--typewriter-focus); }
.tp-sel { background: var(--sel); border-radius: 2px; }
.tp-caret { display: inline-block; width: 2px; height: 1em; background: var(--cursor); vertical-align: text-bottom; margin: 0 1px; }

.tp-demo-chips { display: flex; gap: 8px; margin-top: 12px; }
.tp-demo-wash { font-size: 10px; padding: 4px 8px; border-radius: 4px; background: var(--wash-accent-strong); color: var(--text); }
.tp-demo-stripe { font-size: 10px; padding: 4px 8px 4px 11px; box-shadow: var(--stripe-accent); color: var(--text); background: var(--bg-alt); }
`;
  document.head.appendChild(style);
}

function buildCard(themeDef) {
  const card = el('div', 'tp-card');
  card.dataset.theme = themeDef.id;
  card.setAttribute('role', 'radio');
  card.setAttribute('aria-checked', 'false');
  card.setAttribute('aria-label', themeDef.name + ' (' + themeDef.id + ')');
  card.tabIndex = 0;

  const header = el('div', 'tp-card-header');
  const nameEl = el('span', 'tp-card-name');
  nameEl.append(document.createTextNode(themeDef.name), el('span', 'tp-card-check', '✓'));
  header.append(nameEl, el('span', 'tp-card-id', themeDef.id));

  const swatchRow = el('div', 'tp-swatch-row');
  const swatchChips = SWATCH_TOKENS.map((tok) => {
    const chip = el('div', 'tp-swatch');
    const block = el('div', 'tp-swatch-block');
    block.style.background = 'var(' + tok + ')';
    const nameLbl = el('div', 'tp-swatch-name', tok.replace('--', ''));
    const hexLbl = el('div', 'tp-swatch-hex', '');
    chip.append(block, nameLbl, hexLbl);
    swatchRow.appendChild(chip);
    return { token: tok, hexLbl };
  });

  const specimen = el('div', 'tp-specimen');
  specimen.append(
    el('div', 'tp-specimen-chapter', 'Chapter 1'),
    el('div', 'tp-specimen-date', 'January 22, 2026')
  );
  const lines = el('div', 'tp-specimen-lines');
  const lineTop = el('div', 'tp-specimen-line dim', 'The morning fog rolled in low over the harbor,');
  const lineFocus = el('div', 'tp-specimen-line focus');
  lineFocus.append(
    document.createTextNode('thick and grey against the pier lights, catching '),
    el('span', 'tp-sel', 'the edge of dawn'),
    el('span', 'tp-caret'),
    document.createTextNode('.')
  );
  const lineBottom = el('div', 'tp-specimen-line dim', 'Somewhere a bell rang, twice, then quiet.');
  lines.append(lineTop, lineFocus, lineBottom);
  specimen.appendChild(lines);

  const chips = el('div', 'tp-demo-chips');
  chips.append(el('span', 'tp-demo-wash', 'active row'), el('span', 'tp-demo-stripe', 'selected'));
  specimen.appendChild(chips);

  card.append(header, swatchRow, specimen);

  const applyThisTheme = () => applyTheme(themeDef.id);
  card.addEventListener('mousedown', (e) => { e.preventDefault(); applyThisTheme(); });

  return { card, swatchChips };
}

function buildOnce() {
  if (built) return;
  built = true;

  pickerEl.innerHTML = '';
  const scroll = el('div', 'tp-scroll');

  const header = el('div', 'tp-header');
  const back = el('div', 'tp-back');
  const kbd = document.createElement('kbd');
  kbd.textContent = 'esc';
  back.append(kbd, document.createTextNode(' back to writing'));
  back.addEventListener('mousedown', (e) => { e.preventDefault(); close(); });
  header.append(el('span', 'tp-title', 'Theme'), back);
  scroll.appendChild(header);

  const grid = el('div', 'tp-grid');
  grid.setAttribute('role', 'radiogroup');
  grid.setAttribute('aria-label', 'Theme');

  // Each card carries its own data-theme (set in buildCard via
  // card.dataset.theme), so every var() inside it resolves against THAT
  // theme's [data-theme="id"] block regardless of the app's actual active
  // theme -- the same nested-scope trick the design kit itself uses.
  cardEls = THEMES.map((themeDef) => {
    const builtCard = buildCard(themeDef);
    grid.appendChild(builtCard.card);
    return builtCard;
  });

  scroll.appendChild(grid);
  pickerEl.appendChild(scroll);

  // Hex labels need the card connected to the document for getComputedStyle
  // to resolve custom properties from the right cascade scope -- read them
  // straight off the live CSS (colors.css is the one source of truth) once,
  // right after the grid is in the DOM, rather than duplicating a hex table.
  cardEls.forEach((c) => {
    const styles = getComputedStyle(c.card);
    c.swatchChips.forEach(({ token, hexLbl }) => {
      hexLbl.textContent = styles.getPropertyValue(token).trim();
    });
  });
}

function updateMarkers() {
  cardEls.forEach((c, i) => {
    const id = THEMES[i].id;
    const applied = id === ctx.state.theme;
    c.card.classList.toggle('applied', applied);
    c.card.setAttribute('aria-checked', String(applied));
    c.card.classList.toggle('kbd-focus', i === focusedIndex);
  });
}

function applyTheme(id) {
  ctx.setTheme(id);
  focusedIndex = THEMES.findIndex((t) => t.id === id);
  updateMarkers();
}

function moveFocus(delta) {
  focusedIndex = Math.max(0, Math.min(THEMES.length - 1, focusedIndex + delta));
  updateMarkers();
  cardEls[focusedIndex].card.focus({ preventScroll: false });
}

function onKeydown(e) {
  if (!open) return;
  if (e.key === 'Escape') { e.preventDefault(); close(); return; }
  if (e.key === 'Enter') { e.preventDefault(); applyTheme(THEMES[focusedIndex].id); return; }
  const cols = window.matchMedia('(min-width: 720px)').matches ? 2 : 1;
  if (e.key === 'ArrowRight') { e.preventDefault(); moveFocus(1); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); moveFocus(-1); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); moveFocus(cols); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); moveFocus(-cols); }
}

export function isOpen() { return open; }

export function toggle() { if (open) close(); else show(); }

export function show() {
  buildOnce();
  open = true;
  document.getElementById('content-row').style.display = 'none';
  pickerEl.style.display = 'flex';
  focusedIndex = Math.max(0, THEMES.findIndex((t) => t.id === ctx.state.theme));
  updateMarkers();
}

export function close() {
  open = false;
  pickerEl.style.display = 'none';
  document.getElementById('content-row').style.display = 'flex';
  ctx.focusEditor();
}

export function mount(localCtx) {
  ctx = localCtx;
  injectStyle();
  pickerEl = document.getElementById('theme-picker');
  open = false;
  document.addEventListener('keydown', onKeydown, true);
}
