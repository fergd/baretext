// Plugin keys shared between modules (kept apart to avoid import cycles).

import { PluginKey } from 'prosemirror-state';

/** The parked (Cold Storage) scene open on the page, by id, or null. */
export const parkedKey = new PluginKey<string | null>('parked');
