import * as api from './api.js';
import { getOutline } from './outline.js';
import { insertSceneBreak } from './scene-breaks.js';
import { setRenderedMode } from './live-preview.js';
import { setSearchQuery, findNext, findPrevious, replaceCurrent, replaceAll, clearSearch } from './search.js';
import { undo, redo } from './history-commands.js';
import { setBookTitle, readBookTitle } from './book-title.js';

window.BaretextEditor = {
  registerKeys: api.registerKeys,
  create: api.create,
  getDoc: api.getDoc,
  setDoc: api.setDoc,
  focus: api.focus,
  centerCursor: api.centerCursor,
  scrollToTop: api.scrollToTop,
  enterColdStorageScene: api.enterColdStorageScene,
  exitColdStorageScene: api.exitColdStorageScene,
  getColdStorageView: api.getColdStorageView,
  syncColdStorageView: api.syncColdStorageView,
  setEditorMode: api.setEditorMode,
  getCursorPos: api.getCursorPos,
  hasSelection: api.hasSelection,
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
  undo,
  redo,
  setBookTitle,
  getBookTitle: (view) => readBookTitle(api.getDoc(view)),
};
