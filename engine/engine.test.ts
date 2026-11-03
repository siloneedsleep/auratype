import assert from 'node:assert/strict';
import test from 'node:test';
import { validateAndPrepareImport } from '../services/dataTransfer';
import {
  AttemptRecord,
  calculateAccuracy,
  calculateGrossWpm,
  calculateNetWpm,
  formatAccuracy,
  formatLiveWpm,
  RULES_VERSION,
  selectPbAndGhost,
} from '../utils/calculations';
import {
  computeContentHash,
  normalizeNFC,
  SAMPLE_PASSAGES,
  splitGraphemes,
  validatePassageText,
} from '../utils/text';
import { reconcileInputDiff, resolveCompositionEnd } from './inputAdapter';
import { calculateGhostDiff, getGhostPositionAtTime } from './replayEngine';
import {
  cancelCompositionEngine,
  commitGraphemesEngine,
  deleteGraphemesEngine,
  initReadyState,
  startCompositionEngine,
  updateCompositionEngine,
} from './typingEngine';

test('Section 15.1 - Standard 250 grapheme benchmark: 60s, 250 correct -> 50 WPM, 100% accuracy', () => {
  const passage = 'a'.repeat(250);
  const hash = computeContentHash(passage, 'en');
  let state = initReadyState('p1', passage, hash, 'att1');

  const graphemes = splitGraphemes(passage);
  assert.equal(graphemes.length, 250);

  // Start at t=0, finish at t=60,000ms
  state = commitGraphemesEngine(state, [graphemes[0]], 0, 1000);
  assert.equal(state.status, 'running');

  state = commitGraphemesEngine(state, graphemes.slice(1), 60000, 61000);
  assert.equal(state.status, 'completed');
  assert.equal(state.insertedTotal, 250);
  assert.equal(state.correctInsertions, 250);
  assert.equal(state.correctFinal, 250);
  assert.equal(state.remainingErrors, 0);
  assert.equal(state.wpm, 50);
  assert.equal(state.grossWpm, 50);
  assert.equal(state.accuracy, 100);
  assert.equal(state.rank, 'B'); // 50 WPM, 100% acc -> Rank B
});

test('Section 15.1 - 250 graphemes in 60s with 10 corrected mistakes -> 50 WPM, ~96.15% accuracy, 52 Gross WPM', () => {
  const passage = 'a'.repeat(250);
  const hash = computeContentHash(passage, 'en');
  let state = initReadyState('p1', passage, hash, 'att2');

  // Start at t=0 with 10 wrong graphemes then delete them, then type 250 correct graphemes ending at 60000ms
  state = commitGraphemesEngine(state, ['x'], 0, 1000);
  for (let i = 1; i < 10; i++) {
    state = commitGraphemesEngine(state, ['x'], i * 100, 1000 + i * 100);
  }
  assert.equal(state.insertedTotal, 10);
  assert.equal(state.correctInsertions, 0);
  assert.equal(state.remainingErrors, 10);

  // Delete all 10 mistakes
  state = deleteGraphemesEngine(state, 10, 2000);
  assert.equal(state.typedGraphemes.length, 0);
  assert.equal(state.insertedTotal, 10); // Delete does not reduce insertedTotal
  assert.equal(state.combo, 0);

  // Commit all 250 correct graphemes completing at 60,000ms
  const correctChars = splitGraphemes(passage);
  state = commitGraphemesEngine(state, correctChars, 60000, 61000);

  assert.equal(state.status, 'completed');
  assert.equal(state.insertedTotal, 260);
  assert.equal(state.correctInsertions, 250);
  assert.equal(state.correctFinal, 250);
  assert.equal(state.remainingErrors, 0);
  assert.equal(state.wpm, 50);
  assert.equal(state.grossWpm, 52);
  assert.ok(state.accuracy !== null);
  assert.equal(Number(state.accuracy.toFixed(2)), 96.15);
  assert.equal(formatAccuracy(state.accuracy), '96.2%');
});

