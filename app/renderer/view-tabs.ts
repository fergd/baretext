// The view chips in the top bar (DECISIONS §24): views of the open book —
// Manuscript and Corkboard — as chip tabs, not file tabs: no closing, no
// icons. A tablist; ←/→ move between chips (and switch, as tabs do).

export type View = 'manuscript' | 'corkboard';

const VIEWS: [View, string][] = [['manuscript', 'Manuscript'], ['corkboard', 'Corkboard']];

export class ViewTabs {
  readonly el: HTMLElement;

  constructor(onChoose: (view: View) => void) {
    this.el = document.createElement('div');
    this.el.className = 'bt-view-tabs';
    this.el.setAttribute('role', 'tablist');
    this.el.setAttribute('aria-label', 'View');
    for (const [view, label] of VIEWS) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'bt-view-tab';
      tab.setAttribute('role', 'tab');
      tab.dataset.view = view;
      tab.textContent = label;
      if (view === 'corkboard') tab.title = 'Corkboard  ⇧⌘C';
      tab.addEventListener('click', () => onChoose(view));
      this.el.append(tab);
    }
    this.el.addEventListener('keydown', (e) => {
      const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      const tabs = [...this.el.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
      const next = tabs[(tabs.indexOf(e.target as HTMLButtonElement) + step + tabs.length) % tabs.length]!;
      next.focus();
      onChoose(next.dataset.view as View);
    });
    this.set('manuscript');
  }

  /** Show `view` as the chosen chip. */
  set(view: View) {
    for (const tab of this.el.querySelectorAll<HTMLButtonElement>('[role="tab"]')) {
      const on = tab.dataset.view === view;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
    }
  }
}
