import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateBeforeInput,
  reconcileInputDiff,
  resolveCompositionEnd,
} from './inputAdapter';
import { isPasteGesture, studioShortcut } from '../utils/shortcuts';
import { initReadyState } from './typingEngine';

test('paste keys cover Windows, macOS, paste as plain text and Shift Insert', () => {
  for (const e of [
    { key: 'v', ctrlKey: true },
    { key: 'V', ctrlKey: true, shiftKey: true },
    { key: 'v', metaKey: true },
    { key: 'Insert', shiftKey: true },
    { key: 'м', code: 'KeyV', ctrlKey: true },
  ])
    assert.equal(isPasteGesture(e), true);
  for (const e of [
    { key: 'v' },
    { key: 'Insert' },
    { key: 'v', altKey: true },
    { key: 'v', ctrlKey: true, altKey: true },
  ])
    assert.equal(isPasteGesture(e), false);
});
test('single-character paste and drop cannot score even when beforeinput was skipped or composition is active', () => {
  const engine = initReadyState('paste-test', 'abc', 'hash');
  for (const inputType of [
    'insertFromPaste',
    'insertFromPasteAsQuotation',
    'insertFromDrop',
    'insertFromYank',
    'insertReplacementText',
  ])
    for (const isComposing of [false, true]) {
      assert.equal(
        evaluateBeforeInput(inputType, isComposing, 'a').shouldPreventDefault,
        true
      );
      const action = reconcileInputDiff({
        committedGraphemes: engine.typedGraphemes,
        rawTextareaValue: 'a',
        inputType,
        isComposing,
      });
      assert.equal(action.type, 'blocked');
      assert.equal(engine.status, 'ready');
      assert.equal(engine.insertedTotal, 0);
      assert.equal(engine.replay.length, 0);
    }
});
test('normal input and Vietnamese IME remain available', () => {
  assert.deepEqual(
    reconcileInputDiff({
      committedGraphemes: ['a'],
      rawTextareaValue: 'ab',
      inputType: 'insertText',
      isComposing: false,
    }),
    { type: 'commit', graphemes: ['b'] }
  );
  assert.equal(
    evaluateBeforeInput('insertCompositionText', true, 'Việt')
      .shouldPreventDefault,
    false
  );
  assert.deepEqual(resolveCompositionEnd([], 'Việt', 'Việt').action, {
    type: 'commit',
    graphemes: ['V', 'i', 'ệ', 't'],
  });
  assert.equal(
    reconcileInputDiff({
      committedGraphemes: [],
      rawTextareaValue: 'abc',
      inputType: 'insertText',
      isComposing: false,
    }).type,
    'blocked'
  );
});
test('studio shortcuts are explicit Alt chords and never intercept typing or IME/AltGr', () => {
  assert.equal(studioShortcut({ key: 'r', altKey: true }), 'retry');
  assert.equal(studioShortcut({ key: 'm', altKey: true }), 'sound');
  assert.equal(studioShortcut({ key: 'k', altKey: true }), 'keyboard');
  assert.equal(
    studioShortcut({ key: '÷', code: 'Slash', altKey: true }),
    'help'
  );
  for (const extra of [
    { altKey: false },
    { ctrlKey: true },
    { metaKey: true },
    { shiftKey: true },
    { isComposing: true },
    { altGraph: true },
  ])
    assert.equal(studioShortcut({ key: 'r', altKey: true, ...extra }), null);
  assert.equal(studioShortcut({ key: 'x', altKey: true }), null);
});