test('Section 15.1 - Edge cases: uncorrected error, backspace at start, wrong last char, NFC & Vietnamese combining marks, no NaN/Infinity', () => {
  // 1. Backspace at start of passage does not crash or decrement counters
  const text = 'Việt Nam';
  let state = initReadyState('p_vi', text, computeContentHash(text, 'vi'));
  state = commitGraphemesEngine(state, ['V'], 100);
  state = deleteGraphemesEngine(state, 5, 200);
  assert.equal(state.typedGraphemes.length, 0);
  assert.equal(state.insertedTotal, 1);

  // 2. Wrong last character does NOT complete the passage until deleted and fixed
  const targetGraphemes = splitGraphemes(text); // ['V', 'i', 'ệ', 't', ' ', 'N', 'a', 'm']
  assert.equal(targetGraphemes.length, 8);
  state = commitGraphemesEngine(state, targetGraphemes.slice(0, 7), 1000);
  assert.equal(state.status, 'running');

  // Type wrong final character 'n' instead of 'm'
  state = commitGraphemesEngine(state, ['n'], 1500);
  assert.equal(state.status, 'running'); // Must NOT be completed!
  assert.equal(state.typedGraphemes.length, 8);
  assert.equal(state.remainingErrors, 1);

  // Attempting to type beyond passage length is ignored
  state = commitGraphemesEngine(state, ['x'], 1600);
  assert.equal(state.typedGraphemes.length, 8);
  assert.equal(state.insertedTotal, 9); // 1 ('V') + 7 + 1 ('n') = 9

  // Delete last wrong char and type 'm' -> now completed!
  state = deleteGraphemesEngine(state, 1, 1800);
  assert.equal(state.typedGraphemes.length, 7);
  state = commitGraphemesEngine(state, ['m'], 2000);
  assert.equal(state.status, 'completed');
  assert.equal(state.remainingErrors, 0);

  // 3. Uncorrected error in the middle still allows completion if last char is right
  let stateWithMidError = initReadyState(
    'p_vi',
    text,
    computeContentHash(text, 'vi')
  );
  const withMidMistake = ['V', 'x', 'ệ', 't', ' ', 'N', 'a', 'm'];
  stateWithMidError = commitGraphemesEngine(
    stateWithMidError,
    withMidMistake,
    0
  );
  stateWithMidError = commitGraphemesEngine(stateWithMidError, [], 2000); // no-op
  // Wait: committed at t=0 means elapsedMs=0, check no NaN/Infinity!
  assert.equal(Number.isFinite(stateWithMidError.wpm), true);
  assert.equal(stateWithMidError.wpm, 0);
  assert.equal(stateWithMidError.status, 'completed');
  assert.equal(stateWithMidError.remainingErrors, 1);
  assert.equal(stateWithMidError.correctFinal, 7);

  // 4. NFC vs NFD combining marks for Vietnamese ('ệ' composed vs 'e' + '\u0323' + '\u0302')
  const nfdString = 'Vie\u0323\u0302t';
  const nfcString = 'Việt';
  assert.equal(normalizeNFC(nfdString), nfcString);
  assert.deepEqual(splitGraphemes(nfdString), ['V', 'i', 'ệ', 't']);

  // 5. Zero division safety
  assert.equal(calculateNetWpm(0, 0), 0);
  assert.equal(calculateGrossWpm(10, 0), 0);
  assert.equal(calculateAccuracy(0, 0), null);
  assert.equal(formatLiveWpm(10, 500, 'running'), '—');
  assert.equal(formatLiveWpm(0, 0, 'ready'), '0');
});

