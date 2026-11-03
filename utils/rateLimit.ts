export const SERVER_MIN_COOLDOWN_MS = 30_000;
export const SERVER_MAX_COOLDOWN_MS = 60_000;
export const SERVER_MAX_CONCURRENT_REQUESTS = 5;
export const SERVER_HOURLY_QUOTA = 120;

export interface ClientRateState {
  nextAllowedAt: number;
  inFlight: boolean;
}

export interface RateLimitStore {
  clients: Map<string, ClientRateState>;
  activeGlobalCount: number;
  hourlyWindowStart: number;
  hourlyCount: number;
}

export function createRateLimitStore(): RateLimitStore {
  return {
    clients: new Map<string, ClientRateState>(),
    activeGlobalCount: 0,
    hourlyWindowStart: Date.now(),
    hourlyCount: 0,
  };
}

export function resolveEffectiveCooldownMs(personalCooldownSec?: number): number {
  if (typeof personalCooldownSec !== 'number' || !Number.isFinite(personalCooldownSec)) {
    return SERVER_MIN_COOLDOWN_MS;
  }
  const requestedMs = Math.round(personalCooldownSec * 1000);
  return Math.max(SERVER_MIN_COOLDOWN_MS, Math.min(SERVER_MAX_COOLDOWN_MS, requestedMs));
}

export type RateLimitCheckResult =
  | {
      allowed: true;
      serverNow: number;
      nextAllowedAt: number;
      cooldownMs: number;
    }
  | {
      allowed: false;
      status: 429;
      reason: string;
      serverNow: number;
      nextAllowedAt: number;
      retryAfterMs: number;
    };

/**
 * Checks if a client is allowed to invoke the LLM provider.
 * Per Section 10.3:
 * - Requests rejected BEFORE calling the provider do NOT create a new cooldown.
 * - Requests accepted and forwarded to the provider immediately lock `nextAllowedAt = serverNow + cooldownMs`,
 *   even if the provider call later fails.
 */
export function acquireGenerationSlot(
  store: RateLimitStore,
  clientKey: string,
  serverNow: number,
  personalCooldownSec?: number
): RateLimitCheckResult {
  // Reset hourly window if 1 hour has passed
  if (serverNow - store.hourlyWindowStart >= 3600_000) {
    store.hourlyWindowStart = serverNow;
    store.hourlyCount = 0;
  }

  const client = store.clients.get(clientKey) || { nextAllowedAt: 0, inFlight: false };

  if (client.inFlight) {
    const retryAfterMs = Math.max(1000, client.nextAllowedAt - serverNow);
    return {
      allowed: false,
      status: 429,
      reason: 'Đang có yêu cầu tạo bài chưa kết thúc. Vui lòng chờ hoàn tất.',
      serverNow,
      nextAllowedAt: Math.max(client.nextAllowedAt, serverNow + 1000),
      retryAfterMs,
    };
  }

  if (client.nextAllowedAt > serverNow) {
    const retryAfterMs = client.nextAllowedAt - serverNow;
    return {
      allowed: false,
      status: 429,
      reason: `AI Core đang hồi năng lượng. Vui lòng chờ ${Math.ceil(retryAfterMs / 1000)} giây.`,
      serverNow,
      nextAllowedAt: client.nextAllowedAt,
      retryAfterMs,
    };
  }

  if (store.activeGlobalCount >= SERVER_MAX_CONCURRENT_REQUESTS) {
    const nextAllowedAt = serverNow + 5000;
    return {
      allowed: false,
      status: 429,
      reason: 'Máy chủ đang xử lý tối đa số yêu cầu đồng thời. Vui lòng thử lại sau ít giây.',
      serverNow,
      nextAllowedAt,
      retryAfterMs: 5000,
    };
  }

  if (store.hourlyCount >= SERVER_HOURLY_QUOTA) {
    const nextAllowedAt = store.hourlyWindowStart + 3600_000;
    return {
      allowed: false,
      status: 429,
      reason: 'Đã đạt hạn mức tạo bài chung trong giờ. Bạn vẫn có thể luyện tập với kho bài mẫu và lịch sử.',
      serverNow,
      nextAllowedAt,
      retryAfterMs: Math.max(1000, nextAllowedAt - serverNow),
    };
  }

  const cooldownMs = resolveEffectiveCooldownMs(personalCooldownSec);
  const nextAllowedAt = serverNow + cooldownMs;

  store.activeGlobalCount += 1;
  store.hourlyCount += 1;
  store.clients.set(clientKey, {
    nextAllowedAt,
    inFlight: true,
  });

  return {
    allowed: true,
    serverNow,
    nextAllowedAt,
    cooldownMs,
  };
}

export function releaseGenerationSlot(store: RateLimitStore, clientKey: string): void {
  store.activeGlobalCount = Math.max(0, store.activeGlobalCount - 1);
  const client = store.clients.get(clientKey);
  if (client) {
    client.inFlight = false;
  }
}

export function getClientCooldownStatus(
  store: RateLimitStore,
  clientKey: string,
  serverNow: number
): { serverNow: number; nextAllowedAt: number; retryAfterMs: number } {
  const client = store.clients.get(clientKey);
  const nextAllowedAt = client ? client.nextAllowedAt : 0;
  const retryAfterMs = Math.max(0, nextAllowedAt - serverNow);
  return { serverNow, nextAllowedAt, retryAfterMs };
}
