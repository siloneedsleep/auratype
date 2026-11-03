import { Language, PassageLength, Topic } from '../utils/text';

const COOLDOWN_STORAGE_KEY = 'auratype_cooldown_state_v1';
const SESSION_ID_STORAGE_KEY = 'auratype_anon_session_v1';
const CHANNEL_NAME = 'auratype_cooldown_sync_v1';

export interface CooldownSyncPayload {
  nextAllowedAtEpoch: number;
  serverNowEpoch: number;
  savedAtEpoch: number;
}

/**
 * Pure helper to guard against stale/canceled sequence responses (Section 10.2).
 */
export class RequestSequenceTracker {
  private latestSeq = 0;
  private activeController: AbortController | null = null;
  private inFlight = false;

  public isBusy(): boolean {
    return this.inFlight;
  }

  public startNew(): { seq: number; signal: AbortSignal } {
    if (this.activeController) {
      this.activeController.abort();
    }
    this.latestSeq += 1;
    this.inFlight = true;
    this.activeController = new AbortController();
    return { seq: this.latestSeq, signal: this.activeController.signal };
  }

  public cancelCurrent(): void {
    if (this.activeController) {
      this.activeController.abort();
      this.activeController = null;
    }
    this.latestSeq += 1;
    this.inFlight = false;
  }

  public isCurrent(seq: number): boolean {
    return this.inFlight && seq === this.latestSeq;
  }

  public finish(seq: number): void {
    if (seq === this.latestSeq) {
      this.inFlight = false;
      this.activeController = null;
    }
  }
}