test('Section 7.3 - Vietnamese IME composition lifecycle and cancellation', () => {
  const text = 'Tiếng Việt';
  let state = initReadyState('p_ime', text, computeContentHash(text, 'vi'));

  // Start composition at t=1000ms
  state = startCompositionEngine(state, 1000, 5000);
  assert.equal(state.status, 'running');
  assert.equal(state.isComposing, true);
  assert.equal(state.startedAtPerf, 1000);

  // Update composition preview ('Tie', 'Tiê', 'Tiế') -> does not increase insertedTotal or errors
  state = updateCompositionEngine(state, 'Tiế');
  assert.equal(state.insertedTotal, 0);
  assert.equal(state.compositionText, 'Tiế');

  // Cancel composition before any commit -> resets timer back to ready!
  state = cancelCompositionEngine(state);
  assert.equal(state.status, 'ready');
  assert.equal(state.startedAtPerf, null);

  // Start again and commit full multi-grapheme word from IME
  state = startCompositionEngine(state, 2000, 6000);
  const { action, committedSuffix } = resolveCompositionEnd(
    [],
    'Tiếng',
    'Tiếng'
  );
  assert.equal(action.type, 'commit');
  if (action.type === 'commit') {
    state = commitGraphemesEngine(state, action.graphemes, 2500, 6500);
  }
  assert.equal(state.typedGraphemes.join(''), 'Tiếng');
  assert.equal(state.insertedTotal, 5);
  assert.equal(state.correctInsertions, 5);

  // Immediately following `input` event with same value is deduplicated
  const followUpAction = reconcileInputDiff({
    committedGraphemes: state.typedGraphemes,
    rawTextareaValue: 'Tiếng',
    inputType: 'insertFromComposition',
    isComposing: false,
    justEndedCompositionText: committedSuffix,
  });
  assert.equal(followUpAction.type, 'noop');
});

test('Section 9.2 - PB and Ghost selection rules, tie-breaking, and Ghost timeline lookup', () => {
  const hash = 'h_test_123';
  const baseAttempt = (overrides: Partial<AttemptRecord>): AttemptRecord => ({
    id: 'a1',
    passageId: 'p1',
    contentHash: hash,
    rulesVersion: RULES_VERSION,
    status: 'completed',
    startedAt: 1000,
    elapsedMs: 30000,
    insertedTotal: 200,
    correctInsertions: 196,
    correctFinal: 200,
    remainingErrors: 0,
    maxCombo: 100,
    wpm: 80,
    grossWpm: 80,
    accuracy: 98,
    rank: 'S',
    replay: [
      { t: 500, index: 1, correctCount: 1 },
      { t: 1000, index: 2, correctCount: 2 },
      { t: 1500, index: 1, correctCount: 1 }, // Backspace!
      { t: 2000, index: 3, correctCount: 3 },
    ],
    samples: [],
    ...overrides,
  });

  const abandoned = baseAttempt({
    id: 'abandoned',
    status: 'abandoned',
    wpm: 150,
    accuracy: 100,
  });
  const lowAcc = baseAttempt({ id: 'lowAcc', wpm: 120, accuracy: 94.9 });
  const hasErrors = baseAttempt({
    id: 'hasErrors',
    wpm: 110,
    remainingErrors: 1,
  });
  const pbNoReplay = baseAttempt({
    id: 'pbNoReplay',
    wpm: 95,
    accuracy: 99,
    startedAt: 2000,
    replay: [],
    replayTruncated: true,
  });
  const ghostEligible1 = baseAttempt({
    id: 'ghost1',
    wpm: 90,
    accuracy: 98.5,
    startedAt: 3000,
  });
  const ghostEligibleTieEarlier = baseAttempt({
    id: 'ghostTieEarlier',
    wpm: 90,
    accuracy: 98.5,
    startedAt: 1500,
  });

  const selection = selectPbAndGhost(
    [
      abandoned,
      lowAcc,
      hasErrors,
      pbNoReplay,
      ghostEligible1,
      ghostEligibleTieEarlier,
    ],
    hash
  );

  // PB is pbNoReplay (95 WPM), while Ghost falls back to ghostTieEarlier (90 WPM, earlier startedAt)
  assert.equal(selection.pbAttempt?.id, 'pbNoReplay');
  assert.equal(selection.ghostAttempt?.id, 'ghostTieEarlier');
  assert.equal(selection.isGhostFallbackFromPB, true);

  // Verify Ghost timeline lookup: does not advance before event, moves back on backspace
  const replay = ghostEligible1.replay;
  assert.deepEqual(getGhostPositionAtTime(replay, 200, 200), {
    index: 0,
    correctCount: 0,
    finished: false,
  });
  assert.deepEqual(getGhostPositionAtTime(replay, 500, 200), {
    index: 1,
    correctCount: 1,
    finished: false,
  });
  assert.deepEqual(getGhostPositionAtTime(replay, 1200, 200), {
    index: 2,
    correctCount: 2,
    finished: false,
  });
  // At t=1500ms, backspace occurred -> index drops from 2 back to 1
  assert.deepEqual(getGhostPositionAtTime(replay, 1600, 200), {
    index: 1,
    correctCount: 1,
    finished: false,
  });
  assert.equal(calculateGhostDiff(5, 1), 4);
});

