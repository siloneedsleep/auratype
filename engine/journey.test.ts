import test from 'node:test';
import assert from 'node:assert/strict';
import {
  insights,
  makeDrill,
  weeklyProgress,
  dayKey,
  dailyPassage,
  scoreChallenge,
} from '../utils/journey';
import { validatePassageText, SAMPLE_PASSAGES } from '../utils/text';
import {
  initReadyState,
  commitGraphemesEngine,
  deleteGraphemesEngine,
  buildAttemptRecordFromState,
} from './typingEngine';

test('mistakes remain in insights after correcting with backspace', () => {
  let s = initReadyState('test', 'abc', 'hash');
  s = commitGraphemesEngine(s, ['a'], 100, 1000);
  s = commitGraphemesEngine(s, ['x'], 200);
  s = deleteGraphemesEngine(s, 1, 250);
  s = commitGraphemesEngine(s, ['b'], 300);
  s = commitGraphemesEngine(s, ['c'], 400);
  const a = buildAttemptRecordFromState(s)!;
  const p = {
    ...SAMPLE_PASSAGES[0],
    id: 'test',
    language: 'en' as const,
    content: 'abc',
    contentHash: 'hash',
    source: 'sample' as const,
    createdAt: 0,
    promptVersion: 1,
  };
  const result = insights([a], [p], 'en');
  assert.equal(result.weak[0].key, 'b');
  assert.equal(result.weak[0].errors, 1);
  assert.equal(result.weak[0].hits, 2);
  assert.equal(result.pairs[0][0], 'ab');
  assert.equal(insights([a], [p], 'vi').keys.length, 0);
});
test('all personalized drills are valid and favor requested characters', () => {
  for (const lang of ['en', 'vi'] as const)
    for (const topic of ['code', 'philosophy', 'scifi'] as const) {
      const drill = makeDrill(lang, topic, ['a']);
      assert.equal(validatePassageText(drill).valid, true);
      assert.ok(drill.length < 400);
    }
});
test('daily rotation and Vietnam midnight are deterministic', () => {
  assert.equal(dayKey(Date.parse('2026-11-03T17:00:00Z')), '2026-11-04');
  assert.equal(dayKey(Date.parse('2026-11-03T16:59:59Z')), '2026-11-03');
  for (const lang of ['vi', 'en'] as const) {
    const p = dailyPassage(lang, '2026-11-04');
    assert.equal(p.language, lang);
    assert.equal(validatePassageText(p.content).valid, true);
    assert.deepEqual(p, dailyPassage(lang, '2026-11-04'));
  }
  assert.equal(weeklyProgress([], [], 'en').length, 7);
});
test('challenge score is calculated from replay and rejects impossible results', () => {
  const replay = Array.from({ length: 150 }, (_, i) => ({
    index: i + 1,
    correctCount: i + 1,
    t: i * 200,
  }));
  assert.equal(scoreChallenge(replay, 150, 31000).accuracy, 100);
  assert.throws(() => scoreChallenge(replay, 150, 10000));
  assert.throws(() =>
    scoreChallenge([{ index: 150, correctCount: 150, t: 30000 }], 150, 31000)
  );
  assert.throws(() =>
    scoreChallenge(
      replay.map((e) => ({ ...e, t: e.t / 100 })),
      150,
      31000
    )
  );
  assert.throws(() =>
    scoreChallenge([...replay.slice(0, 149), null], 150, 31000)
  );
});
