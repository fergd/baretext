import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, ChangeSet } from '@codemirror/state';
import { documentChanges } from '../../src/editor/document-changes.js';
import { outlineState } from '../../src/editor/outline-state.js';
import { structuralEdit } from '../../src/editor/transaction-types.js';

test('structural updates leave unchanged middle paragraphs outside changed ranges', () => {
  const before='# One\n\nAlpha.\n\n# Two\n\nMiddle prose.\n\n# Three\n\nOmega.';
  const after=before.replace('Alpha.','New alpha.').replace('Omega.','New omega.');
  const edits=documentChanges(before,after), pos=before.indexOf('Middle');
  assert.equal(edits.length,2);
  assert.ok(edits.every(c=>pos<c.from || pos>=c.to));
  const state=EditorState.create({doc:before});
  assert.equal(state.update({changes:edits}).state.doc.toString(),after);
});

test('scene identity follows its content through reorder and ordinary edits', () => {
  const before='# Chapter\n\n## Same title\n\nAlpha.\n\n## Same title\n\nBeta.';
  let state=EditorState.create({doc:before,extensions:[outlineState]});
  const alpha=state.field(outlineState).items.find(i=>i.signature.includes('Alpha.')).stableId;
  const beta=state.field(outlineState).items.find(i=>i.signature.includes('Beta.')).stableId;
  const after='# Chapter\n\n## Same title\n\nBeta.\n\n## Same title\n\nAlpha.';
  state=state.update({changes:documentChanges(before,after),annotations:structuralEdit.of(true)}).state;
  assert.equal(state.field(outlineState).items.find(i=>i.signature.includes('Alpha.')).stableId,alpha);
  assert.equal(state.field(outlineState).items.find(i=>i.signature.includes('Beta.')).stableId,beta);
  state=state.update({changes:{from:after.indexOf('Alpha.'),insert:'New '}}).state;
  assert.equal(state.field(outlineState).items.find(i=>i.signature.includes('New Alpha.')).stableId,alpha);
});

test('bare-scene identity survives removal of its leading separator during a move',()=>{
 const before='# One\n\nIntro.\n\n---\n<!-- Named -->\n\nScene body.\n\n# Two\n\nOther.';
 let state=EditorState.create({doc:before,extensions:[outlineState]});
 const id=state.field(outlineState).items.find(i=>i.signature.includes('Scene body.')).stableId;
 const after='# One\n\nIntro.\n\n# Two\n\n<!-- Named -->\n\nScene body.\n\n---\n\nOther.';
 state=state.update({changes:documentChanges(before,after),annotations:structuralEdit.of(true)}).state;
 assert.equal(state.field(outlineState).items.find(i=>i.signature.includes('Scene body.')).stableId,id);
});