test('Section 12 & 15.1 - Import validation, metric recalculation, ID conflict remapping, and corrupted file rejection', () => {
  const sampleP = SAMPLE_PASSAGES[0];
  const existingHash = computeContentHash(sampleP.content, sampleP.language);
  const existingPassage = {
    id: 'p_conflict',
    content: sampleP.content,
    contentHash: existingHash,
    language: sampleP.language,
    topic: sampleP.topic,
    source: 'sample' as const,
    createdAt: 1000,
    promptVersion: 1,
  };

  // Create an import bundle with the SAME passage ID 'p_conflict' but DIFFERENT content,
  // and a fake tampered WPM (9999 WPM) to verify metric recalculation
  const differentSample = SAMPLE_PASSAGES[3];
  const bundle = {
    schemaVersion: 1,
    exportedAt: 2000,
    passages: [
      {
        id: 'p_conflict',
        content: differentSample.content,
        contentHash: 'wrong_hash',
        language: differentSample.language,
        topic: differentSample.topic,
        source: 'ai',
        createdAt: 2000,
        promptVersion: 1,
      },
    ],
    attempts: [
      {
        id: 'att_imported_1',
        passageId: 'p_conflict',
        contentHash: 'wrong_hash',
        rulesVersion: 1,
        status: 'completed',
        startedAt: 3000,
        elapsedMs: 60000,
        insertedTotal: 200,
        correctInsertions: 200,
        correctFinal: 200,
        remainingErrors: 0,
        maxCombo: 200,
        wpm: 9999, // Tampered WPM! Should recalculate to (200/5)/1 = 40 WPM
        grossWpm: 9999,
        accuracy: 10,
        rank: 'S+',
        replay: [
          { t: 1000, index: 100, correctCount: 100 },
          { t: 60000, index: 200, correctCount: 200 },
        ],
        samples: [],
      },
    ],
  };

  const plan = validateAndPrepareImport(
    JSON.stringify(bundle),
    [existingPassage],
    [],
    () => 'p_remapped_new'
  );

  assert.equal(plan.valid, true);
  assert.equal(plan.passagesRemappedCount, 1);
  assert.equal(plan.passagesToInsert.length, 1);
  assert.equal(plan.passagesToInsert[0].id, 'p_remapped_new');
  assert.equal(plan.attemptsToInsert.length, 1);
  assert.equal(plan.attemptsToInsert[0].passageId, 'p_remapped_new');
  // Recalculated WPM must be 40, not 9999!
  assert.equal(plan.attemptsToInsert[0].wpm, 40);
  assert.equal(plan.attemptsToInsert[0].accuracy, 100);
  assert.equal(plan.attemptsToInsert[0].rank, 'B');

  // Corrupted replay with decreasing timestamps must be rejected completely
  const badReplayBundle = {
    ...bundle,
    attempts: [
      {
        ...bundle.attempts[0],
        replay: [
          { t: 5000, index: 10, correctCount: 10 },
          { t: 3000, index: 20, correctCount: 20 }, // Decreasing timestamp!
        ],
      },
    ],
  };
  const badPlan = validateAndPrepareImport(
    JSON.stringify(badReplayBundle),
    [],
    []
  );
  assert.equal(badPlan.valid, false);
  assert.ok(badPlan.error?.includes('giảm dần'));
});

test('Sample passages all pass strict validatePassageText & length bounds', () => {
  for (const sample of SAMPLE_PASSAGES) {
    const check = validatePassageText(sample.content, sample.length);
    assert.equal(
      check.valid,
      true,
      `Sample ${sample.id} failed validation: ${check.reason} (count=${check.graphemeCount})`
    );
  }
});
