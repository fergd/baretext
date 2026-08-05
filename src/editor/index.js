import * as api from './api.js';
import { getOutline } from './outline.js';
import { insertSceneBreak } from './scene-breaks.js';
import { setRenderedMode } from './live-preview.js';
import { setSearchQuery, findNext, findPrevious, replaceCurrent, replaceAll, clearSearch } from './search.js';
import { setSpellcheck, wordAt, getSuggestions } from './spellcheck.js';

window.BaretextEditor = {
  registerKeys: api.registerKeys,
  create: api.create,
  getDoc: api.getDoc,
  setDoc: api.setDoc,
  focus: api.focus,
  centerCursor: api.centerCursor,
  getCursorPos: api.getCursorPos,
  setCursorPos: api.setCursorPos,
  cursorToEnd: api.cursorToEnd,
  insertSceneBreak,
  setRenderedMode,
  getOutline,
  setSearchQuery,
  findNext,
  findPrevious,
  replaceCurrent,
  replaceAll,
  clearSearch,
  setSpellcheck,
  spellcheckWordAt: wordAt,
  getSpellingSuggestions: getSuggestions,
};
