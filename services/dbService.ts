import Dexie, { type Table } from 'dexie';
import {
  AttemptRecord,
  PassageRecord,
  PROMPT_VERSION,
  selectPbAndGhost,
} from '../utils/calculations';
import { computeContentHash, SAMPLE_PASSAGES } from '../utils/text';
import { PreparedImportPlan } from './dataTransfer';

export interface MetaRecord {
  key: string;
  value: unknown;
}

class AuraTypeDatabase extends Dexie {
  passages!: Table<PassageRecord, string>;
  attempts!: Table<AttemptRecord, string>;
  meta!: Table<MetaRecord, string>;

  constructor() {
    super('AuraTypeAIDatabase');
    this.version(1).stores({
      passages: 'id, contentHash, language, topic, source, createdAt',
      attempts:
        'id, passageId, contentHash, status, startedAt, [contentHash+rulesVersion]',
      meta: 'key',
    });
  }
}

let dbInstance: AuraTypeDatabase | null = null;
let memoryFallbackActive = false;
let memoryFallbackReason: string | null = null;

const memoryPassages = new Map<string, PassageRecord>();
const memoryAttempts = new Map<string, AttemptRecord>();

function getDb(): AuraTypeDatabase | null {
  if (typeof window === 'undefined') return null;
  if (memoryFallbackActive) return null;
  if (!('indexedDB' in window) || !window.indexedDB) {
    memoryFallbackActive = true;
    memoryFallbackReason =
      'Trình duyệt hiện tại không hỗ trợ hoặc đã chặn IndexedDB.';
    return null;
  }
  if (!dbInstance) {
    try {
      dbInstance = new AuraTypeDatabase();
    } catch (err) {
      memoryFallbackActive = true;
      memoryFallbackReason =
        err instanceof Error
          ? err.message
          : 'Không thể khởi tạo cơ sở dữ liệu IndexedDB.';
      return null;
    }
  }
  return dbInstance;
}

export function getStorageStatus(): {
  isMemoryFallback: boolean;
  reason: string | null;
} {
  return {
    isMemoryFallback: memoryFallbackActive,
    reason: memoryFallbackReason,
  };
}

function activateFallbackOnQuotaOrOpenError(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  if (
    msg.includes('QuotaExceeded') ||
    msg.includes('InvalidStateError') ||
    msg.includes('UnknownError') ||
    msg.includes('DatabaseClosedError') ||
    msg.includes('SecurityError')
  ) {
    memoryFallbackActive = true;
    memoryFallbackReason = msg.includes('QuotaExceeded')
      ? 'Bộ nhớ IndexedDB đã đầy. Đang dùng phiên tạm trong bộ nhớ (lịch sử cũ không bị xóa tự động).'
      : 'IndexedDB không khả dụng trong trình duyệt này. Đang dùng phiên tạm trong bộ nhớ.';
  }
}

/**
 * Ensures all built-in sample passages exist in storage before practice starts.
 */
export async function ensureSamplePassagesSeeded(): Promise<PassageRecord[]> {
  const records: PassageRecord[] = SAMPLE_PASSAGES.map((s, idx) => ({
    id: s.id,
    content: s.content,
    contentHash: computeContentHash(s.content, s.language),
    language: s.language,
    topic: s.topic,
    length: s.length,
    source: 'sample',
    createdAt: 1700000000000 + idx * 1000,
    promptVersion: PROMPT_VERSION,
  }));

  for (const r of records) {
    if (!memoryPassages.has(r.id)) {
      memoryPassages.set(r.id, r);
    }
  }

  const db = getDb();
  if (!db) {
    return Array.from(memoryPassages.values());
  }

  try {
    await db.transaction('rw', db.passages, async () => {
      for (const r of records) {
        const existing = await db.passages.get(r.id);
        if (!existing) {
          await db.passages.put(r);
        }
      }
    });
    return await db.passages.orderBy('createdAt').reverse().toArray();
  } catch (err) {
    activateFallbackOnQuotaOrOpenError(err);
    return Array.from(memoryPassages.values());
  }
}

/**
 * Saves a passage (Sample or AI) before practice begins.
 */
export async function savePassageRecord(passage: PassageRecord): Promise<{
  saved: boolean;
  error?: string;
}> {
  memoryPassages.set(passage.id, passage);
  const db = getDb();
  if (!db) {
    return {
      saved: true,
    };
  }

  try {
    await db.transaction('rw', db.passages, async () => {
      await db.passages.put(passage);
    });
    return { saved: true };
  } catch (err) {
    activateFallbackOnQuotaOrOpenError(err);
    return {
      saved: false,
      error:
        err instanceof Error ? err.message : 'Không thể lưu bài vào IndexedDB.',
    };
  }
}

/**
 * Saves an AttemptRecord idempotently by `attempt.id` inside a transaction.
 * Strict Mode or re-renders will never create duplicate attempts.
 */
