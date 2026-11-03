import { create } from 'zustand';
import {
  buildAttemptRecordFromState,
  cancelCompositionEngine,
  commitGraphemesEngine,
  createAttemptId,
  createInitialEngineState,
  deleteGraphemesEngine,
  initReadyState,
  interruptEngineAttempt,
  startCompositionEngine,
  tickEngineTimer,
  TypingEngineState,
  updateCompositionEngine,
} from '../engine/typingEngine';
import {
  AttemptRecord,
  PassageRecord,
  PROMPT_VERSION,
  selectPbAndGhost,
} from '../utils/calculations';
import {
  computeContentHash,
  getSamplePassage,
  Language,
  PassageLength,
  SAMPLE_PASSAGES,
  Topic,
} from '../utils/text';
import {
  clearAllHistory,
  deletePassageAndAttempts,
  ensureSamplePassagesSeeded,
  executeImportPlan,
  getStorageStatus,
  loadAllHistoryData,
  saveAttemptRecord,
  savePassageRecord,
} from '../services/dbService';
import {
  fetchAiProviderStatus,
  loadRemainingCooldownMs,
   requestAiPassage,
  RequestSequenceTracker,
} from '../services/llmService';
import { PreparedImportPlan } from '../services/dataTransfer';
import { soundFX } from '../utils/soundFX';
import { useSettingsStore } from './useSettingsStore';

const aiSeqTracker = new RequestSequenceTracker();

export interface ParticleSpawnSignal {
  id: number;
  type: 'error_debris' | 'finale_shockwave';
  charIndex: number;
}

export interface TypingStoreState {
  engine: TypingEngineState;
  currentPassage: PassageRecord | null;

  // PB & Ghost locked at `ready`
  pbAttempt: AttemptRecord | null;
  ghostAttempt: AttemptRecord | null;
  isGhostFallbackFromPB: boolean;

  // History cache
  passages: PassageRecord[];
  attempts: AttemptRecord[];

  // Save state
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  saveErrorMessage: string | null;
  unsavedAttempt: AttemptRecord | null;
  storageFallback: { isMemoryFallback: boolean; reason: string | null };

  // UI notifications & signals
  inputNotice: string | null;
  particleSignal: ParticleSpawnSignal | null;
  screenShakeSeq: number;
  lastKeyPressed: string | null;

  // AI & Cooldown
  aiReady: boolean;
  aiNotReadyReason: string | null;
  aiGenerating: boolean;
  aiError: string | null;
  cooldownRemainingMs: number;
  cooldownTotalMs: number;
  overheatShakeSeq: number;
  isRevealingText: boolean;

  // Actions
  initializeStudio: () => Promise<void>;
  loadSampleForCriteria: (language: Language, topic: Topic, length: PassageLength) => Promise<void>;
  selectPassageById: (passageId: string) => Promise<void>;
  retryCurrentPassage: () => void;

  // Input actions
  onCompositionStart: (nowPerf: number) => void;
  onCompositionUpdate: (text: string) => void;
  onCompositionCancel: () => void;
  onCommitGraphemes: (graphemes: string[], nowPerf: number) => void;
  onDeleteGraphemes: (count: number, nowPerf: number) => void;
  onTickTimer: (nowPerf: number) => void;
  onInterruptAttempt: (reason: string, nowPerf?: number) => void;
  setInputNotice: (notice: string | null) => void;
  setLastKeyPressed: (key: string | null) => void;
  skipTextReveal: () => void;

  // Persistence actions
  retrySaveCurrentAttempt: () => Promise<void>;
  deletePassageFromHistory: (passageId: string) => Promise<void>;
  clearHistoryOnly: () => Promise<void>;
  fullFactoryReset: () => Promise<void>;
  commitImportPlan: (plan: PreparedImportPlan) => Promise<{ ok: boolean; error?: string }>;

