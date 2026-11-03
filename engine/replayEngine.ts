import { ReplayEvent } from '../utils/calculations';

export const MAX_REPLAY_EVENTS = 20000;

export interface GhostPosition {
  index: number;
  correctCount: number;
  finished: boolean;
}

/**
 * Appends a replay event to the buffer if within the 20,000 event cap (Section 9.1).
 */
export function appendReplayEvent(
  events: ReplayEvent[],
  truncated: boolean,
  newEvent: ReplayEvent
): { events: ReplayEvent[]; truncated: boolean } {
  if (truncated || events.length >= MAX_REPLAY_EVENTS) {
    return { events, truncated: true };
  }
  const safeT = Math.max(0, Math.round(newEvent.t));
  const lastT = events.length > 0 ? events[events.length - 1].t : 0;
  const monotonicT = Math.max(lastT, safeT);

  const nextEvents = [
    ...events,
    {
      t: monotonicT,
      index: newEvent.index,
      correctCount: newEvent.correctCount,
    },
  ];
  return { events: nextEvents, truncated: false };
}

/**
 * Evaluates Ghost position at `elapsedMs` using binary search on recorded events (`t <= elapsedMs`).
 * Per Section 9.2:
 * - Never advances position before the event timestamp (`t <= elapsedMs`).
 * - Backspace in replay naturally moves Ghost backward because `index` in the event is smaller.
 * - If Ghost finishes before user, stays at the end of the passage.
 */
export function getGhostPositionAtTime(
  replay: ReplayEvent[] | null | undefined,
  elapsedMs: number,
  targetLength: number
): GhostPosition {
  if (!replay || replay.length === 0 || elapsedMs <= 0) {
    return { index: 0, correctCount: 0, finished: false };
  }

  let low = 0;
  let high = replay.length - 1;
  let bestIdx = -1;

  while (low <= high) {
    const mid = (low + high) >>> 1;
    if (replay[mid].t <= elapsedMs) {
      bestIdx = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  if (bestIdx === -1) {
    return { index: 0, correctCount: 0, finished: false };
  }

  const event = replay[bestIdx];
  const clampedIndex = Math.max(0, Math.min(targetLength, event.index));
  const clampedCorrect = Math.max(
    0,
    Math.min(targetLength, event.correctCount)
  );
  const finished =
    bestIdx === replay.length - 1 && clampedIndex >= targetLength;

  return {
    index: clampedIndex,
    correctCount: clampedCorrect,
    finished,
  };
}

/**
 * Calculates character lead/deficit against Ghost (`correctFinal - ghost.correctCount`).
 */
export function calculateGhostDiff(
  userCorrectFinal: number,
  ghostCorrectCount: number
): number {
  return userCorrectFinal - ghostCorrectCount;
}