export function getOrCreateAnonSessionId(): string {
  if (typeof window === 'undefined') return 'ssr';
  try {
    const existing = window.localStorage.getItem(SESSION_ID_STORAGE_KEY);
    if (existing && existing.length >= 8) return existing;
    const created = `ses_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    window.localStorage.setItem(SESSION_ID_STORAGE_KEY, created);
    return created;
  } catch {
    return 'mem_session';
  }
}

export function saveCooldownToStorage(
  nextAllowedAt: number,
  serverNow: number
): void {
  if (typeof window === 'undefined') return;
  const payload: CooldownSyncPayload = {
    nextAllowedAtEpoch: nextAllowedAt,
    serverNowEpoch: serverNow,
    savedAtEpoch: Date.now(),
  };
  try {
    window.localStorage.setItem(COOLDOWN_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage errors
  }
  try {
    if ('BroadcastChannel' in window) {
      const bc = new BroadcastChannel(CHANNEL_NAME);
      bc.postMessage(payload);
      bc.close();
    }
  } catch {
    // Ignore BroadcastChannel errors
  }
}

/**
 * Restores remaining cooldown milliseconds from localStorage across page reloads,
 * compensating for local clock skew using serverNowEpoch & savedAtEpoch.
 */
export function loadRemainingCooldownMs(): {
  remainingMs: number;
  nextAllowedAtEpoch: number;
} {
  if (typeof window === 'undefined')
    return { remainingMs: 0, nextAllowedAtEpoch: 0 };
  try {
    const raw = window.localStorage.getItem(COOLDOWN_STORAGE_KEY);
    if (!raw) return { remainingMs: 0, nextAllowedAtEpoch: 0 };
    const parsed = JSON.parse(raw) as Partial<CooldownSyncPayload>;
    if (
      typeof parsed.nextAllowedAtEpoch !== 'number' ||
      typeof parsed.serverNowEpoch !== 'number' ||
      typeof parsed.savedAtEpoch !== 'number'
    ) {
      return { remainingMs: 0, nextAllowedAtEpoch: 0 };
    }
    const initialDuration = Math.max(
      0,
      parsed.nextAllowedAtEpoch - parsed.serverNowEpoch
    );
    const elapsedSinceSave = Math.max(0, Date.now() - parsed.savedAtEpoch);
    const remainingMs = Math.max(
      0,
      Math.min(86400_000, initialDuration - elapsedSinceSave)
    );
    return {
      remainingMs,
      nextAllowedAtEpoch: parsed.nextAllowedAtEpoch,
    };
  } catch {
    return { remainingMs: 0, nextAllowedAtEpoch: 0 };
  }
}

export function subscribeCooldownSync(
  onUpdate: (remainingMs: number, nextAllowedAtEpoch: number) => void
): () => void {
  if (typeof window === 'undefined') return () => {};

  const handlePayload = (payload: Partial<CooldownSyncPayload>) => {
    if (
      typeof payload.nextAllowedAtEpoch === 'number' &&
      typeof payload.serverNowEpoch === 'number'
    ) {
      const remainingMs = Math.max(
        0,
        Math.min(
          86400_000,
          payload.nextAllowedAtEpoch -
            payload.serverNowEpoch -
            Math.max(0, Date.now() - (payload.savedAtEpoch ?? Date.now()))
        )
      );
      onUpdate(remainingMs, payload.nextAllowedAtEpoch);
    }
  };

  const onStorage = (e: StorageEvent) => {
    if (e.key === COOLDOWN_STORAGE_KEY && e.newValue) {
      try {
        handlePayload(JSON.parse(e.newValue));
      } catch {
        // Ignore malformed
      }
    }
  };

  window.addEventListener('storage', onStorage);

  let bc: BroadcastChannel | null = null;
  if ('BroadcastChannel' in window) {
    try {
      bc = new BroadcastChannel(CHANNEL_NAME);
      bc.onmessage = (ev) => {
        if (ev.data && typeof ev.data === 'object') {
          handlePayload(ev.data);
        }
      };
    } catch {
      bc = null;
    }
  }

  return () => {
    window.removeEventListener('storage', onStorage);
    if (bc) {
      bc.close();
    }
  };
}

export interface GenerateStatusResponse {
  aiReady: boolean;
  reason: string | null;
  serverNow: number;
  nextAllowedAt: number;
  retryAfterMs: number;
}

export async function fetchAiProviderStatus(): Promise<GenerateStatusResponse> {
  const sessionId = getOrCreateAnonSessionId();
  const res = await fetch(
    `/api/generate?sessionId=${encodeURIComponent(sessionId)}`,
    {
      method: 'GET',
      cache: 'no-store',
    }
  );
  const data = await res.json();
  return {
    aiReady: Boolean(data.aiReady),
    reason: typeof data.reason === 'string' ? data.reason : null,
    serverNow: Number(data.serverNow) || Date.now(),
    nextAllowedAt: Number(data.nextAllowedAt) || 0,
    retryAfterMs: Number(data.retryAfterMs) || 0,
  };
}

export interface GeneratePassageParams {
  language: Language;
  topic: Topic;
  length: PassageLength;
  personalCooldownSec: number;
  seenHashes?: string[];
  signal?: AbortSignal;
}

export interface GeneratePassageResult {
  ok: boolean;
  text?: string;
  graphemeCount?: number;
  error?: string;
  aiReady?: boolean;
  serverNow: number;
  nextAllowedAt: number;
  retryAfterMs: number;
}

export async function requestAiPassage(
  params: GeneratePassageParams
): Promise<GeneratePassageResult> {
  const sessionId = getOrCreateAnonSessionId();
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      language: params.language,
      topic: params.topic,
      length: params.length,
      personalCooldownSec: params.personalCooldownSec,
      seenHashes: params.seenHashes,
      sessionId,
      requestId,
    }),
    signal: params.signal,
  });

  const data = await res.json();
  const serverNow = Number(data.serverNow) || Date.now();
  const nextAllowedAt = Number(data.nextAllowedAt) || 0;
  const retryAfterMs =
    Number(data.retryAfterMs) || Math.max(0, nextAllowedAt - serverNow);

  if (nextAllowedAt > serverNow) {
    saveCooldownToStorage(nextAllowedAt, serverNow);
  }

  if (!res.ok) {
    return {
      ok: false,
      error:
        typeof data.error === 'string'
          ? data.error
          : `Yêu cầu thất bại với mã trạng thái ${res.status}.`,
      aiReady: data.aiReady !== false,
      serverNow,
      nextAllowedAt,
      retryAfterMs,
    };
  }

  return {
    ok: true,
    text: String(data.text || ''),
    graphemeCount: Number(data.graphemeCount) || 0,
    aiReady: true,
    serverNow,
    nextAllowedAt,
    retryAfterMs,
  };
}
