export const RULES_VERSION = 1;
export const PROMPT_VERSION = 1;

export type RankTier = 'S+' | 'S' | 'A' | 'B' | 'C';
export type EngineStatus =
  'loading' | 'ready' | 'running' | 'completed' | 'interrupted' | 'error';

export interface ReplayEvent {
  t: number;
  index: number;
  correctCount: number;
}

export interface WpmSample {
  t: number; // seconds from start
  wpm: number;
}

export interface PassageRecord {
  id: string;
  content: string;
  contentHash: string;
  language: 'en' | 'vi';
  topic: 'code' | 'philosophy' | 'scifi';
  length?: 'short' | 'medium' | 'long';
  source: 'sample' | 'ai' | 'imported';
  createdAt: number;
  promptVersion: number;
}

export interface AttemptRecord {
  id: string;
  passageId: string;
  contentHash: string;
  rulesVersion: number;
  status: 'completed' | 'abandoned';
  startedAt: number;
  elapsedMs: number;
  insertedTotal: number;
  correctInsertions: number;
  correctFinal: number;
  remainingErrors: number;
  maxCombo: number;
  wpm: number;
  grossWpm: number;
  accuracy: number;
  rank: RankTier | null;
  replay: ReplayEvent[];
  replayTruncated?: boolean;
  samples: WpmSample[];
  imported?: boolean;
}

/**
 * Calculates Net WPM: (correctFinal / 5) / minutes
 * Standard 5 graphemes = 1 word, including spaces.
 */
export function calculateNetWpm(
  correctFinal: number,
  elapsedMs: number
): number {
  if (
    !Number.isFinite(correctFinal) ||
    !Number.isFinite(elapsedMs) ||
    elapsedMs <= 0 ||
    correctFinal <= 0
  ) {
    return 0;
  }
  const minutes = elapsedMs / 60000;
  const wpm = correctFinal / 5 / minutes;
  return Number.isFinite(wpm) && wpm >= 0 ? wpm : 0;
}

/**
 * Calculates Gross WPM: (insertedTotal / 5) / minutes
 */
export function calculateGrossWpm(
  insertedTotal: number,
  elapsedMs: number
): number {
  if (
    !Number.isFinite(insertedTotal) ||
    !Number.isFinite(elapsedMs) ||
    elapsedMs <= 0 ||
    insertedTotal <= 0
  ) {
    return 0;
  }
  const minutes = elapsedMs / 60000;
  const gross = insertedTotal / 5 / minutes;
  return Number.isFinite(gross) && gross >= 0 ? gross : 0;
}

/**
 * Calculates Accuracy: (correctInsertions / insertedTotal) * 100
 * Returns null before first commit (insertedTotal === 0).
 */
export function calculateAccuracy(
  correctInsertions: number,
  insertedTotal: number
): number | null {
  if (!Number.isFinite(insertedTotal) || insertedTotal <= 0) {
    return null;
  }
  if (!Number.isFinite(correctInsertions) || correctInsertions <= 0) {
    return 0;
  }
  const acc =
    (Math.min(correctInsertions, insertedTotal) / insertedTotal) * 100;
  return Number.isFinite(acc) ? Math.max(0, Math.min(100, acc)) : 0;
}

/**
 * Formats live WPM according to Section 8.1:
 * - Before starting: "0"
 * - Running < 1000ms: "—"
 * - Running >= 1000ms or completed: integer rounded WPM
 */
export function formatLiveWpm(
  correctFinal: number,
  elapsedMs: number,
  status: EngineStatus
): string {
  if (status === 'ready' || status === 'loading' || status === 'error') {
    return '0';
  }
  if (status === 'running' && elapsedMs < 1000) {
    return '—';
  }
  const wpm = calculateNetWpm(correctFinal, elapsedMs);
  return String(Math.round(wpm));
}

/**
 * Formats Accuracy to 1 decimal place, or "—" if null (before first commit).
 */
