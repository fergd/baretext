// Sprint Timer — Sprinter mode's timed-writing companion.
// Lifecycle: evoke (duration picker) -> active (glass panel) -> minimized
// (edge line + status chip) or hidden (status chip only) -> complete (toast).
// Self-contained: injects its own <style>, owns its own DOM and interval.

const WORDS_PER_MINUTE = 20; // average sustained writing-sprint pace — drives the auto goal
const GOAL_STEP = 50;
const DURATIONS = [15, 25, 45];

let ctx = null;
let panelEl = null;
let edgeEl = null;
let edgeFillEl = null;
let chipEl = null;
let timeEl = null;
let fillEl = null;
let wordsEl = null;

let sprint = null;          // { totalSeconds, remaining, view, wordsAtStart, goal }
let evokeOpen = false;
let selectedMinutes = 25;
let selectedGoal = null;    // null = auto (scales with duration); a number once the user edits it
let goalInputEl = null;
let tickTimer = null;
let evokeKeyHandler = null;

function mmss(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function icon(cls) {
  const i = document.createElement('i');
  i.className = 'ti ' + cls;
  return i;
}

function autoGoal() {
  return Math.round(selectedMinutes * WORDS_PER_MINUTE);
}
function currentGoal() {
  return selectedGoal !== null ? selectedGoal : autoGoal();
}
function bumpGoal(delta) {
  selectedGoal = Math.max(0, currentGoal() + delta);
  if (goalInputEl) goalInputEl.value = String(selectedGoal);
}

function injectStyle() {
  if (document.getElementById('sprint-timer-style')) return;
  const style = document.createElement('style');
  style.id = 'sprint-timer-style';
  style.textContent = `
@keyframes sprint-pulse { 0%,100% { opacity: .35 } 50% { opacity: 1 } }

.sprint-panel {
  position: absolute; left: 50%; bottom: 82px; transform: translateX(-50%);
  width: 340px; z-index: 50; padding: 16px 18px;
  background: var(--glass-bg);
  backdrop-filter: blur(22px) saturate(160%);
  -webkit-backdrop-filter: blur(22px) saturate(160%);
  border: 1px solid var(--glass-border);
  border-top: 1px solid var(--glass-edge);
  border-radius: var(--radius-panel);
  box-shadow: var(--shadow-panel), var(--glass-highlight);
  font-family: var(--font-mono);
  display: none;
}
.sprint-label { font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--accent); font-weight: 600; opacity: .85; }

.sprint-chips { display: flex; gap: 8px; margin-top: 13px; }
.sprint-chip-opt {
  flex: 1; text-align: center; padding: 7px 0; border-radius: 6px;
  border: 1px solid var(--glass-border); color: var(--text-dim); font-size: 13px; cursor: pointer;
  transition: background .1s ease, color .1s ease;
}
.sprint-chip-opt:hover { background: var(--wash-accent); color: var(--text); }
.sprint-chip-opt.active { background: var(--accent); color: var(--bg); font-weight: 700; border-color: transparent; }

.sprint-minutes-label { margin-top: 8px; font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: var(--text-dimmer); text-align: center; }

.sprint-goal-row { display: flex; justify-content: space-between; align-items: center; margin-top: 14px; font-size: 12px; color: var(--text-dim); }
.sprint-goal-control { display: flex; align-items: center; gap: 3px; }
.sprint-goal-input {
  width: 52px; text-align: right; background: transparent; border: none; outline: none;
  color: var(--text); font-family: var(--font-mono); font-size: 12px;
  -moz-appearance: textfield;
}
.sprint-goal-input::-webkit-outer-spin-button,
.sprint-goal-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.sprint-goal-stepper { display: flex; flex-direction: column; cursor: pointer; }
.sprint-goal-step { font-size: 9px; line-height: 1; padding: 1px 2px; color: var(--text-dimmer); transition: color .1s ease; }
.sprint-goal-step:hover { color: var(--accent); }

.sprint-evoke-footer { display: flex; justify-content: space-between; align-items: center; margin-top: 14px; padding-top: 11px; border-top: 1px solid var(--border); font-size: 11px; color: var(--text-dim); }
.sprint-hint { display: flex; align-items: center; gap: 7px; }
.sprint-kbd { background: var(--kbd-bg); border: 1px solid var(--kbd-border); border-bottom-width: 2px; border-radius: 4px; padding: 2px 7px; font-size: 10px; color: var(--text-dim); line-height: 1; }

.sprint-header { display: flex; justify-content: space-between; align-items: center; }
.sprint-header-left { display: flex; align-items: center; gap: 8px; }
.sprint-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); animation: sprint-pulse 2s ease-in-out infinite; }
.sprint-header-right { display: flex; gap: 6px; }
.sprint-pill {
  font-size: 11px; color: var(--text-dim); padding: 3px 10px;
  border: 1px solid var(--glass-border); border-radius: 5px; cursor: pointer;
  transition: background .1s ease, color .1s ease;
}
.sprint-pill:hover { background: var(--wash-accent); color: var(--text); }

.sprint-time-row { display: flex; align-items: baseline; gap: 10px; margin-top: 13px; }
.sprint-time { font-size: 34px; font-weight: 700; color: var(--text); letter-spacing: 1px; font-variant-numeric: tabular-nums; }
.sprint-remaining { font-size: 11px; color: var(--text-dimmer); letter-spacing: .06em; }

.sprint-track { height: 3px; border-radius: 2px; margin-top: 13px; overflow: hidden; background: color-mix(in srgb, var(--border) 60%, transparent); }
.sprint-fill { height: 100%; width: 0%; background: var(--accent); }

.sprint-footer { display: flex; justify-content: space-between; align-items: center; margin-top: 11px; font-size: 11px; color: var(--text-dim); }

.sprint-edge {
  position: absolute; left: 0; right: 0; bottom: 30px; height: 2px;
  background: color-mix(in srgb, var(--border) 45%, transparent);
  z-index: 3; display: none;
}
.sprint-edge-fill { height: 100%; width: 0%; background: var(--accent); box-shadow: 0 0 10px color-mix(in srgb, var(--accent) 70%, transparent); }

.sprint-chip-status { display: flex; align-items: center; gap: 6px; cursor: pointer; transition: color .15s ease; }
.sprint-chip-status .ti-run { color: var(--text-dimmer); font-size: 13px; transition: color .15s ease; }
.sprint-chip-status:hover { color: var(--text); }
.sprint-chip-status:hover .ti-run { color: var(--text-dim); }
.sprint-chip-status.running { color: var(--text); font-variant-numeric: tabular-nums; }
.sprint-chip-status.running .ti-run { color: var(--accent); animation: sprint-pulse 2s ease-in-out infinite; }
`;
  document.head.appendChild(style);
}

function hint(key, label) {
  const s = el('span', 'sprint-hint');
  const kbd = el('span', 'sprint-kbd', key);
  s.append(kbd, document.createTextNode(' ' + label));
  return s;
}

function updateVisibility() {
  panelEl.style.display = (evokeOpen || (sprint && sprint.view === 'active')) ? 'block' : 'none';
  edgeEl.style.display = (sprint && sprint.view === 'edge') ? 'block' : 'none';
  updateChipContent();
}

// Chip is a permanent footer fixture (idle "sprint" label / running countdown),
// not just a minimized-state affordance — always reflects current sprint state.
function updateChipContent() {
  if (!chipEl) return;
  chipEl.innerHTML = '';
  chipEl.appendChild(icon('ti-run'));
  if (sprint) {
    chipEl.classList.add('running');
    chipEl.appendChild(document.createTextNode(' ' + mmss(sprint.remaining)));
    chipEl.title = sprint.view === 'active' ? 'sprint in progress' : 'click to show sprint';
  } else {
    chipEl.classList.remove('running');
    chipEl.appendChild(document.createTextNode(' sprint'));
    chipEl.title = 'click to start a sprint';
  }
}

function buildEvoke() {
  panelEl.innerHTML = '';
  panelEl.appendChild(el('div', 'sprint-label', 'start sprint'));

  const chipsRow = el('div', 'sprint-chips');
  DURATIONS.forEach(min => {
    const chip = el('div', 'sprint-chip-opt' + (min === selectedMinutes ? ' active' : ''), String(min));
    chip.addEventListener('mousedown', (e) => { e.preventDefault(); selectedMinutes = min; buildEvoke(); });
    chipsRow.appendChild(chip);
  });
  panelEl.appendChild(chipsRow);
  panelEl.appendChild(el('div', 'sprint-minutes-label', 'minutes'));

  const goalRow = el('div', 'sprint-goal-row');
  goalRow.appendChild(document.createTextNode('word goal'));

  const goalControl = el('div', 'sprint-goal-control');
  goalInputEl = document.createElement('input');
  goalInputEl.type = 'number';
  goalInputEl.className = 'sprint-goal-input';
  goalInputEl.min = '0';
  goalInputEl.step = String(GOAL_STEP);
  goalInputEl.value = String(currentGoal());
  goalInputEl.addEventListener('input', () => {
    const v = parseInt(goalInputEl.value, 10);
    selectedGoal = Number.isFinite(v) && v >= 0 ? v : 0;
  });
  goalControl.appendChild(goalInputEl);

  const stepper = el('div', 'sprint-goal-stepper');
  const up = el('span', 'sprint-goal-step');
  up.appendChild(icon('ti-chevron-up'));
  up.addEventListener('mousedown', (e) => { e.preventDefault(); bumpGoal(GOAL_STEP); });
  const down = el('span', 'sprint-goal-step');
  down.appendChild(icon('ti-chevron-down'));
  down.addEventListener('mousedown', (e) => { e.preventDefault(); bumpGoal(-GOAL_STEP); });
  stepper.append(up, down);
  goalControl.appendChild(stepper);

  goalRow.appendChild(goalControl);
  panelEl.appendChild(goalRow);

  const footer = el('div', 'sprint-evoke-footer');
  footer.append(hint('↵', 'start'), hint('esc', 'cancel'));
  panelEl.appendChild(footer);
}

function buildActive() {
  panelEl.innerHTML = '';

  const header = el('div', 'sprint-header');
  const left = el('div', 'sprint-header-left');
  left.append(el('span', 'sprint-dot'), el('span', 'sprint-label', 'sprint'));
  const right = el('div', 'sprint-header-right');
  const minBtn = el('span', 'sprint-pill', 'minimize');
  minBtn.addEventListener('mousedown', (e) => { e.preventDefault(); setView('edge'); });
  const endBtn = el('span', 'sprint-pill', 'end');
  endBtn.addEventListener('mousedown', (e) => { e.preventDefault(); endSprint(); });
  right.append(minBtn, endBtn);
  header.append(left, right);
  panelEl.appendChild(header);

  const timeRow = el('div', 'sprint-time-row');
  timeEl = el('span', 'sprint-time', '00:00');
  timeRow.append(timeEl, el('span', 'sprint-remaining', 'remaining'));
  panelEl.appendChild(timeRow);

  const track = el('div', 'sprint-track');
  fillEl = el('div', 'sprint-fill');
  track.appendChild(fillEl);
  panelEl.appendChild(track);

  const footer = el('div', 'sprint-footer');
  wordsEl = el('span', 'sprint-words-el');
  footer.appendChild(wordsEl);
  panelEl.appendChild(footer);

  updateActiveVisuals();
}

function updateActiveVisuals() {
  if (!sprint || !timeEl) return;
  timeEl.textContent = mmss(sprint.remaining);
  const pct = Math.min(100, Math.max(0, ((sprint.totalSeconds - sprint.remaining) / sprint.totalSeconds) * 100));
  fillEl.style.width = pct + '%';
  const gained = Math.max(0, ctx.state.wordCount - sprint.wordsAtStart);
  wordsEl.textContent = `+${gained} words · goal ${sprint.goal}`;
}

function updateEdgeVisuals() {
  if (!sprint) return;
  const pct = Math.min(100, Math.max(0, ((sprint.totalSeconds - sprint.remaining) / sprint.totalSeconds) * 100));
  edgeFillEl.style.width = pct + '%';
}

function attachEvokeKeys() {
  evokeKeyHandler = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); confirmEvoke(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelEvoke(); }
  };
  document.addEventListener('keydown', evokeKeyHandler, true);
}
function detachEvokeKeys() {
  if (evokeKeyHandler) document.removeEventListener('keydown', evokeKeyHandler, true);
  evokeKeyHandler = null;
}

