import { splitGraphemes } from '../utils/text';
import {
  AttemptRecord,
  calculateAccuracy,
  calculateGrossWpm,
  calculateNetWpm,
  calculateRank,
  EngineStatus,
  RankTier,
  ReplayEvent,
  RULES_VERSION,
  WpmSample,
} from '../utils/calculations';
import { appendReplayEvent } from './replayEngine';

export interface TypingEngineState {
  status: EngineStatus;
  errorMessage: string | null;
  interruptReason: string | null;

  passageId: string;
  contentHash: string;
  targetText: string;
  targetGraphemes: string[];

  attemptId: string;
  startedAtEpoch: number | null;
  startedAtPerf: number | null;
  elapsedMs: number;

  typedGraphemes: string[];
  compositionText: string;
  isComposing: boolean;

  insertedTotal: number;
  correctInsertions: number;
  correctFinal: number;
  remainingErrors: number;

  combo: number;
  maxCombo: number;

  wpm: number;
  grossWpm: number;
  accuracy: number | null;
  rank: RankTier | null;

  replay: ReplayEvent[];
  replayTruncated: boolean;
  samples: WpmSample[];
  lastSampleSecond: number;

  lastCommitOutcome: 'none' | 'correct' | 'error' | 'delete';
  lastCommitIndex: number;
}