export function formatAccuracy(accuracy: number | null): string {
  if (accuracy === null || !Number.isFinite(accuracy)) {
    return '—';
  }
  return `${accuracy.toFixed(1)}%`;
}

/**
 * Evaluates Rank using unrounded WPM and Accuracy according to Section 8.2:
 * S+: WPM >= 100 && Acc >= 99%
 * S : WPM >= 80  && Acc >= 98%
 * A : WPM >= 60  && Acc >= 95%
 * B : WPM >= 40  && Acc >= 90%
 * C : Remaining completed attempts
 * Returns null if not completed or passage length < 150 graphemes.
 */
export function calculateRank(
  wpm: number,
  accuracy: number | null,
  status: 'completed' | 'abandoned' | EngineStatus,
  targetGraphemeCount: number
): RankTier | null {
  if (status !== 'completed') return null;
  if (targetGraphemeCount < 150) return null;
  if (accuracy === null || !Number.isFinite(wpm) || !Number.isFinite(accuracy))
    return null;

  if (wpm >= 100 && accuracy >= 99) return 'S+';
  if (wpm >= 80 && accuracy >= 98) return 'S';
  if (wpm >= 60 && accuracy >= 95) return 'A';
  if (wpm >= 40 && accuracy >= 90) return 'B';
  return 'C';
}

/**
 * Checks whether an attempt qualifies for Personal Best (PB) under Section 9.2:
 * - status === 'completed'
 * - accuracy >= 95% (unrounded)
 * - remainingErrors === 0
 * - matching contentHash and rulesVersion
 */
export function isPbEligible(
  attempt: AttemptRecord,
  contentHash: string,
  rulesVersion: number = RULES_VERSION
): boolean {
  return (
    attempt.status === 'completed' &&
    attempt.contentHash === contentHash &&
    attempt.rulesVersion === rulesVersion &&
    attempt.remainingErrors === 0 &&
    Number.isFinite(attempt.accuracy) &&
    attempt.accuracy >= 95
  );
}

/**
 * Comparator for two PB-eligible attempts:
 * 1. Higher WPM (unrounded)
 * 2. Higher Accuracy (unrounded)
 * 3. Earlier startedAt timestamp
 */
export function compareAttemptsForPB(
  a: AttemptRecord,
  b: AttemptRecord
): number {
  if (b.wpm !== a.wpm) {
    return b.wpm - a.wpm;
  }
  if (b.accuracy !== a.accuracy) {
    return b.accuracy - a.accuracy;
  }
  return a.startedAt - b.startedAt;
}

export interface PbAndGhostSelection {
  pbAttempt: AttemptRecord | null;
  ghostAttempt: AttemptRecord | null;
  isGhostFallbackFromPB: boolean;
}

/**
 * Selects the Personal Best (PB) attempt and the Ghost Replay attempt for a given contentHash.
 * Per Section 9.2:
 * - Ghost is the best attempt with a full replay (!replayTruncated && replay.length > 0) in the PB-eligible group.
 * - If the #1 PB lacks a full replay, Ghost uses the best eligible attempt that has a full replay,
 *   and sets isGhostFallbackFromPB = true.
 */
export function selectPbAndGhost(
  attempts: AttemptRecord[],
  contentHash: string,
  rulesVersion: number = RULES_VERSION
): PbAndGhostSelection {
  const eligible = attempts
    .filter((a) => isPbEligible(a, contentHash, rulesVersion))
    .sort(compareAttemptsForPB);

  if (eligible.length === 0) {
    return {
      pbAttempt: null,
      ghostAttempt: null,
      isGhostFallbackFromPB: false,
    };
  }

  const pbAttempt = eligible[0];
  const ghostAttempt =
    eligible.find(
      (a) =>
        !a.replayTruncated && Array.isArray(a.replay) && a.replay.length > 0
    ) || null;

  const isGhostFallbackFromPB =
    pbAttempt !== null &&
    ghostAttempt !== null &&
    pbAttempt.id !== ghostAttempt.id;

  return {
    pbAttempt,
    ghostAttempt,
    isGhostFallbackFromPB,
  };
}
