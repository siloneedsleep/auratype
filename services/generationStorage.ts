import { randomUUID } from 'node:crypto';

const memory = new Map<string, { value: unknown; until: number }>();
const getMemory = (key: string) => {
  const item = memory.get(key);
  if (item && item.until > Date.now()) return item.value;
  memory.delete(key);
  return null;
};

export function hasSharedStorage() {
  return Boolean(
    (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL) &&
    (process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN)
  );
}
export function generationStorageReady() {
  return hasSharedStorage() || process.env.NODE_ENV !== 'production';
}
export async function redis(command: (string | number)[]): Promise<unknown> {
  const response = await fetch(
    (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL)!,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(command),
      cache: 'no-store',
      signal: AbortSignal.timeout(4000),
    }
  );
  if (!response.ok) throw new Error('Shared storage unavailable');
  const data = await response.json();
  if (data.error) throw new Error('Shared storage rejected command');
  return data.result;
}
export async function readValue<T>(key: string): Promise<T | null> {
  if (!hasSharedStorage()) return getMemory(key) as T | null;
  const raw = await redis(['GET', `auratype:v2:${key}`]);
  return typeof raw === 'string' ? (JSON.parse(raw) as T) : null;
}
export async function writeValue(key: string, value: unknown, seconds: number) {
  if (hasSharedStorage())
    await redis([
      'SET',
      `auratype:v2:${key}`,
      JSON.stringify(value),
      'EX',
      seconds,
    ]);
  else {
    if (memory.size > 2000) for (const k of memory.keys()) getMemory(k);
    memory.set(key, { value, until: Date.now() + seconds * 1000 });
  }
}

// All budgets and leases are acquired atomically across serverless instances.
const RESERVE = `
local now=tonumber(ARGV[1]); local cooldown=tonumber(ARGV[2]); local bill=tonumber(ARGV[3]);
local user=tonumber(redis.call('GET',KEYS[1]) or '0');
local blocked=tonumber(redis.call('GET',KEYS[5]) or '0');
if user>now then return {0,user} end
if bill==1 and blocked>now then return {0,blocked} end
redis.call('ZREMRANGEBYSCORE',KEYS[4],'-inf',now)
if redis.call('ZCARD',KEYS[4])>=5 then return {0,now+5000} end
if bill==1 then
 if tonumber(redis.call('GET',KEYS[2]) or '0')>=tonumber(ARGV[4]) then return {0,now+60000} end
 if tonumber(redis.call('GET',KEYS[3]) or '0')>=tonumber(ARGV[5]) then return {0,now+3600000} end
 redis.call('INCR',KEYS[2]); redis.call('EXPIRE',KEYS[2],86400)
 redis.call('INCR',KEYS[3]); redis.call('EXPIRE',KEYS[3],3600)
end
redis.call('SET',KEYS[1],now+cooldown,'PX',cooldown)
redis.call('ZADD',KEYS[4],now+25000,ARGV[6]); redis.call('EXPIRE',KEYS[4],60)
return {1,now+cooldown}`;

export type Reservation = {
  allowed: boolean;
  nextAllowedAt: number;
  lease: string;
};
export async function reserveGeneration(
  client: string,
  cooldown: number,
  callsProvider: boolean
): Promise<Reservation> {
  if (!generationStorageReady())
    throw new Error('Shared rate limiting is not configured');
  const now = Date.now(),
    lease = randomUUID();
  const day = Math.floor(now / 86400000),
    hour = Math.floor(now / 3600000);
  const dailyLimit = positiveLimit(process.env.AI_DAILY_REQUEST_LIMIT, 500);
  const hourlyLimit = positiveLimit(process.env.AI_HOURLY_REQUEST_LIMIT, 120);
  if (hasSharedStorage()) {
    const result = (await redis([
      'EVAL',
      RESERVE,
      5,
      `auratype:v2:user:${client}`,
      `auratype:v2:day:${day}`,
      `auratype:v2:hour:${hour}`,
      'auratype:v2:leases',
      'auratype:v2:provider-block',
      now,
      cooldown,
      callsProvider ? 1 : 0,
      dailyLimit,
      hourlyLimit,
      lease,
    ])) as number[];
    return {
      allowed: result[0] === 1,
      nextAllowedAt: Number(result[1]),
      lease,
    };
  }
  // Local development only; this branch contains no awaits, so acquisition is atomic.
  const userKey = `user:${client}`,
    dayKey = `day:${day}`,
    hourKey = `hour:${hour}`;
  const next = Math.max(
    Number(getMemory(userKey) ?? 0),
    callsProvider ? Number(getMemory('provider-block') ?? 0) : 0
  );
  if (next > now) return { allowed: false, nextAllowedAt: next, lease };
  if (
    callsProvider &&
    (Number(getMemory(dayKey) ?? 0) >= dailyLimit ||
      Number(getMemory(hourKey) ?? 0) >= hourlyLimit)
  )
    return { allowed: false, nextAllowedAt: now + 60_000, lease };
  const active = [...memory.keys()].filter(
    (k) => k.startsWith('lease:') && getMemory(k)
  );
  if (active.length >= 5)
    return { allowed: false, nextAllowedAt: now + 5000, lease };
  memory.set(userKey, { value: now + cooldown, until: now + cooldown });
  memory.set(`lease:${lease}`, { value: true, until: now + 25000 });
  if (callsProvider) {
    memory.set(dayKey, {
      value: Number(getMemory(dayKey) ?? 0) + 1,
      until: (day + 1) * 86400000,
    });
    memory.set(hourKey, {
      value: Number(getMemory(hourKey) ?? 0) + 1,
      until: (hour + 1) * 3600000,
    });
  }
  return { allowed: true, nextAllowedAt: now + cooldown, lease };
}
export async function releaseGeneration(lease: string) {
  if (hasSharedStorage()) await redis(['ZREM', 'auratype:v2:leases', lease]);
  else memory.delete(`lease:${lease}`);
}
export async function nextAllowed(client: string) {
  return Number((await readValue(`user:${client}`)) ?? 0);
}
function positiveLimit(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0
    ? Math.min(parsed, 10000)
    : fallback;
}

/** Append in Redis to avoid lost cache updates from concurrent generators. */
export async function addCachedPassage(bucket: string, text: string) {
  if (hasSharedStorage()) {
    await redis([
      'EVAL',
      "redis.call('LPUSH',KEYS[1],ARGV[1]); redis.call('LTRIM',KEYS[1],0,49); redis.call('EXPIRE',KEYS[1],86400); return 1",
      1,
      `auratype:v2:pool:${bucket}`,
      text,
    ]);
  } else {
    const list = (getMemory(`pool:${bucket}`) ?? []) as string[];
    await writeValue(`pool:${bucket}`, [text, ...list].slice(0, 50), 86400);
  }
}
export async function cachedPassages(bucket: string): Promise<string[]> {
  return hasSharedStorage()
    ? ((await redis([
        'LRANGE',
        `auratype:v2:pool:${bucket}`,
        0,
        49,
      ])) as string[])
    : ((getMemory(`pool:${bucket}`) ?? []) as string[]);
}

let localCredentialCursor = 0;
export async function nextCredentialOffset(count: number) {
  if (count <= 0) return 0;
  if (hasSharedStorage())
    return (
      (Number(await redis(['INCR', 'auratype:v2:credential-cursor'])) - 1) %
      count
    );
  return localCredentialCursor++ % count;
}