function openEvoke() {
  evokeOpen = true;
  selectedMinutes = 25;
  selectedGoal = null;
  buildEvoke();
  attachEvokeKeys();
  updateVisibility();
}

function cancelEvoke() {
  evokeOpen = false;
  detachEvokeKeys();
  updateVisibility();
}

function confirmEvoke() {
  const minutes = selectedMinutes;
  const goal = currentGoal();
  evokeOpen = false;
  detachEvokeKeys();
  startSprint(minutes, goal);
}

function startSprint(minutes, goal) {
  sprint = {
    totalSeconds: minutes * 60,
    remaining: minutes * 60,
    view: 'active',
    wordsAtStart: ctx.state.wordCount,
    goal,
  };
  buildActive();
  updateVisibility();
  clearInterval(tickTimer);
  tickTimer = setInterval(tick, 1000);
  // Sprints default to typewriter view; the user can toggle it back off
  // (⌘⇧T or the palette) at any point without affecting the sprint itself.
  if (!ctx.state.typewriter) ctx.setTypewriter(true, { silent: true });
}

function tick() {
  if (!sprint) return;
  sprint.remaining -= 1;
  if (sprint.remaining <= 0) { complete(); return; }
  if (sprint.view === 'active') updateActiveVisuals();
  else if (sprint.view === 'edge') updateEdgeVisuals();
  updateChipContent();
}

