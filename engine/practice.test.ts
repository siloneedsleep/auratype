import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getSamplePassage,
  splitGraphemes,
  validatePassageText,
} from '../utils/text';
import {
  prepareCustomPassage,
  targetPosition,
  mistakeTargets,
} from '../utils/practice';
import {
  initReadyState,
  commitGraphemesEngine,
  tickEngineTimer,
} from './typingEngine';
import { RequestSequenceTracker } from '../services/llmService';
import { evaluateBeforeInput } from './inputAdapter';

test('every language, topic and length yields a valid matching sample', () => {
  for (const lang of ['en', 'vi'] as const)
    for (const topic of ['code', 'philosophy', 'scifi'] as const)
      for (const length of ['short', 'medium', 'long'] as const) {
        const sample = getSamplePassage(lang, topic, length);
        assert.equal(sample.language, lang);
        assert.equal(sample.topic, topic);
        assert.equal(sample.length, length);
        assert.equal(
          validatePassageText(sample.content, length).valid,
          true,
          sample.id
        );
      }
});
test('custom passage normalizes whitespace and Vietnamese without truncating', () => {
  const sample = getSamplePassage('vi', 'code', 'short');
  const result = prepareCustomPassage(
    sample.content.normalize('NFD').replaceAll(' ', '\n\t')
  );
  assert.equal(result.valid, true);
  assert.equal(result.normalizedText, sample.content);
  assert.equal(prepareCustomPassage('a'.repeat(1401)).valid, false);
});
test('target opponent follows 5-character WPM convention and clamps to end', () => {
  assert.equal(targetPosition(60, 30000, 500), 150);
  assert.equal(targetPosition(60, 60000, 200), 200);
  assert.equal(targetPosition(60, -100, 200), 0);
});
test('historical WPM samples do not count characters typed later', () => {
  let s = initReadyState('sample', 'a'.repeat(250), 'hash');
  s = commitGraphemesEngine(s, ['a'], 0);
  s = commitGraphemesEngine(s, splitGraphemes('a'.repeat(249)), 60000);
  assert.equal(s.samples.find((p) => p.t === 1)?.wpm, 12);
  assert.equal(s.samples.find((p) => p.t === 30)?.wpm, 0.4);
  assert.equal(s.wpm, 50);
  assert.equal(tickEngineTimer(s, 70000), s);
});
test('stale/canceled AI responses cannot become current', () => {
  const tracker = new RequestSequenceTracker();
  const a = tracker.startNew();
  tracker.cancelCurrent();
  assert.equal(a.signal.aborted, true);
  assert.equal(tracker.isCurrent(a.seq), false);
  const b = tracker.startNew();
  tracker.finish(a.seq);
  assert.equal(tracker.isCurrent(b.seq), true);
});
test('paste is blocked, IME previews are not scored, mistake hints refer to target', () => {
  assert.equal(
    evaluateBeforeInput('insertFromPaste', false, 'text').shouldPreventDefault,
    true
  );
  assert.equal(
    evaluateBeforeInput('insertCompositionText', true, 'Việt')
      .shouldPreventDefault,
    false
  );
  assert.deepEqual(mistakeTargets(['a', 'b', 'a'], ['x', 'b', 'z']), [
    ['a', 2],
  ]);
});
