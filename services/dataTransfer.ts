import { MAX_REPLAY_EVENTS } from '../engine/replayEngine';
import {
  AttemptRecord,
  calculateAccuracy,
  calculateGrossWpm,
  calculateNetWpm,
  calculateRank,
  PassageRecord,
  PROMPT_VERSION,
  ReplayEvent,
  RULES_VERSION,
  WpmSample,
} from '../utils/calculations';
import {
  computeContentHash,
  Language,
  PassageLength,
  splitGraphemes,
  Topic,
  validatePassageText,
} from '../utils/text';

export const EXPORT_SCHEMA_VERSION = 1;
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_IMPORT_PASSAGES = 1000;
export const MAX_IMPORT_ATTEMPTS = 5000;

export interface ExportableSettings {
  fxMode: 'lite' | 'ultra';
  ghostEnabled: boolean;
  screenShakeEnabled: boolean;
  cometTrailEnabled: boolean;
  soundEnabled: boolean;
  soundProfile: 'creamy' | 'thock' | 'typewriter';
  soundVolume: number;
  language: Language;
  topic: Topic;
  length: PassageLength;
  personalCooldownSec: number;
}

export interface AuraTypeExportBundle {
  schemaVersion: number;
  exportedAt: number;
  passages: PassageRecord[];
  attempts: AttemptRecord[];
  settings?: Partial<ExportableSettings>;
}

export interface PreparedImportPlan {
  valid: boolean;
  error?: string;
  passagesToInsert: PassageRecord[];
  passagesSkippedCount: number;
  passagesRemappedCount: number;
  attemptsToInsert: AttemptRecord[];
  attemptsSkippedCount: number;
}

function isFiniteNonNegative(val: unknown): val is number {
  return typeof val === 'number' && Number.isFinite(val) && val >= 0;
}

/**
 * Creates a clean export JSON bundle containing only non-sensitive data (Section 12).
 */
export function createExportBundle(
  passages: PassageRecord[],
  attempts: AttemptRecord[],
  settings: ExportableSettings
): AuraTypeExportBundle {
  const cleanPassages: PassageRecord[] = passages.map((p) => ({
    id: String(p.id),
    content: String(p.content),
    contentHash: String(p.contentHash),
    language: p.language === 'vi' ? 'vi' : 'en',
    topic: p.topic === 'code' || p.topic === 'scifi' ? p.topic : 'philosophy',
    ...(p.length ? { length: p.length } : {}),
    source: p.source,
    createdAt: Number(p.createdAt) || Date.now(),
    promptVersion: Number(p.promptVersion) || PROMPT_VERSION,
  }));

  const cleanAttempts: AttemptRecord[] = attempts.map((a) => ({
    id: String(a.id),
    passageId: String(a.passageId),
    contentHash: String(a.contentHash),
    rulesVersion: Number(a.rulesVersion) || RULES_VERSION,
    status: a.status === 'completed' ? 'completed' : 'abandoned',
    startedAt: Number(a.startedAt) || Date.now(),
    elapsedMs: Number(a.elapsedMs) || 0,
    insertedTotal: Number(a.insertedTotal) || 0,
    correctInsertions: Number(a.correctInsertions) || 0,
    correctFinal: Number(a.correctFinal) || 0,
    remainingErrors: Number(a.remainingErrors) || 0,
    maxCombo: Number(a.maxCombo) || 0,
    wpm: Number(a.wpm) || 0,
    grossWpm: Number(a.grossWpm) || 0,
    accuracy: Number(a.accuracy) || 0,
    rank: a.rank ?? null,
    replay: Array.isArray(a.replay)
      ? a.replay.map((r) => ({
          t: Number(r.t) || 0,
          index: Number(r.index) || 0,
          correctCount: Number(r.correctCount) || 0,
        }))
      : [],
    replayTruncated: Boolean(a.replayTruncated),
    samples: Array.isArray(a.samples)
      ? a.samples.map((s) => ({
          t: Number(s.t) || 0,
          wpm: Number(s.wpm) || 0,
        }))
      : [],
    ...(a.imported ? { imported: true } : {}),
  }));

  const cleanSettings: ExportableSettings = {
    fxMode: settings.fxMode === 'ultra' ? 'ultra' : 'lite',
    ghostEnabled: Boolean(settings.ghostEnabled),
    screenShakeEnabled: Boolean(settings.screenShakeEnabled),
    cometTrailEnabled: Boolean(settings.cometTrailEnabled),
    soundEnabled: Boolean(settings.soundEnabled),
    soundProfile:
      settings.soundProfile === 'thock' ||
      settings.soundProfile === 'typewriter'
        ? settings.soundProfile
        : 'creamy',
    soundVolume: Math.max(0, Math.min(100, Number(settings.soundVolume) || 0)),
    language: settings.language === 'en' ? 'en' : 'vi',
    topic:
      settings.topic === 'code' || settings.topic === 'scifi'
        ? settings.topic
        : 'philosophy',
    length:
      settings.length === 'medium' || settings.length === 'long'
        ? settings.length
        : 'short',
    personalCooldownSec: Math.max(
      30,
      Math.min(60, Number(settings.personalCooldownSec) || 30)
    ),
  };

  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: Date.now(),
    passages: cleanPassages,
    attempts: cleanAttempts,
    settings: cleanSettings,
  };
}