function complete() {
  const gained = Math.max(0, ctx.state.wordCount - sprint.wordsAtStart);
  const totalStr = mmss(sprint.totalSeconds);
  clearInterval(tickTimer);
  tickTimer = null;
  sprint = null;
  updateVisibility();
  ctx.showToast(`sprint complete · +${gained} words · ${totalStr}`, { icon: 'ti-run' });
}

function endSprint() {
  clearInterval(tickTimer);
  tickTimer = null;
  sprint = null;
  updateVisibility();
  ctx.showToast('sprint ended');
}

function setView(view) {
  if (!sprint) return;
  sprint.view = view;
  if (view === 'active') buildActive();
  else if (view === 'edge') updateEdgeVisuals();
  updateVisibility();
}

function handleStartCommand() {
  if (!sprint) openEvoke();
  else setView('active');
}
function handleHideCommand() {
  if (sprint) setView('hidden');
}

export default {
  id: 'sprint-timer',

  init(localCtx) {
    ctx = localCtx;
    injectStyle();

    panelEl = el('div', 'sprint-panel');
    ctx.dom.app.appendChild(panelEl);

    edgeEl = el('div', 'sprint-edge');
    edgeFillEl = el('div', 'sprint-edge-fill');
    edgeEl.appendChild(edgeFillEl);
    ctx.dom.app.appendChild(edgeEl);

    chipEl = el('span', 'status-item sprint-chip-status');
    chipEl.addEventListener('mousedown', (e) => { e.preventDefault(); handleStartCommand(); });
    ctx.dom.statusLeft.appendChild(chipEl);

    sprint = null;
    evokeOpen = false;
    updateVisibility();
  },

  destroy() {
    clearInterval(tickTimer);
    tickTimer = null;
    detachEvokeKeys();
    sprint = null;
    evokeOpen = false;
    [panelEl, edgeEl, chipEl].forEach(node => node && node.remove());
    panelEl = edgeEl = edgeFillEl = chipEl = timeEl = fillEl = wordsEl = goalInputEl = null;
    ctx = null;
  },

  keybindings() {
    return {
      'Mod-Shift-S': () => handleStartCommand(),
      'Mod-Shift-H': () => handleHideCommand(),
    };
  },

  commandGroups() {
    return [
      { group: 'Sprint',
        items: [
          { label: 'Start sprint',      icon: 'ti-run',     keys: ['⌘','⇧','S'], fn: handleStartCommand },
          { label: 'Hide sprint timer', icon: 'ti-eye-off', keys: ['⌘','⇧','H'], fn: handleHideCommand },
        ]
      },
    ];
  },
};