export function createAttemptId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `att_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createInitialEngineState(): TypingEngineState {
  return {
    status: 'loading',
    errorMessage: null,
    interruptReason: null,
    passageId: '',
    contentHash: '',
    targetText: '',
    targetGraphemes: [],
    attemptId: createAttemptId(),
    startedAtEpoch: null,
    startedAtPerf: null,
    elapsedMs: 0,
    typedGraphemes: [],
    compositionText: '',
    isComposing: false,
    insertedTotal: 0,
    correctInsertions: 0,
    correctFinal: 0,
    remainingErrors: 0,
    combo: 0,
    maxCombo: 0,
    wpm: 0,
    grossWpm: 0,
    accuracy: null,
    rank: null,
    replay: [],
    replayTruncated: false,
    samples: [],
    lastSampleSecond: 0,
    lastCommitOutcome: 'none',
    lastCommitIndex: -1,
  };
}

/**
 * Loads a passage and resets the engine to `ready` state with a fresh attemptId.
 */
export function initReadyState(
  passageId: string,
  content: string,
  contentHash: string,
  attemptId: string = createAttemptId()
): TypingEngineState {
  const targetGraphemes = splitGraphemes(content);
  return {
    ...createInitialEngineState(),
    status: 'ready',
    passageId,
    contentHash,
    targetText: content,
    targetGraphemes,
    attemptId,
  };
}

/**
 * Recomputes correctFinal and remainingErrors by comparing typedGraphemes against targetGraphemes.
 */
export function computePositionCounts(
  typedGraphemes: string[],
  targetGraphemes: string[]
): { correctFinal: number; remainingErrors: number } {
  let correctFinal = 0;
  let remainingErrors = 0;
  const len = Math.min(typedGraphemes.length, targetGraphemes.length);
  for (let i = 0; i < len; i++) {
    if (typedGraphemes[i] === targetGraphemes[i]) {
      correctFinal++;
    } else {
      remainingErrors++;
    }
  }
  return { correctFinal, remainingErrors };
}

/**
 * Handles `compositionstart`:
 * Per Section 7.3, if engine is `ready`, starts the timer at `compositionstart` to include IME composition time.
 */
export function startCompositionEngine(
  state: TypingEngineState,
  nowPerf: number,
  nowEpoch: number = Date.now()
): TypingEngineState {
  if (state.status !== 'ready' && state.status !== 'running') {
    return state;
  }
  if (state.status === 'ready') {
    return {
      ...state,
      status: 'running',
      startedAtPerf: nowPerf,
      startedAtEpoch: nowEpoch,
      elapsedMs: 0,
      isComposing: true,
      compositionText: '',
    };
  }
  return {
    ...state,
    isComposing: true,
  };
}

/**
 * Updates temporary IME composition preview without scoring errors, combo, or audio.
 */
export function updateCompositionEngine(
  state: TypingEngineState,
  compositionText: string
): TypingEngineState {
  if (state.status !== 'ready' && state.status !== 'running') {
    return state;
  }
  return {
    ...state,
    isComposing: true,
    compositionText,
  };
}

/**
 * Handles canceled/empty composition:
 * Per Section 7.3: "Composition bị hủy không sinh điểm; nếu chưa có commit nào thì reset timer về `ready`."
 */
export function cancelCompositionEngine(state: TypingEngineState): TypingEngineState {
  if (state.status !== 'running' && state.status !== 'ready') {
    return state;
  }
  if (state.insertedTotal === 0 && state.typedGraphemes.length === 0) {
    return {
      ...state,
      status: 'ready',
      startedAtPerf: null,
      startedAtEpoch: null,
      elapsedMs: 0,
      isComposing: false,
      compositionText: '',
    };
  }
  return {
    ...state,
    isComposing: false,
    compositionText: '',
  };
}

/**
 * Commits one or more graphemes into the typing engine at `nowPerf`.
 * Follows all rules in Section 7.2, 7.3, 8.1, 8.2:
 * - Starts timer on first valid commit if in `ready` state.
 * - Does not allow inserting past targetGraphemes.length.
 * - Multi-grapheme IME commits are processed in order at the same timestamp.
 * - Completed triggers when typedGraphemes.length === targetGraphemes.length AND the final grapheme matches target.
 */
export function commitGraphemesEngine(
  state: TypingEngineState,
  graphemesToCommit: string[],
  nowPerf: number,
  nowEpoch: number = Date.now()
): TypingEngineState {
  if (state.status !== 'ready' && state.status !== 'running') {
    return state;
  }
  if (graphemesToCommit.length === 0) {
    return state.isComposing ? cancelCompositionEngine(state) : state;
  }

  const targetLen = state.targetGraphemes.length;
  if (targetLen === 0 || state.typedGraphemes.length >= targetLen) {
    return {
      ...state,
      isComposing: false,
      compositionText: '',
    };
  }

  const startedAtPerf = state.startedAtPerf !== null ? state.startedAtPerf : nowPerf;
  const startedAtEpoch = state.startedAtEpoch !== null ? state.startedAtEpoch : nowEpoch;
  const elapsedMs = Math.max(0, nowPerf - startedAtPerf);

  const nextTyped = [...state.typedGraphemes];
  let insertedTotal = state.insertedTotal;
  let correctInsertions = state.correctInsertions;
  let combo = state.combo;
  let maxCombo = state.maxCombo;
  let replay = state.replay;
  let replayTruncated = state.replayTruncated;
  let anyErrorInBatch = false;
  let lastCommitIndex = state.lastCommitIndex;

  for (const g of graphemesToCommit) {
    if (nextTyped.length >= targetLen) {
      break;
    }
    const pos = nextTyped.length;
    const expected = state.targetGraphemes[pos];
    const isCorrect = g === expected;

    nextTyped.push(g);
    insertedTotal += 1;
    lastCommitIndex = pos;

    if (isCorrect) {
      correctInsertions += 1;
      combo += 1;
      if (combo > maxCombo) {
        maxCombo = combo;
      }
    } else {
      combo = 0;
      anyErrorInBatch = true;
    }

    const { correctFinal: stepCorrect } = computePositionCounts(nextTyped, state.targetGraphemes);
    const replayUpdate = appendReplayEvent(replay, replayTruncated, {
      t: elapsedMs,
      index: nextTyped.length,
      correctCount: stepCorrect,
    });
    replay = replayUpdate.events;
    replayTruncated = replayUpdate.truncated;
  }

  const { correctFinal, remainingErrors } = computePositionCounts(nextTyped, state.targetGraphemes);
  const wpm = calculateNetWpm(correctFinal, elapsedMs);
  const grossWpm = calculateGrossWpm(insertedTotal, elapsedMs);
  const accuracy = calculateAccuracy(correctInsertions, insertedTotal);

  // Check if passage is completed: length equals target AND last character is correct
  const isAtEnd = nextTyped.length === targetLen;
  const isLastCharCorrect =
    isAtEnd && nextTyped[targetLen - 1] === state.targetGraphemes[targetLen - 1];

  const nextStatus: EngineStatus = isLastCharCorrect ? 'completed' : 'running';

  // Update samples up to current second
  const nextSamples = [...state.samples];
  let lastSampleSecond = state.lastSampleSecond;
  const currentWholeSecond = Math.floor(elapsedMs / 1000);
  while (lastSampleSecond < currentWholeSecond && lastSampleSecond < 3600) {
    lastSampleSecond += 1;
    const sampleElapsedMs = lastSampleSecond * 1000;
    nextSamples.push({
      t: lastSampleSecond,
      wpm: calculateNetWpm(correctFinal, sampleElapsedMs),
    });
  }

  if (nextStatus === 'completed') {
    const finalTimeSec = Number((elapsedMs / 1000).toFixed(2));
    if (
      nextSamples.length === 0 ||
      Math.abs(nextSamples[nextSamples.length - 1].t - finalTimeSec) > 0.05
    ) {
      nextSamples.push({
        t: finalTimeSec,
        wpm,
      });
    }
  }

  const rank =
    nextStatus === 'completed'
      ? calculateRank(wpm, accuracy, 'completed', targetLen)
      : null;

  return {
    ...state,
    status: nextStatus,
    startedAtPerf,
    startedAtEpoch,
    elapsedMs,
    typedGraphemes: nextTyped,
    isComposing: false,
    compositionText: '',
    insertedTotal,
    correctInsertions,
    correctFinal,
    remainingErrors,
    combo,
    maxCombo,
    wpm,
    grossWpm,
    accuracy,
    rank,
    replay,
    replayTruncated,
    samples: nextSamples,
    lastSampleSecond,
    lastCommitOutcome: anyErrorInBatch ? 'error' : 'correct',
    lastCommitIndex,
  };
}

/**
 * Deletes `count` graphemes from the end of `typedGraphemes`.
 * Per Section 7.2 & 8.2:
 * - Does not reduce insertedTotal or correctInsertions.
 * - Resets combo to 0, does not add errors.
 * - Records a replay event so Ghost Caret also moves backward.
 */
export function deleteGraphemesEngine(
  state: TypingEngineState,
  count: number,
  nowPerf: number
): TypingEngineState {
  if (state.status !== 'running') {
    return state;
  }
  const actualCount = Math.min(Math.max(1, count), state.typedGraphemes.length);
  if (actualCount === 0) {
    return {
      ...state,
      combo: 0,
      isComposing: false,
      compositionText: '',
      lastCommitOutcome: 'delete',
    };
  }

  const startedAtPerf = state.startedAtPerf ?? nowPerf;
  const elapsedMs = Math.max(0, nowPerf - startedAtPerf);
  const nextTyped = state.typedGraphemes.slice(0, state.typedGraphemes.length - actualCount);
  const { correctFinal, remainingErrors } = computePositionCounts(nextTyped, state.targetGraphemes);

  const replayUpdate = appendReplayEvent(state.replay, state.replayTruncated, {
    t: elapsedMs,
    index: nextTyped.length,
    correctCount: correctFinal,
  });

  const wpm = calculateNetWpm(correctFinal, elapsedMs);
  const grossWpm = calculateGrossWpm(state.insertedTotal, elapsedMs);

  return {
    ...state,
    elapsedMs,
    typedGraphemes: nextTyped,
    isComposing: false,
    compositionText: '',
    correctFinal,
    remainingErrors,
    combo: 0,
    wpm,
    grossWpm,
    replay: replayUpdate.events,
    replayTruncated: replayUpdate.truncated,
    lastCommitOutcome: 'delete',
    lastCommitIndex: nextTyped.length,
  };
}

/**
 * Computes the count of graphemes to delete for Ctrl/Option+Backspace (delete last word/token cluster).
 */
export function countGraphemesForWordDelete(typedGraphemes: string[]): number {
  if (typedGraphemes.length === 0) return 0;
  let i = typedGraphemes.length - 1;
  while (i >= 0 && typedGraphemes[i] === ' ') {
    i--;
  }
  while (i >= 0 && typedGraphemes[i] !== ' ') {
    i--;
  }
  return typedGraphemes.length - (i + 1);
}

/**
 * Updates live timer & 1s WPM samples during an active run without mutating input state.
 */
export function tickEngineTimer(state: TypingEngineState, nowPerf: number): TypingEngineState {
  if (state.status !== 'running' || state.startedAtPerf === null) {
    return state;
  }
  const elapsedMs = Math.max(0, nowPerf - state.startedAtPerf);
  const wpm = calculateNetWpm(state.correctFinal, elapsedMs);
  const grossWpm = calculateGrossWpm(state.insertedTotal, elapsedMs);

  let nextSamples = state.samples;
  let lastSampleSecond = state.lastSampleSecond;
  const currentWholeSecond = Math.floor(elapsedMs / 1000);

  if (currentWholeSecond > lastSampleSecond && lastSampleSecond < 3600) {
    nextSamples = [...state.samples];
    while (lastSampleSecond < currentWholeSecond && lastSampleSecond < 3600) {
      lastSampleSecond += 1;
      nextSamples.push({
        t: lastSampleSecond,
        wpm: calculateNetWpm(state.correctFinal, lastSampleSecond * 1000),
      });
    }
  }

  return {
    ...state,
    elapsedMs,
    wpm,
    grossWpm,
    samples: nextSamples,
    lastSampleSecond,
  };
}

/**
 * Interrupts a running attempt (focus lost, tab hidden, opening Settings/History).
 * Per Section 7.1 & 9.1:
 * - Ends the attempt as abandoned, no score/rank/PB.
 * - Abandoned attempts store metadata but empty replay[].
 */
export function interruptEngineAttempt(
  state: TypingEngineState,
  reason: string,
  nowPerf: number
): TypingEngineState {
  if (state.status !== 'running') {
    return state;
  }
  const elapsedMs = state.startedAtPerf !== null ? Math.max(0, nowPerf - state.startedAtPerf) : state.elapsedMs;
  const wpm = calculateNetWpm(state.correctFinal, elapsedMs);
  const grossWpm = calculateGrossWpm(state.insertedTotal, elapsedMs);

  return {
    ...state,
    status: 'interrupted',
    interruptReason: reason,
    elapsedMs,
    isComposing: false,
    compositionText: '',
    combo: 0,
    wpm,
    grossWpm,
    rank: null,
  };
}

/**
 * Builds an AttemptRecord from the current engine state for saving to IndexedDB.
 */
export function buildAttemptRecordFromState(state: TypingEngineState): AttemptRecord | null {
  if (state.status !== 'completed' && state.status !== 'interrupted') {
    return null;
  }
  const isCompleted = state.status === 'completed';
  return {
    id: state.attemptId,
    passageId: state.passageId,
    contentHash: state.contentHash,
    rulesVersion: RULES_VERSION,
    status: isCompleted ? 'completed' : 'abandoned',
    startedAt: state.startedAtEpoch ?? Date.now(),
    elapsedMs: state.elapsedMs,
    insertedTotal: state.insertedTotal,
    correctInsertions: state.correctInsertions,
    correctFinal: state.correctFinal,
    remainingErrors: state.remainingErrors,
    maxCombo: state.maxCombo,
    wpm: state.wpm,
    grossWpm: state.grossWpm,
    accuracy: state.accuracy ?? 0,
    rank: isCompleted ? state.rank : null,
    replay: isCompleted ? state.replay : [],
    replayTruncated: isCompleted ? state.replayTruncated : false,
    samples: isCompleted ? state.samples : [],
  };
}