/**
 * Validates and prepares an import plan against existing passages & attempts in DB.
 * Strictly implements Section 12:
 * - Size <= 10MB
 * - Valid schemaVersion
 * - Unique IDs inside file
 * - Valid passage content & grapheme lengths
 * - Referential integrity between attempts and passages
 * - Non-negative finite counters, monotonic replay timestamps, index <= passage grapheme length
 * - Recalculates WPM, Gross WPM, Accuracy, and Rank from raw counters
 * - Remaps passage IDs when an imported passage has the same ID as an existing passage with different content
 */
export function validateAndPrepareImport(
  rawJsonText: string,
  existingPassages: PassageRecord[],
  existingAttempts: AttemptRecord[],
  idGenerator: () => string = () =>
    `imp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
): PreparedImportPlan {
  const byteLength =
    typeof TextEncoder !== 'undefined'
      ? new TextEncoder().encode(rawJsonText).length
      : rawJsonText.length;

  if (byteLength > MAX_IMPORT_BYTES) {
    return {
      valid: false,
      error: 'Dung lượng file vượt quá giới hạn 10MB.',
      passagesToInsert: [],
      passagesSkippedCount: 0,
      passagesRemappedCount: 0,
      attemptsToInsert: [],
      attemptsSkippedCount: 0,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJsonText);
  } catch {
    return {
      valid: false,
      error: 'File không phải định dạng JSON hợp lệ.',
      passagesToInsert: [],
      passagesSkippedCount: 0,
      passagesRemappedCount: 0,
      attemptsToInsert: [],
      attemptsSkippedCount: 0,
    };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      valid: false,
      error: 'Cấu trúc dữ liệu gốc không hợp lệ.',
      passagesToInsert: [],
      passagesSkippedCount: 0,
      passagesRemappedCount: 0,
      attemptsToInsert: [],
      attemptsSkippedCount: 0,
    };
  }

  const root = parsed as Record<string, unknown>;
  if (root.schemaVersion !== EXPORT_SCHEMA_VERSION) {
    return {
      valid: false,
      error: `Phiên bản schema không được hỗ trợ (yêu cầu schemaVersion = ${EXPORT_SCHEMA_VERSION}).`,
      passagesToInsert: [],
      passagesSkippedCount: 0,
      passagesRemappedCount: 0,
      attemptsToInsert: [],
      attemptsSkippedCount: 0,
    };
  }

  if (!Array.isArray(root.passages) || !Array.isArray(root.attempts)) {
    return {
      valid: false,
      error: 'Thiếu danh sách passages hoặc attempts trong file import.',
      passagesToInsert: [],
      passagesSkippedCount: 0,
      passagesRemappedCount: 0,
      attemptsToInsert: [],
      attemptsSkippedCount: 0,
    };
  }

  if (root.passages.length > MAX_IMPORT_PASSAGES) {
    return {
      valid: false,
      error: `Số lượng bài vượt quá giới hạn cho phép (${MAX_IMPORT_PASSAGES}).`,
      passagesToInsert: [],
      passagesSkippedCount: 0,
      passagesRemappedCount: 0,
      attemptsToInsert: [],
      attemptsSkippedCount: 0,
    };
  }

  if (root.attempts.length > MAX_IMPORT_ATTEMPTS) {
    return {
      valid: false,
      error: `Số lượng lượt gõ vượt quá giới hạn cho phép (${MAX_IMPORT_ATTEMPTS}).`,
      passagesToInsert: [],
      passagesSkippedCount: 0,
      passagesRemappedCount: 0,
      attemptsToInsert: [],
      attemptsSkippedCount: 0,
    };
  }

  const existingPassageById = new Map<string, PassageRecord>();
  const existingPassageByHash = new Map<string, PassageRecord>();
  for (const p of existingPassages) {
    existingPassageById.set(p.id, p);
    existingPassageByHash.set(p.contentHash, p);
  }

  const existingAttemptById = new Map<string, AttemptRecord>();
  for (const a of existingAttempts) {
    existingAttemptById.set(a.id, a);
  }

  const filePassageIds = new Set<string>();
  const filePassageMap = new Map<
    string,
    { finalId: string; contentHash: string; graphemeCount: number }
  >();

  const passagesToInsert: PassageRecord[] = [];
  let passagesSkippedCount = 0;
  let passagesRemappedCount = 0;

  for (let i = 0; i < root.passages.length; i++) {
    const rawP = root.passages[i] as Record<string, unknown>;
    if (!rawP || typeof rawP !== 'object') {
      return {
        valid: false,
        error: `Passage ở vị trí ${i} không hợp lệ.`,
        passagesToInsert: [],
        passagesSkippedCount: 0,
        passagesRemappedCount: 0,
        attemptsToInsert: [],
        attemptsSkippedCount: 0,
      };
    }

    const id = typeof rawP.id === 'string' ? rawP.id.trim() : '';
    const language =
      rawP.language === 'en' || rawP.language === 'vi' ? rawP.language : null;
    const topic =
      rawP.topic === 'code' ||
      rawP.topic === 'philosophy' ||
      rawP.topic === 'scifi'
        ? rawP.topic
        : null;
    const createdAt = rawP.createdAt;

    if (!id || !language || !topic || !isFiniteNonNegative(createdAt)) {
      return {
        valid: false,
        error: `Passage "${id || i}" thiếu trường bắt buộc hoặc kiểu dữ liệu sai.`,
        passagesToInsert: [],
        passagesSkippedCount: 0,
        passagesRemappedCount: 0,
        attemptsToInsert: [],
        attemptsSkippedCount: 0,
      };
    }

    if (filePassageIds.has(id)) {
      return {
        valid: false,
        error: `Passage ID "${id}" bị trùng lặp trong cùng file import.`,
        passagesToInsert: [],
        passagesSkippedCount: 0,
        passagesRemappedCount: 0,
        attemptsToInsert: [],
        attemptsSkippedCount: 0,
      };
    }
    filePassageIds.add(id);

    const textCheck = validatePassageText(String(rawP.content ?? ''));
    if (!textCheck.valid) {
      return {
        valid: false,
        error: `Passage "${id}" có nội dung không hợp lệ: ${textCheck.reason}`,
        passagesToInsert: [],
        passagesSkippedCount: 0,
        passagesRemappedCount: 0,
        attemptsToInsert: [],
        attemptsSkippedCount: 0,
      };
    }

    const computedHash = computeContentHash(textCheck.normalizedText, language);
    const existingWithId = existingPassageById.get(id);
    const existingWithHash = existingPassageByHash.get(computedHash);

    if (existingWithId) {
      if (existingWithId.contentHash === computedHash) {
        // Same ID and same content -> skip inserting passage, keep same ID
        passagesSkippedCount++;
        filePassageMap.set(id, {
          finalId: existingWithId.id,
          contentHash: computedHash,
          graphemeCount: textCheck.graphemeCount,
        });
      } else if (existingWithHash) {
        // Different content from existingWithId, but content already exists under another ID
        passagesSkippedCount++;
        filePassageMap.set(id, {
          finalId: existingWithHash.id,
          contentHash: computedHash,
          graphemeCount: textCheck.graphemeCount,
        });
      } else {
        // Same ID but different content -> assign new ID and remap attempts!
        const newId = idGenerator();
        passagesRemappedCount++;
        const record: PassageRecord = {
          id: newId,
          content: textCheck.normalizedText,
          contentHash: computedHash,
          language,
          topic,
          source: 'imported',
          createdAt,
          promptVersion: isFiniteNonNegative(rawP.promptVersion)
            ? Number(rawP.promptVersion)
            : PROMPT_VERSION,
        };
        passagesToInsert.push(record);
        filePassageMap.set(id, {
          finalId: newId,
          contentHash: computedHash,
          graphemeCount: textCheck.graphemeCount,
        });
      }
    } else if (existingWithHash) {
      // Content already exists under another ID -> reuse existing passage ID
      passagesSkippedCount++;
      filePassageMap.set(id, {
        finalId: existingWithHash.id,
        contentHash: computedHash,
        graphemeCount: textCheck.graphemeCount,
      });
    } else {
      const record: PassageRecord = {
        id,
        content: textCheck.normalizedText,
        contentHash: computedHash,
        language,
        topic,
        source: 'imported',
        createdAt,
        promptVersion: isFiniteNonNegative(rawP.promptVersion)
          ? Number(rawP.promptVersion)
          : PROMPT_VERSION,
      };
      passagesToInsert.push(record);
      filePassageMap.set(id, {
        finalId: id,
        contentHash: computedHash,
        graphemeCount: textCheck.graphemeCount,
      });
    }
  }

  const fileAttemptIds = new Set<string>();
  const attemptsToInsert: AttemptRecord[] = [];
  let attemptsSkippedCount = 0;

  for (let i = 0; i < root.attempts.length; i++) {
    const rawA = root.attempts[i] as Record<string, unknown>;
    if (!rawA || typeof rawA !== 'object') {
      return {
        valid: false,
        error: `Attempt ở vị trí ${i} không hợp lệ.`,
        passagesToInsert: [],
        passagesSkippedCount: 0,
        passagesRemappedCount: 0,
        attemptsToInsert: [],
        attemptsSkippedCount: 0,
      };
    }

    const id = typeof rawA.id === 'string' ? rawA.id.trim() : '';
    const origPassageId =
      typeof rawA.passageId === 'string' ? rawA.passageId.trim() : '';
    const status =
      rawA.status === 'completed' || rawA.status === 'abandoned'
        ? rawA.status
        : null;

    if (!id || !origPassageId || !status) {
      return {
        valid: false,
        error: `Attempt "${id || i}" thiếu id, passageId hoặc status hợp lệ.`,
        passagesToInsert: [],
        passagesSkippedCount: 0,
        passagesRemappedCount: 0,
        attemptsToInsert: [],
        attemptsSkippedCount: 0,
      };
    }

    if (fileAttemptIds.has(id)) {
      return {
        valid: false,
        error: `Attempt ID "${id}" bị trùng lặp trong cùng file import.`,
        passagesToInsert: [],
        passagesSkippedCount: 0,
        passagesRemappedCount: 0,
        attemptsToInsert: [],
        attemptsSkippedCount: 0,
      };
    }
    fileAttemptIds.add(id);

    // Check passage reference in file or in existing DB
    let linkedPassage = filePassageMap.get(origPassageId);
    if (!linkedPassage) {
      const existingP = existingPassageById.get(origPassageId);
      if (existingP) {
        linkedPassage = {
          finalId: existingP.id,
          contentHash: existingP.contentHash,
          graphemeCount: splitGraphemes(existingP.content).length,
        };
      }
    }

    if (!linkedPassage) {
      return {
        valid: false,
        error: `Attempt "${id}" tham chiếu tới passageId "${origPassageId}" không tồn tại.`,
        passagesToInsert: [],
        passagesSkippedCount: 0,
        passagesRemappedCount: 0,
        attemptsToInsert: [],
        attemptsSkippedCount: 0,
      };
    }

    const startedAt = rawA.startedAt;
    const elapsedMs = rawA.elapsedMs;
    const insertedTotal = rawA.insertedTotal;
    const correctInsertions = rawA.correctInsertions;
    const correctFinal = rawA.correctFinal;
    const remainingErrors = rawA.remainingErrors;
    const maxCombo = rawA.maxCombo;

    if (
      !isFiniteNonNegative(startedAt) ||
      !isFiniteNonNegative(elapsedMs) ||
      !isFiniteNonNegative(insertedTotal) ||
      !isFiniteNonNegative(correctInsertions) ||
      !isFiniteNonNegative(correctFinal) ||
      !isFiniteNonNegative(remainingErrors) ||
      !isFiniteNonNegative(maxCombo)
    ) {
      return {
        valid: false,
        error: `Attempt "${id}" chứa bộ đếm âm hoặc không phải số hữu hạn.`,
        passagesToInsert: [],
        passagesSkippedCount: 0,
        passagesRemappedCount: 0,
        attemptsToInsert: [],
        attemptsSkippedCount: 0,
      };
    }

    if (
      correctInsertions > insertedTotal ||
      correctFinal > linkedPassage.graphemeCount ||
      remainingErrors > linkedPassage.graphemeCount ||
      correctFinal + remainingErrors > linkedPassage.graphemeCount
    ) {
      return {
        valid: false,
        error: `Attempt "${id}" có bộ đếm ký tự mâu thuẫn với độ dài bài.`,
        passagesToInsert: [],
        passagesSkippedCount: 0,
        passagesRemappedCount: 0,
        attemptsToInsert: [],
        attemptsSkippedCount: 0,
      };
    }

    if (status === 'completed' && elapsedMs <= 0) {
      return {
        valid: false,
        error: `Attempt hoàn thành "${id}" phải có elapsedMs > 0.`,
        passagesToInsert: [],
        passagesSkippedCount: 0,
        passagesRemappedCount: 0,
        attemptsToInsert: [],
        attemptsSkippedCount: 0,
      };
    }

    // Validate replay array
    if (!Array.isArray(rawA.replay)) {
      return {
        valid: false,
        error: `Attempt "${id}" thiếu mảng replay.`,
        passagesToInsert: [],
        passagesSkippedCount: 0,
        passagesRemappedCount: 0,
        attemptsToInsert: [],
        attemptsSkippedCount: 0,
      };
    }

    if (rawA.replay.length > MAX_REPLAY_EVENTS) {
      return {
        valid: false,
        error: `Attempt "${id}" vượt quá giới hạn ${MAX_REPLAY_EVENTS} sự kiện replay.`,
        passagesToInsert: [],
        passagesSkippedCount: 0,
        passagesRemappedCount: 0,
        attemptsToInsert: [],
        attemptsSkippedCount: 0,
      };
    }

    const validatedReplay: ReplayEvent[] = [];
    let prevT = 0;
    for (let j = 0; j < rawA.replay.length; j++) {
      const ev = rawA.replay[j] as Record<string, unknown>;
      if (
        !ev ||
        typeof ev !== 'object' ||
        !isFiniteNonNegative(ev.t) ||
        !isFiniteNonNegative(ev.index) ||
        !isFiniteNonNegative(ev.correctCount)
      ) {
        return {
          valid: false,
          error: `Attempt "${id}" có sự kiện replay thứ ${j} không hợp lệ.`,
          passagesToInsert: [],
          passagesSkippedCount: 0,
          passagesRemappedCount: 0,
          attemptsToInsert: [],
          attemptsSkippedCount: 0,
        };
      }
      if (ev.t < prevT) {
        return {
          valid: false,
          error: `Attempt "${id}" có thời gian replay giảm dần tại sự kiện thứ ${j}.`,
          passagesToInsert: [],
          passagesSkippedCount: 0,
          passagesRemappedCount: 0,
          attemptsToInsert: [],
          attemptsSkippedCount: 0,
        };
      }
      if (
        ev.index > linkedPassage.graphemeCount ||
        ev.correctCount > ev.index ||
        ev.correctCount > linkedPassage.graphemeCount
      ) {
        return {
          valid: false,
          error: `Attempt "${id}" có vị trí index replay vượt quá độ dài bài tại sự kiện thứ ${j}.`,
          passagesToInsert: [],
          passagesSkippedCount: 0,
          passagesRemappedCount: 0,
          attemptsToInsert: [],
          attemptsSkippedCount: 0,
        };
      }
      prevT = ev.t;
      validatedReplay.push({
        t: ev.t,
        index: ev.index,
        correctCount: ev.correctCount,
      });
    }

    // Validate samples
    const validatedSamples: WpmSample[] = [];
    if (Array.isArray(rawA.samples)) {
      for (const s of rawA.samples) {
        const sampleObj = s as Record<string, unknown>;
        if (
          sampleObj &&
          typeof sampleObj === 'object' &&
          isFiniteNonNegative(sampleObj.t) &&
          isFiniteNonNegative(sampleObj.wpm)
        ) {
          validatedSamples.push({ t: sampleObj.t, wpm: sampleObj.wpm });
        }
      }
    }

    // Recalculate metrics from raw counters (never trust imported wpm/rank!)
    const recalculatedWpm = calculateNetWpm(correctFinal, elapsedMs);
    const recalculatedGrossWpm = calculateGrossWpm(insertedTotal, elapsedMs);
    const recalculatedAcc =
      calculateAccuracy(correctInsertions, insertedTotal) ?? 0;
    const recalculatedRank = calculateRank(
      recalculatedWpm,
      recalculatedAcc,
      status,
      linkedPassage.graphemeCount
    );

    // Check duplicate attempt ID in existing DB
    const existingAtt = existingAttemptById.get(id);
    let finalAttemptId = id;
    if (existingAtt) {
      if (
        existingAtt.contentHash === linkedPassage.contentHash &&
        existingAtt.startedAt === startedAt &&
        existingAtt.elapsedMs === elapsedMs &&
        existingAtt.insertedTotal === insertedTotal
      ) {
        attemptsSkippedCount++;
        continue;
      } else {
        finalAttemptId = idGenerator();
      }
    }

    attemptsToInsert.push({
      id: finalAttemptId,
      passageId: linkedPassage.finalId,
      contentHash: linkedPassage.contentHash,
      rulesVersion: isFiniteNonNegative(rawA.rulesVersion)
        ? Number(rawA.rulesVersion)
        : RULES_VERSION,
      status,
      startedAt,
      elapsedMs,
      insertedTotal,
      correctInsertions,
      correctFinal,
      remainingErrors,
      maxCombo,
      wpm: recalculatedWpm,
      grossWpm: recalculatedGrossWpm,
      accuracy: recalculatedAcc,
      rank: recalculatedRank,
      replay: status === 'completed' ? validatedReplay : [],
      replayTruncated: Boolean(rawA.replayTruncated),
      samples: status === 'completed' ? validatedSamples : [],
      imported: true,
    });
  }

  return {
    valid: true,
    passagesToInsert,
    passagesSkippedCount,
    passagesRemappedCount,
    attemptsToInsert,
    attemptsSkippedCount,
  };
}