export async function saveAttemptRecord(attempt: AttemptRecord): Promise<{
  saved: boolean;
  error?: string;
}> {
  memoryAttempts.set(attempt.id, attempt);
  const db = getDb();
  if (!db) {
    if (memoryFallbackActive) {
      return {
        saved: false,
        error:
          memoryFallbackReason ||
          'IndexedDB không khả dụng. Kết quả đang được giữ tạm trong bộ nhớ phiên này.',
      };
    }
    return { saved: true };
  }

  try {
    await db.transaction('rw', db.attempts, async () => {
      const existing = await db.attempts.get(attempt.id);
      if (!existing) {
        await db.attempts.put(attempt);
      }
    });
    return { saved: true };
  } catch (err) {
    activateFallbackOnQuotaOrOpenError(err);
    return {
      saved: false,
      error:
        err instanceof Error
          ? `Lưu kết quả vào IndexedDB thất bại: ${err.message}`
          : 'Lưu kết quả thất bại. Bạn có thể thử lưu lại.',
    };
  }
}

/**
 * Loads all passages and attempts from storage.
 */
export async function loadAllHistoryData(): Promise<{
  passages: PassageRecord[];
  attempts: AttemptRecord[];
}> {
  const db = getDb();
  if (!db) {
    const passages = Array.from(memoryPassages.values()).sort(
      (a, b) => b.createdAt - a.createdAt
    );
    const attempts = Array.from(memoryAttempts.values()).sort(
      (a, b) => b.startedAt - a.startedAt
    );
    return { passages, attempts };
  }

  try {
    const [passages, attempts] = await Promise.all([
      db.passages.orderBy('createdAt').reverse().toArray(),
      db.attempts.orderBy('startedAt').reverse().toArray(),
    ]);
    for (const p of passages) memoryPassages.set(p.id, p);
    for (const a of attempts) memoryAttempts.set(a.id, a);
    return { passages, attempts };
  } catch (err) {
    activateFallbackOnQuotaOrOpenError(err);
    const passages = Array.from(memoryPassages.values()).sort(
      (a, b) => b.createdAt - a.createdAt
    );
    const attempts = Array.from(memoryAttempts.values()).sort(
      (a, b) => b.startedAt - a.startedAt
    );
    return { passages, attempts };
  }
}

/**
 * Queries PB and Ghost attempt for a given contentHash.
 */
export async function getPbAndGhostForContentHash(contentHash: string) {
  const { attempts } = await loadAllHistoryData();
  return selectPbAndGhost(attempts, contentHash);
}

/**
 * Deletes a single passage and all of its attempts in one transaction (Section 12).
 */
export async function deletePassageAndAttempts(passageId: string): Promise<{
  ok: boolean;
  error?: string;
}> {
  memoryPassages.delete(passageId);
  for (const [id, att] of memoryAttempts.entries()) {
    if (att.passageId === passageId) {
      memoryAttempts.delete(id);
    }
  }

  const db = getDb();
  if (!db) return { ok: true };

  try {
    await db.transaction('rw', db.passages, db.attempts, async () => {
      await db.attempts.where('passageId').equals(passageId).delete();
      await db.passages.delete(passageId);
    });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Xóa bài thất bại.',
    };
  }
}

/**
 * Clears all history (passages + attempts), then re-seeds sample passages. Does NOT clear settings.
 */
export async function clearAllHistory(): Promise<{
  ok: boolean;
  error?: string;
}> {
  memoryPassages.clear();
  memoryAttempts.clear();

  const db = getDb();
  if (db) {
    try {
      await db.transaction('rw', db.passages, db.attempts, async () => {
        await db.attempts.clear();
        await db.passages.clear();
      });
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Không thể xóa lịch sử.',
      };
    }
  }

  await ensureSamplePassagesSeeded();
  return { ok: true };
}

/**
 * Executes a validated import plan inside a single atomic transaction (Section 12).
 */
export async function executeImportPlan(plan: PreparedImportPlan): Promise<{
  ok: boolean;
  error?: string;
}> {
  if (!plan.valid) {
    return { ok: false, error: plan.error || 'Kế hoạch import không hợp lệ.' };
  }

  for (const p of plan.passagesToInsert) {
    memoryPassages.set(p.id, p);
  }
  for (const a of plan.attemptsToInsert) {
    memoryAttempts.set(a.id, a);
  }

  const db = getDb();
  if (!db) {
    return { ok: true };
  }

  try {
    await db.transaction('rw', db.passages, db.attempts, async () => {
      if (plan.passagesToInsert.length > 0) {
        await db.passages.bulkPut(plan.passagesToInsert);
      }
      if (plan.attemptsToInsert.length > 0) {
        await db.attempts.bulkPut(plan.attemptsToInsert);
      }
    });
    return { ok: true };
  } catch (err) {
    activateFallbackOnQuotaOrOpenError(err);
    return {
      ok: false,
      error:
        err instanceof Error
          ? `Giao dịch import thất bại: ${err.message}`
          : 'Giao dịch import thất bại.',
    };
  }
}
