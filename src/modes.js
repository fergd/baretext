// Mode registry — each mode is a list of feature ids from src/features/.
// Adding a feature to a mode later is a one-line change here.
export const DEFAULT_MODE = 'sprinter';

export const MODES = {
  sprinter: { id: 'sprinter', label: 'Sprinter', features: ['core', 'sprint-timer'] },
  editor:   { id: 'editor',   label: 'Editor',   features: ['core'] },
};