  // AI Generation & Cooldown
  triggerAiGeneration: () => Promise<void>;
  cancelAiGeneration: () => void;
  setCooldownFromSync: (remainingMs: number, totalMs?: number) => void;
  tickCooldown: (deltaMs: number) => void;
}

const defaultSample = SAMPLE_PASSAGES[0];
const defaultHash = computeContentHash(defaultSample.content, defaultSample.language);
const defaultPassageRecord: PassageRecord = {
  id: defaultSample.id,
  content: defaultSample.content,
  contentHash: defaultHash,
  language: defaultSample.language,
  topic: defaultSample.topic,
  length: defaultSample.length,
  source: 'sample',
  createdAt: 1700000000000,
  promptVersion: PROMPT_VERSION,
};

export const useTypingStore = create<TypingStoreState>((set, get) => ({
  engine: initReadyState(
    defaultPassageRecord.id,
    defaultPassageRecord.content,
    defaultPassageRecord.contentHash
  ),
  currentPassage: defaultPassageRecord,
  pbAttempt: null,
  ghostAttempt: null,
  isGhostFallbackFromPB: false,

  passages: [defaultPassageRecord],
  attempts: [],

  saveStatus: 'idle',
  saveErrorMessage: null,
  unsavedAttempt: null,
  storageFallback: { isMemoryFallback: false, reason: null },

  inputNotice: null,
  particleSignal: null,
  screenShakeSeq: 0,
  lastKeyPressed: null,

  aiReady: true,
  aiNotReadyReason: null,
  aiGenerating: false,
  aiError: null,
  cooldownRemainingMs: 0,
  cooldownTotalMs: 30_000,
  overheatShakeSeq: 0,
  isRevealingText: false,

  initializeStudio: async () => {
    useSettingsStore.getState().hydrateSettings();
    const hydratedSettings = useSettingsStore.getState();

    // Restore local cooldown cache immediately
    const savedCooldown = loadRemainingCooldownMs();
    if (savedCooldown.remainingMs > 0) {
      set({
        cooldownRemainingMs: savedCooldown.remainingMs,
        cooldownTotalMs: Math.max(30_000, hydratedSettings.personalCooldownSec * 1000),
      });
    }

    await ensureSamplePassagesSeeded();
    const { passages, attempts } = await loadAllHistoryData();
    const storageFallback = getStorageStatus();

    const latestSettings = useSettingsStore.getState();
    const currentState = get();

    // Only switch passage if user has not already started typing or switched passage manually
    const userAlreadyInteracted =
      currentState.engine.status === 'running' ||
      currentState.engine.insertedTotal > 0 ||
      currentState.currentPassage?.id !== defaultPassageRecord.id;

    if (userAlreadyInteracted && currentState.currentPassage) {
      const pbGhost = selectPbAndGhost(attempts, currentState.currentPassage.contentHash);
      set({
        passages,
        attempts,
        storageFallback,
        pbAttempt: pbGhost.pbAttempt,
        ghostAttempt: pbGhost.ghostAttempt,
        isGhostFallbackFromPB: pbGhost.isGhostFallbackFromPB,
      });
    } else {
      const sampleDef = getSamplePassage(
        latestSettings.language,
        latestSettings.topic,
        latestSettings.length
      );
      const contentHash = computeContentHash(sampleDef.content, sampleDef.language);
      const initialPassage: PassageRecord =
        passages.find((p) => p.id === sampleDef.id) || {
          id: sampleDef.id,
          content: sampleDef.content,
          contentHash,
          language: sampleDef.language,
          topic: sampleDef.topic,
          length: sampleDef.length,
          source: 'sample',
          createdAt: Date.now(),
          promptVersion: PROMPT_VERSION,
        };

      await savePassageRecord(initialPassage);
      const pbGhost = selectPbAndGhost(attempts, initialPassage.contentHash);

      set({
        passages,
        attempts,
        storageFallback,
        currentPassage: initialPassage,
        pbAttempt: pbGhost.pbAttempt,
        ghostAttempt: pbGhost.ghostAttempt,
        isGhostFallbackFromPB: pbGhost.isGhostFallbackFromPB,
        engine:
          currentState.currentPassage?.id === initialPassage.id &&
          currentState.engine.status === 'ready'
            ? currentState.engine
            : initReadyState(initialPassage.id, initialPassage.content, initialPassage.contentHash),
      });
    }

    // Check server AI status & authoritative cooldown asynchronously
    try {
      const status = await fetchAiProviderStatus();
      set({
        aiReady: status.aiReady,
        aiNotReadyReason: status.reason,
      });
      if (status.retryAfterMs > 0) {
        set({
          cooldownRemainingMs: status.retryAfterMs,
          cooldownTotalMs: Math.max(
            status.retryAfterMs,
            latestSettings.personalCooldownSec * 1000
          ),
        });
      }
    } catch {
      // Offline or route unreachable: sample passages still work
    }
  },

  loadSampleForCriteria: async (language, topic, length) => {
    const sampleDef = getSamplePassage(language, topic, length);
    const contentHash = computeContentHash(sampleDef.content, sampleDef.language);
    const passageRecord: PassageRecord = {
      id: sampleDef.id,
      content: sampleDef.content,
      contentHash,
      language: sampleDef.language,
      topic: sampleDef.topic,
      length: sampleDef.length,
      source: 'sample',
      createdAt: Date.now(),
      promptVersion: PROMPT_VERSION,
    };

    await savePassageRecord(passageRecord);
    const { passages, attempts } = await loadAllHistoryData();
    const pbGhost = selectPbAndGhost(attempts, contentHash);

    set({
      passages,
      attempts,
      storageFallback: getStorageStatus(),
      currentPassage: passageRecord,
      pbAttempt: pbGhost.pbAttempt,
      ghostAttempt: pbGhost.ghostAttempt,
      isGhostFallbackFromPB: pbGhost.isGhostFallbackFromPB,
      engine: initReadyState(passageRecord.id, passageRecord.content, passageRecord.contentHash),
      saveStatus: 'idle',
      saveErrorMessage: null,
      unsavedAttempt: null,
      inputNotice: null,
      aiError: null,
      isRevealingText: false,
    });
  },

  selectPassageById: async (passageId) => {
    const { passages, attempts } = await loadAllHistoryData();
    const target = passages.find((p) => p.id === passageId);
    if (!target) return;

    const pbGhost = selectPbAndGhost(attempts, target.contentHash);
    set({
      passages,
      attempts,
      currentPassage: target,
      pbAttempt: pbGhost.pbAttempt,
      ghostAttempt: pbGhost.ghostAttempt,
      isGhostFallbackFromPB: pbGhost.isGhostFallbackFromPB,
      engine: initReadyState(target.id, target.content, target.contentHash),
      saveStatus: 'idle',
      saveErrorMessage: null,
      unsavedAttempt: null,
      inputNotice: null,
      isRevealingText: false,
    });
  },

  retryCurrentPassage: () => {
    const { currentPassage, attempts } = get();
    if (!currentPassage) return;

    // Lock the Ghost snapshot upon entering `ready` (Section 9.2)
    const pbGhost = selectPbAndGhost(attempts, currentPassage.contentHash);

    set({
      pbAttempt: pbGhost.pbAttempt,
      ghostAttempt: pbGhost.ghostAttempt,
      isGhostFallbackFromPB: pbGhost.isGhostFallbackFromPB,
      engine: initReadyState(
        currentPassage.id,
        currentPassage.content,
        currentPassage.contentHash,
        createAttemptId()
      ),
      saveStatus: 'idle',
      saveErrorMessage: null,
      unsavedAttempt: null,
      inputNotice: null,
      isRevealingText: false,
    });
  },

  onCompositionStart: (nowPerf) => {
    const prev = get().engine;
    const next = startCompositionEngine(prev, nowPerf, Date.now());
    if (next !== prev) {
      set({ engine: next });
    }
  },

  onCompositionUpdate: (text) => {
    const prev = get().engine;
    const next = updateCompositionEngine(prev, text);
    if (next !== prev) {
      set({ engine: next });
    }
  },

  onCompositionCancel: () => {
    const prev = get().engine;
    const next = cancelCompositionEngine(prev);
    if (next !== prev) {
      set({ engine: next });
    }
  },

  onCommitGraphemes: (graphemes, nowPerf) => {
    const prev = get().engine;
    const prevCombo = prev.combo;
    const next = commitGraphemesEngine(prev, graphemes, nowPerf, Date.now());
    if (next === prev) return;

    const settings = useSettingsStore.getState();

    // Trigger 1 sound per commit (even if multi-grapheme IME commit per Section 11)
    if (next.lastCommitOutcome === 'error') {
      soundFX.playKeyCommit('error', settings.soundProfile, settings.soundVolume, settings.soundEnabled);
    } else if (next.lastCommitOutcome === 'correct') {
      soundFX.playKeyCommit('correct', settings.soundProfile, settings.soundVolume, settings.soundEnabled);
    }

    let nextParticleSignal = get().particleSignal;
    let nextShakeSeq = get().screenShakeSeq;

    if (next.lastCommitOutcome === 'error') {
      if (settings.fxMode === 'ultra' && !settings.reducedMotionSystem) {
        nextParticleSignal = {
          id: Date.now() + Math.random(),
          type: 'error_debris',
          charIndex: next.lastCommitIndex,
        };
      }
      if (
        prevCombo >= 3 &&
        settings.screenShakeEnabled &&
        !settings.reducedMotionSystem
      ) {
        nextShakeSeq += 1;
      }
    }

    if (next.status === 'completed' && prev.status !== 'completed') {
      soundFX.playCompletionChime(settings.soundVolume, settings.soundEnabled);
      if (settings.fxMode === 'ultra' && !settings.reducedMotionSystem) {
        nextParticleSignal = {
          id: Date.now() + Math.random(),
          type: 'finale_shockwave',
          charIndex: next.lastCommitIndex,
        };
      }

      // Immediately persist completed attempt without waiting for FX (Section 11)
      const record = buildAttemptRecordFromState(next);
      set({
        engine: next,
        particleSignal: nextParticleSignal,
        screenShakeSeq: nextShakeSeq,
        saveStatus: 'saving',
        saveErrorMessage: null,
        unsavedAttempt: record,
      });

      if (record) {
        saveAttemptRecord(record).then(async (res) => {
          const { passages, attempts } = await loadAllHistoryData();
          const pbGhost = selectPbAndGhost(attempts, next.contentHash);
          set({
            passages,
            attempts,
            pbAttempt: pbGhost.pbAttempt,
            storageFallback: getStorageStatus(),
            saveStatus: res.saved ? 'saved' : 'error',
            saveErrorMessage: res.error || null,
            unsavedAttempt: res.saved ? null : record,
          });
        });
      }
      return;
    }

    set({
      engine: next,
      particleSignal: nextParticleSignal,
      screenShakeSeq: nextShakeSeq,
    });
  },

  onDeleteGraphemes: (count, nowPerf) => {
    const prev = get().engine;
    const next = deleteGraphemesEngine(prev, count, nowPerf);
    if (next === prev) return;

    const settings = useSettingsStore.getState();
    soundFX.playKeyCommit('delete', settings.soundProfile, settings.soundVolume, settings.soundEnabled);

    set({ engine: next });
  },

  onTickTimer: (nowPerf) => {
    const prev = get().engine;
    if (prev.status !== 'running') return;
    const next = tickEngineTimer(prev, nowPerf);
    if (next !== prev) {
      set({ engine: next });
    }
  },

  onInterruptAttempt: (reason, nowPerf = typeof performance !== 'undefined' ? performance.now() : 0) => {
    const prev = get().engine;
    if (prev.status !== 'running') return;
    const next = interruptEngineAttempt(prev, reason, nowPerf);
    const abandonedRecord = buildAttemptRecordFromState(next);

    set({
      engine: next,
    });

    if (abandonedRecord) {
      saveAttemptRecord(abandonedRecord).then(async () => {
        const { passages, attempts } = await loadAllHistoryData();
        set({
          passages,
          attempts,
          storageFallback: getStorageStatus(),
        });
      });
    }
  },

  setInputNotice: (inputNotice) => set({ inputNotice }),
  setLastKeyPressed: (lastKeyPressed) => set({ lastKeyPressed }),
  skipTextReveal: () => set({ isRevealingText: false }),

  retrySaveCurrentAttempt: async () => {
    const { unsavedAttempt, engine } = get();
    if (!unsavedAttempt) return;
    set({ saveStatus: 'saving', saveErrorMessage: null });
    const res = await saveAttemptRecord(unsavedAttempt);
    const { passages, attempts } = await loadAllHistoryData();
    const pbGhost = selectPbAndGhost(attempts, engine.contentHash);
    set({
      passages,
      attempts,
      pbAttempt: pbGhost.pbAttempt,
      storageFallback: getStorageStatus(),
      saveStatus: res.saved ? 'saved' : 'error',
      saveErrorMessage: res.error || null,
      unsavedAttempt: res.saved ? null : unsavedAttempt,
    });
  },

  deletePassageFromHistory: async (passageId) => {
    const { currentPassage } = get();
    const res = await deletePassageAndAttempts(passageId);
    if (!res.ok) return;

    const { passages, attempts } = await loadAllHistoryData();
    set({ passages, attempts });

    // Section 14: "Xóa bài đang mở -> Chuyển sang bài mẫu sau khi xóa thành công"
    if (currentPassage && currentPassage.id === passageId) {
      const settings = useSettingsStore.getState();
      await get().loadSampleForCriteria(settings.language, settings.topic, settings.length);
    }
  },

  clearHistoryOnly: async () => {
    await clearAllHistory();
    const settings = useSettingsStore.getState();
    await get().loadSampleForCriteria(settings.language, settings.topic, settings.length);
  },

  fullFactoryReset: async () => {
    useSettingsStore.getState().resetSettingsToDefault();
    await clearAllHistory();
    const settings = useSettingsStore.getState();
    await get().loadSampleForCriteria(settings.language, settings.topic, settings.length);
  },

  commitImportPlan: async (plan) => {
    const res = await executeImportPlan(plan);
    if (res.ok) {
      const { passages, attempts } = await loadAllHistoryData();
      const { currentPassage } = get();
      const pbGhost = currentPassage
        ? selectPbAndGhost(attempts, currentPassage.contentHash)
        : { pbAttempt: null, ghostAttempt: null, isGhostFallbackFromPB: false };

      set({
        passages,
        attempts,
        pbAttempt: pbGhost.pbAttempt,
        ghostAttempt: pbGhost.ghostAttempt,
        isGhostFallbackFromPB: pbGhost.isGhostFallbackFromPB,
        storageFallback: getStorageStatus(),
      });
    }
    return res;
  },

  triggerAiGeneration: async () => {
    const { cooldownRemainingMs, aiGenerating } = get();

    // Overheat feedback when clicking during active cooldown (Module 2 & Section 10.3)
    if (cooldownRemainingMs > 0) {
      set((s) => ({
        overheatShakeSeq: s.overheatShakeSeq + 1,
        aiError: `AI Core Overheated — Vui lòng chờ ${Math.ceil(cooldownRemainingMs / 1000)}s để nạp năng lượng.`,
      }));
      return;
    }

    // Prevent double-click duplicate requests (Section 10.1 & 14)
    if (aiGenerating || aiSeqTracker.isBusy()) {
      return;
    }

    const settings = useSettingsStore.getState();
    const { seq, signal } = aiSeqTracker.startNew();

    set({
      aiGenerating: true,
      aiError: null,
    });

    try {
      const result = await requestAiPassage({
        language: settings.language,
        topic: settings.topic,
        length: settings.length,
        personalCooldownSec: settings.personalCooldownSec,
        signal,
      });

      // Ignore stale response if canceled or superseded (Section 10.2)
      if (!aiSeqTracker.isCurrent(seq)) {
        return;
      }
      aiSeqTracker.finish(seq);

      const effectiveTotalMs = Math.max(30_000, settings.personalCooldownSec * 1000);
      if (result.retryAfterMs > 0) {
        set({
          cooldownRemainingMs: result.retryAfterMs,
          cooldownTotalMs: Math.max(effectiveTotalMs, result.retryAfterMs),
        });
      }

      if (!result.ok || !result.text) {
        set({
          aiGenerating: false,
          aiReady: result.aiReady !== false,
          aiNotReadyReason: result.aiReady === false ? result.error || null : get().aiNotReadyReason,
          aiError: result.error || 'Không thể sinh bài AI lúc này. Đã giữ nguyên bài hiện tại.',
        });
        return;
      }

      const contentHash = computeContentHash(result.text, settings.language);
      const newPassage: PassageRecord = {
        id: `ai_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        content: result.text,
        contentHash,
        language: settings.language,
        topic: settings.topic,
        length: settings.length,
        source: 'ai',
        createdAt: Date.now(),
        promptVersion: PROMPT_VERSION,
      };

      await savePassageRecord(newPassage);
      const { passages, attempts } = await loadAllHistoryData();
      const pbGhost = selectPbAndGhost(attempts, contentHash);

      set({
        aiGenerating: false,
        aiError: null,
        aiReady: true,
        passages,
        attempts,
        storageFallback: getStorageStatus(),
        currentPassage: newPassage,
        pbAttempt: pbGhost.pbAttempt,
        ghostAttempt: pbGhost.ghostAttempt,
        isGhostFallbackFromPB: pbGhost.isGhostFallbackFromPB,
        engine: initReadyState(newPassage.id, newPassage.content, newPassage.contentHash),
        saveStatus: 'idle',
        saveErrorMessage: null,
        unsavedAttempt: null,
        isRevealingText: !settings.reducedMotionSystem,
      });
    } catch (err) {
      if (!aiSeqTracker.isCurrent(seq)) {
        return;
      }
      aiSeqTracker.finish(seq);
      const isAbort =
        err instanceof Error && (err.name === 'AbortError' || err.message.includes('aborted'));
      set({
        aiGenerating: false,
        aiError: isAbort
          ? 'Đã hủy yêu cầu tạo bài AI. Bài hiện tại được giữ nguyên.'
          : 'Mất kết nối mạng hoặc máy chủ không phản hồi. Bạn vẫn có thể luyện bài mẫu.',
      });
    }
  },

  cancelAiGeneration: () => {
    aiSeqTracker.cancelCurrent();
    set({
      aiGenerating: false,
      aiError: 'Đã hủy yêu cầu tạo bài AI. Bài hiện tại vẫn được giữ nguyên.',
    });
  },

  setCooldownFromSync: (remainingMs, totalMs) => {
    set((s) => ({
      cooldownRemainingMs: Math.max(0, remainingMs),
      cooldownTotalMs: totalMs ? Math.max(30_000, totalMs) : s.cooldownTotalMs,
    }));
  },

  tickCooldown: (deltaMs) => {
    const current = get().cooldownRemainingMs;
    if (current <= 0) return;
    const next = Math.max(0, current - deltaMs);
    set({
      cooldownRemainingMs: next,
      ...(next === 0 && get().aiError?.includes('Overheated') ? { aiError: null } : {}),
    });
  },
}));
