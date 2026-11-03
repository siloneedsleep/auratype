'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import confetti from 'canvas-confetti';
import {
  Sparkles,
  Flame,
  Gauge,
  Target,
  Award,
  Timer,
  AlertCircle,
  RotateCcw,
  VolumeX,
  CheckCircle2,
  Database,
} from 'lucide-react';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useTypingStore } from '@/store/useTypingStore';
import { splitGraphemes, Language, PassageLength, Topic } from '@/utils/text';
import { countGraphemesForWordDelete } from '@/engine/typingEngine';
import {
  evaluateBeforeInput,
  reconcileInputDiff,
  resolveCompositionEnd,
} from '@/engine/inputAdapter';
import {
  getGhostPositionAtTime,
  calculateGhostDiff,
} from '@/engine/replayEngine';
import { soundFX } from '@/utils/soundFX';
import {
  loadRemainingCooldownMs,
  subscribeCooldownSync,
} from '@/services/llmService';
import HeaderBar from './HeaderBar';
import TypingCanvas from './TypingCanvas';
import Caret, { CaretVisualPosition } from './Caret';
import VirtualKeyboard from './VirtualKeyboard';
import ResultModal from '../modals/ResultModal';
import SettingsModal from '../modals/SettingsModal';
import ConfirmAbandonModal from '../modals/ConfirmAbandonModal';
import HistoryDrawer from '../history/HistoryDrawer';

const SCRAMBLE_GLYPHS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ#$%&*+<>?';

export default function TypingStudio() {
  const settings = useSettingsStore();
  const typingStore = useTypingStore();
  const {
    engine,
    currentPassage,
    pbAttempt,
    ghostAttempt,
    isGhostFallbackFromPB,
    storageFallback,
    inputNotice,
    particleSignal,
    screenShakeSeq,
    lastKeyPressed,
    aiReady,
    aiNotReadyReason,
    aiError,
    cooldownRemainingMs,
    isRevealingText,
    initializeStudio,
    loadSampleForCriteria,
    selectPassageById,
    retryCurrentPassage,
    onCompositionStart,
    onCompositionUpdate,
    onCompositionCancel,
    onCommitGraphemes,
    onDeleteGraphemes,
    onTickTimer,
    onInterruptAttempt,
    setInputNotice,
    setLastKeyPressed,
    skipTextReveal,
    triggerAiGeneration,
    setCooldownFromSync,
    tickCooldown,
  } = typingStore;

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const textContainerRef = useRef<HTMLDivElement | null>(null);
  const charSpansRef = useRef<(HTMLSpanElement | null)[]>([]);
  const prevCaretYRef = useRef<number>(0);

  const [isTextareaFocused, setIsTextareaFocused] = useState(false);
  const [isShaking, setIsShaking] = useState(false);
  const [revealProgress, setRevealProgress] = useState(1);

  // Modals & Drawers
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [resultModalDismissed, setResultModalDismissed] = useState(false);

  // Confirm Abandon Modal state
  const [pendingConfirm, setPendingConfirm] = useState<{
    title: string;
    description: string;
    confirmLabel: string;
    action: () => void;
  } | null>(null);

  // Caret positions
  const [userCaretPos, setUserCaretPos] = useState<CaretVisualPosition>({
    x: 0,
    y: 0,
    height: 28,
    lineChanged: false,
  });
  const [ghostCaretPos, setGhostCaretPos] = useState<CaretVisualPosition | null>(
    null
  );

  // Initialize settings & studio on mount
  useEffect(() => {
    settings.hydrateSettings();
    initializeStudio();

    const unsubCooldown = subscribeCooldownSync((remainingMs) => {
      setCooldownFromSync(remainingMs);
    });

    return () => {
      unsubCooldown();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Trigger transient screen shake without remounting the DOM tree
  useEffect(() => {
    if (screenShakeSeq <= 0) return;
    setIsShaking(true);
    const id = window.setTimeout(() => setIsShaking(false), 240);
    return () => window.clearTimeout(id);
  }, [screenShakeSeq]);

  // Cooldown 250ms ticker when cooldownRemainingMs > 0
  useEffect(() => {
    if (cooldownRemainingMs <= 0) return;
    const id = window.setInterval(() => {
      tickCooldown(250);
    }, 250);
    return () => window.clearInterval(id);
  }, [cooldownRemainingMs, tickCooldown]);

  // Trigger Text Decode/Scramble reveal on new passage when status === 'ready'
  useEffect(() => {
    if (!currentPassage) return;
    setResultModalDismissed(false);

    if (
      settings.reducedMotionSystem ||
      !isRevealingText ||
      engine.status !== 'ready'
    ) {
      setRevealProgress(1);
      return;
    }

    setRevealProgress(0);
    const start = performance.now();
    const duration = 380;
    let raf = 0;

    const step = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      setRevealProgress(p);
      if (p < 1) {
        raf = requestAnimationFrame(step);
      } else {
        skipTextReveal();
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPassage?.id, isRevealingText]);

  // Sync hidden textarea value when engine resets to ready
  useEffect(() => {
    if (engine.status === 'ready' && textareaRef.current) {
      textareaRef.current.value = '';
    }
  }, [engine.status, currentPassage?.id]);

  // Focus textarea helper
  const focusTypingInput = useCallback(() => {
    if (
      settingsOpen ||
      historyOpen ||
      pendingConfirm ||
      (engine.status === 'completed' && !resultModalDismissed)
    ) {
      return;
    }
    textareaRef.current?.focus({ preventScroll: true });
  }, [
    settingsOpen,
    historyOpen,
    pendingConfirm,
    engine.status,
    resultModalDismissed,
  ]);

  useEffect(() => {
    if (engine.status === 'ready') {
      focusTypingInput();
    }
  }, [engine.status, currentPassage?.id, focusTypingInput]);

  // Real-time Timer & Metrics loop while status === 'running'
  useEffect(() => {
    if (engine.status !== 'running') return;
    const id = window.setInterval(() => {
      onTickTimer(performance.now());
    }, 80);
    return () => window.clearInterval(id);
  }, [engine.status, onTickTimer]);

  // Confetti on completion (Section 8.3: only in 'completed')
  useEffect(() => {
    if (engine.status === 'completed' && !settings.reducedMotionSystem) {
      try {
        confetti({
          particleCount: settings.fxMode === 'ultra' ? 75 : 35,
          spread: 68,
          origin: { y: 0.6 },
        });
      } catch {
        // Ignore confetti canvas errors
      }
    }
  }, [engine.status, settings.reducedMotionSystem, settings.fxMode]);

  // Section 7.1 & 10.6: Tab blur / visibilitychange -> interrupt running attempt
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        const st = useTypingStore.getState().engine;
        if (st.status === 'running') {
          onInterruptAttempt(
            'Lượt gõ đã tạm dừng và hủy kết quả do chuyển sang tab hoặc cửa sổ khác.',
            performance.now()
          );
        }
      }
    };

    const handleWindowBlur = () => {
      const st = useTypingStore.getState().engine;
      if (st.status === 'running') {
        onInterruptAttempt(
          'Lượt gõ đã tạm dừng do cửa sổ trình duyệt mất tiêu điểm (blur).',
          performance.now()
        );
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [onInterruptAttempt]);

  // Measure Caret coordinates in DOM
  const measureGraphemePosition = useCallback(
    (index: number, prevY: number): CaretVisualPosition | null => {
      const container = textContainerRef.current;
      if (!container) return null;
      const total = engine.targetGraphemes.length;
      if (total === 0) return null;

      const clampedIdx = Math.max(0, Math.min(index, total));
      if (clampedIdx < total) {
        const span = charSpansRef.current[clampedIdx];
        if (!span) return null;
        const y = span.offsetTop;
        return {
          x: span.offsetLeft,
          y,
          height: span.offsetHeight || 28,
          lineChanged: Math.abs(y - prevY) > 6,
        };
      } else {
        const lastSpan = charSpansRef.current[total - 1];
        if (!lastSpan) return null;
        const y = lastSpan.offsetTop;
        return {
          x: lastSpan.offsetLeft + lastSpan.offsetWidth,
          y,
          height: lastSpan.offsetHeight || 28,
          lineChanged: Math.abs(y - prevY) > 6,
        };
      }
    },
    [engine.targetGraphemes.length]
  );

  const getCharCenterCoordinates = useCallback(
    (index: number): { x: number; y: number } | null => {
      const span = charSpansRef.current[index];
      if (!span) return null;
      return {
        x: span.offsetLeft + span.offsetWidth / 2,
        y: span.offsetTop + span.offsetHeight / 2,
      };
    },
    []
  );

  // Update User Caret & Ghost Caret positions
  const ghostPosInfo = useMemo(() => {
    if (!settings.ghostEnabled || !ghostAttempt) return null;
    if (engine.status === 'ready') {
      return { index: 0, correctCount: 0, finished: false };
    }
    return getGhostPositionAtTime(
      ghostAttempt.replay,
      engine.elapsedMs,
      engine.targetGraphemes.length
    );
  }, [
    settings.ghostEnabled,
    ghostAttempt,
    engine.status,
    engine.elapsedMs,
    engine.targetGraphemes.length,
  ]);

  const ghostDiff = useMemo(() => {
    if (!settings.ghostEnabled || !ghostAttempt || !ghostPosInfo) return null;
    return calculateGhostDiff(engine.correctFinal, ghostPosInfo.correctCount);
  }, [
    settings.ghostEnabled,
    ghostAttempt,
    ghostPosInfo,
    engine.correctFinal,
  ]);

  const updateCaretCoordinates = useCallback(() => {
    const activeIndex = engine.typedGraphemes.length;
    const uPos = measureGraphemePosition(activeIndex, prevCaretYRef.current);
    if (uPos) {
      prevCaretYRef.current = uPos.y;
      setUserCaretPos(uPos);
    }

    if (
      settings.ghostEnabled &&
      ghostAttempt &&
      ghostPosInfo !== null
    ) {
      const gPos = measureGraphemePosition(ghostPosInfo.index, 0);
      setGhostCaretPos(gPos);
    } else {
      setGhostCaretPos(null);
    }

    // Auto-scroll text container if caret moves past visible lines
    if (uPos && textContainerRef.current) {
      const container = textContainerRef.current;
      const desiredScroll = Math.max(0, uPos.y - 68);
      if (Math.abs(container.scrollTop - desiredScroll) > 34) {
        container.scrollTo({
          top: desiredScroll,
          behavior: settings.reducedMotionSystem ? 'auto' : 'smooth',
        });
      }
    }
  }, [
    engine.typedGraphemes.length,
    measureGraphemePosition,
    settings.ghostEnabled,
    ghostAttempt,
    ghostPosInfo,
    settings.reducedMotionSystem,
  ]);

  useEffect(() => {
    updateCaretCoordinates();
  }, [updateCaretCoordinates, isRevealingText]);

  useEffect(() => {
    const onResize = () => updateCaretCoordinates();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [updateCaretCoordinates]);

  // Input Adapter Event Handlers (Section 7.2 & 7.3)
  const handleBeforeInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const nativeEvent = e.nativeEvent as InputEvent;
    const latestEngine = useTypingStore.getState().engine;
    const decision = evaluateBeforeInput(
      nativeEvent.inputType,
      latestEngine.isComposing || nativeEvent.isComposing,
      nativeEvent.data
    );
    if (decision.shouldPreventDefault) {
      e.preventDefault();
      if (decision.action.type === 'blocked') {
        setInputNotice(decision.action.reason);
      }
    }
  };

  const handleCompositionStart = () => {
    if (isRevealingText) skipTextReveal();
    onCompositionStart(performance.now());
  };

  const handleCompositionUpdate = (
    e: React.CompositionEvent<HTMLTextAreaElement>
  ) => {
    onCompositionUpdate(e.data || '');
  };

  const handleCompositionEnd = (
    e: React.CompositionEvent<HTMLTextAreaElement>
  ) => {
    if (isRevealingText) skipTextReveal();
    const now = performance.now();
    const latestEngine = useTypingStore.getState().engine;
    const currentVal = e.currentTarget.value;
    const { action } = resolveCompositionEnd(
      latestEngine.typedGraphemes,
      e.data || '',
      currentVal
    );

    if (action.type === 'delete' && action.count > 0) {
      onCompositionCancel();
      onDeleteGraphemes(action.count, now);
    } else if (action.type === 'commit' && action.graphemes.length > 0) {
      onCommitGraphemes(action.graphemes, now);
    } else {
      onCompositionCancel();
    }

    const syncedTyped = useTypingStore.getState().engine.typedGraphemes.join('');
    if (e.currentTarget.value !== syncedTyped) {
      e.currentTarget.value = syncedTyped;
    }
    const len = e.currentTarget.value.length;
    e.currentTarget.setSelectionRange(len, len);
  };

  const handleTextareaInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const nativeEvent = e.nativeEvent as InputEvent;
    const latestEngine = useTypingStore.getState().engine;
    if (nativeEvent.isComposing || latestEngine.isComposing) {
      return;
    }

    if (isRevealingText) skipTextReveal();
    const now = performance.now();
    const newVal = e.currentTarget.value;
    const action = reconcileInputDiff({
      committedGraphemes: latestEngine.typedGraphemes,
      rawTextareaValue: newVal,
      inputType: nativeEvent.inputType,
      isComposing: false,
    });

    if (action.type === 'commit') {
      onCommitGraphemes(action.graphemes, now);
    } else if (action.type === 'delete') {
      onDeleteGraphemes(action.count, now);
    } else if (action.type === 'blocked') {
      setInputNotice(action.reason);
    }

    // Keep textarea value strictly equal to committed graphemes
    const syncedTyped = useTypingStore.getState().engine.typedGraphemes.join('');
    if (e.currentTarget.value !== syncedTyped) {
      e.currentTarget.value = syncedTyped;
    }
    const len = e.currentTarget.value.length;
    e.currentTarget.setSelectionRange(len, len);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const latestEngine = useTypingStore.getState().engine;
    // KeyCode 229 or native isComposing indicates active IME processing
    if (
      e.nativeEvent.isComposing ||
      latestEngine.isComposing ||
      e.nativeEvent.keyCode === 229
    ) {
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      handleOpenSettings();
      return;
    }

    // Record key for 2.5D virtual keyboard visual feedback
    if (e.key.length === 1 || e.key === 'Backspace' || e.key === ' ') {
      setLastKeyPressed(e.key);
    }

    // Handle Backspace deterministically (both single-grapheme and Ctrl/Alt+Backspace word delete)
    if (e.key === 'Backspace') {
      e.preventDefault();
      const count =
        e.ctrlKey || e.altKey
          ? countGraphemesForWordDelete(latestEngine.typedGraphemes)
          : 1;
      if (count > 0 && latestEngine.typedGraphemes.length > 0) {
        onDeleteGraphemes(count, performance.now());
        if (textareaRef.current) {
          const synced = useTypingStore.getState().engine.typedGraphemes.join('');
          textareaRef.current.value = synced;
          textareaRef.current.setSelectionRange(synced.length, synced.length);
        }
      }
      return;
    }

    // Block arrow keys / Home / End from moving hidden textarea caret away from end
    if (
      ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(
        e.key
      )
    ) {
      e.preventDefault();
      return;
    }

    // Ensure selection is always at the end before a printable character inserts into textarea
    if (textareaRef.current) {
      const len = textareaRef.current.value.length;
      if (
        textareaRef.current.selectionStart !== len ||
        textareaRef.current.selectionEnd !== len
      ) {
        textareaRef.current.setSelectionRange(len, len);
      }
    }
  };

  // Guarded action helper when engine.status === 'running' (Section 10.6)
  const guardRunningAction = (
    title: string,
    description: string,
    confirmLabel: string,
    action: () => void
  ) => {
    if (engine.status === 'running') {
      setPendingConfirm({
        title,
        description,
        confirmLabel,
        action: () => {
          setPendingConfirm(null);
          action();
        },
      });
    } else {
      action();
    }
  };

  const handleRequestSampleChange = (
    lang: Language,
    topic: Topic,
    length: PassageLength
  ) => {
    guardRunningAction(
      'Đổi bài mẫu khi đang gõ?',
      'Lượt gõ hiện tại sẽ bị hủy và nạp bài mẫu mới theo lựa chọn của bạn.',
      'Đổi bài mẫu',
      () => {
        settings.setLanguage(lang);
        settings.setTopic(topic);
        settings.setLength(length);
        loadSampleForCriteria(lang, topic, length);
      }
    );
  };

  const handleRequestGenerateAI = () => {
    guardRunningAction(
      'Tạo bài AI mới khi đang gõ?',
      'Lượt gõ đang chạy sẽ bị hủy để tạo văn bản mới từ AI.',
      'Tạo bài AI mới',
      () => {
        triggerAiGeneration();
      }
    );
  };

  const handleOpenSettings = () => {
    guardRunningAction(
      'Mở Cài đặt khi đang gõ?',
      'Mở bảng Cài đặt sẽ hủy lượt gõ đang chạy hiện tại.',
      'Hủy lượt & Mở Cài đặt',
      () => {
        if (useTypingStore.getState().engine.status === 'running') {
          onInterruptAttempt('Đã hủy lượt gõ để mở Cài đặt.', performance.now());
        }
        setSettingsOpen(true);
      }
    );
  };

  const handleOpenHistory = () => {
    guardRunningAction(
      'Mở Lịch sử & Ghost khi đang gõ?',
      'Mở ngăn Lịch sử sẽ hủy lượt gõ đang chạy hiện tại.',
      'Hủy lượt & Mở Lịch sử',
      () => {
        if (useTypingStore.getState().engine.status === 'running') {
          onInterruptAttempt('Đã hủy lượt gõ để xem Lịch sử.', performance.now());
        }
        setHistoryOpen(true);
      }
    );
  };

  // Dynamic background color temperature based on WPM (Section 8.1)
  const ambientGradientClass = useMemo(() => {
    if (engine.status !== 'running') {
      return 'from-slate-950 via-slate-950 to-slate-900';
    }
    if (engine.wpm < 50) {
      return 'from-slate-950 via-sky-950/25 to-slate-950';
    }
    if (engine.wpm < 90) {
      return 'from-slate-950 via-indigo-950/30 to-slate-950';
    }
    return 'from-slate-950 via-fuchsia-950/25 to-amber-950/20';
  }, [engine.status, engine.wpm]);

  const expectedNextGrapheme =
    engine.targetGraphemes[engine.typedGraphemes.length];
  const compositionGraphemes = useMemo(
    () => splitGraphemes(engine.compositionText),
    [engine.compositionText]
  );

  const statusBannerMessage =
    inputNotice ||
    aiError ||
    (!aiReady && aiNotReadyReason
      ? `AI chưa sẵn sàng (${aiNotReadyReason}) — Đang hoạt động ở chế độ Bài mẫu chuẩn.`
      : null) ||
    storageFallback.reason;

  return (
    <div
      className={`min-h-screen flex flex-col bg-gradient-to-b ${ambientGradientClass} text-slate-100 transition-colors duration-700 selection:bg-sky-500/30`}
    >
      {/* Top Studio Header & Secondary Toolbar */}
      <HeaderBar
        onOpenSettings={handleOpenSettings}
        onOpenHistory={handleOpenHistory}
        onRequestGenerateAI={handleRequestGenerateAI}
        onRequestSampleChange={handleRequestSampleChange}
      />

      {/* Non-blocking System / AI / Storage Status Banner */}
      {(statusBannerMessage || storageFallback.isMemoryFallback) && (
        <div className="mx-auto mt-3 w-full max-w-6xl px-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-900/80 px-4 py-2 text-xs text-slate-300">
            <div className="flex items-center gap-2">
              {!aiReady ? (
                <Sparkles className="h-3.5 w-3.5 shrink-0 text-amber-400" />
              ) : (
                <AlertCircle className="h-3.5 w-3.5 shrink-0 text-sky-400" />
              )}
              <span>
                {statusBannerMessage ||
                  'Đang sử dụng bộ nhớ tạm (RAM) do trình duyệt chặn IndexedDB.'}
              </span>
            </div>

            <div className="flex items-center gap-3">
              {storageFallback.isMemoryFallback && (
                <span className="flex items-center gap-1 text-amber-300">
                  <Database className="h-3.5 w-3.5" />
                  Chế độ bộ nhớ tạm (RAM)
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Main Studio Workspace */}
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-between gap-5 px-4 py-5 sm:px-6">
        {/* Live Telemetry HUD Strip */}
        <section
          aria-label="Chỉ số tốc độ và độ chính xác trực tiếp"
          className="grid grid-cols-2 gap-3 sm:grid-cols-5"
        >
          {/* Net WPM */}
          <div className="rounded-xl border border-slate-800/90 bg-slate-900/60 px-4 py-3">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Net WPM</span>
              <Gauge className="h-3.5 w-3.5 text-sky-400" />
            </div>
            <div className="mt-1 flex items-baseline gap-2 font-mono tabular-nums">
              <span
                data-testid="hud-net-wpm"
                className="text-2xl font-bold text-slate-50"
              >
                {Math.round(engine.wpm)}
              </span>
              <span className="text-xs text-slate-400">
                Gross {Math.round(engine.grossWpm)}
              </span>
            </div>
          </div>

          {/* Accuracy */}
          <div className="rounded-xl border border-slate-800/90 bg-slate-900/60 px-4 py-3">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Độ chính xác</span>
              <Target className="h-3.5 w-3.5 text-emerald-400" />
            </div>
            <div className="mt-1 flex items-baseline gap-2 font-mono tabular-nums">
              <span
                data-testid="hud-accuracy"
                className="text-2xl font-bold text-emerald-400"
              >
                {engine.accuracy !== null ? `${engine.accuracy.toFixed(1)}%` : '100.0%'}
              </span>
              <span className="text-xs text-slate-400">
                {engine.correctInsertions}/{engine.insertedTotal}
              </span>
            </div>
          </div>

          {/* Combo Streak */}
          <div className="rounded-xl border border-slate-800/90 bg-slate-900/60 px-4 py-3">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Chuỗi Combo</span>
              <Flame
                className={`h-3.5 w-3.5 ${
                  engine.combo >= 50
                    ? 'text-amber-400'
                    : engine.combo >= 25
                    ? 'text-fuchsia-400'
                    : 'text-slate-500'
                }`}
              />
            </div>
            <div className="mt-1 flex items-baseline gap-2 font-mono tabular-nums">
              <span
                data-testid="hud-combo"
                className={`text-2xl font-bold ${
                  engine.combo >= 100
                    ? 'text-amber-300'
                    : engine.combo >= 50
                    ? 'text-fuchsia-300'
                    : engine.combo >= 25
                    ? 'text-sky-300'
                    : 'text-slate-100'
                }`}
              >
                {engine.combo}x
              </span>
              <span className="text-xs text-slate-400">Max {engine.maxCombo}x</span>
            </div>
          </div>

          {/* Progress & Time */}
          <div className="rounded-xl border border-slate-800/90 bg-slate-900/60 px-4 py-3">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Tiến độ · Giờ</span>
              <Timer className="h-3.5 w-3.5 text-violet-400" />
            </div>
            <div className="mt-1 flex items-baseline justify-between font-mono tabular-nums">
              <span
                data-testid="hud-progress"
                className="text-lg font-bold text-slate-100"
              >
                {engine.typedGraphemes.length}/{engine.targetGraphemes.length}
              </span>
              <span className="text-xs text-slate-400">
                {(engine.elapsedMs / 1000).toFixed(1)}s
              </span>
            </div>
          </div>

          {/* Ghost & PB Status */}
          <div className="col-span-2 sm:col-span-1 rounded-xl border border-slate-800/90 bg-slate-900/60 px-4 py-3">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Ghost & Kỷ lục PB</span>
              <Award className="h-3.5 w-3.5 text-teal-400" />
            </div>
            <div
              data-testid="hud-ghost-status"
              className="mt-1 font-mono text-xs font-semibold tabular-nums"
            >
              {settings.ghostEnabled && ghostAttempt ? (
                <div>
                  <span
                    className={
                      ghostDiff !== null && ghostDiff >= 0
                        ? 'text-emerald-400'
                        : 'text-rose-400'
                    }
                  >
                    {ghostDiff !== null && ghostDiff >= 0
                      ? `+${ghostDiff}`
                      : ghostDiff}{' '}
                    ký tự đúng
                  </span>
                  <div className="mt-0.5 text-[11px] font-normal text-slate-400">
                    PB: {Math.round(pbAttempt?.wpm ?? ghostAttempt.wpm)} WPM
                    {isGhostFallbackFromPB
                      ? ' · Ghost dùng lượt tốt nhất có replay'
                      : ''}
                  </div>
                </div>
              ) : (
                <div className="text-slate-400 font-sans text-xs leading-snug">
                  {pbAttempt
                    ? `PB: ${Math.round(pbAttempt.wpm)} WPM (Đã tắt Ghost)`
                    : 'Hoàn thành bài để tạo Ghost'}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Central Typing Arena */}
        <section
          aria-label="Khu vực nhập văn bản luyện gõ"
          onClick={focusTypingInput}
          className={`relative flex min-h-[260px] flex-col justify-between rounded-2xl border transition-colors ${
            isTextareaFocused
              ? 'border-slate-700 bg-slate-900/85 shadow-xl'
              : 'border-slate-800/80 bg-slate-900/50'
          } ${
            isShaking &&
            settings.screenShakeEnabled &&
            !settings.reducedMotionSystem
              ? 'animate-[shake_0.22s_ease-in-out]'
              : ''
          } p-6 sm:p-8`}
        >
          {/* Real Hidden/Accessible Textarea Input (Single Source of Input & Composition) */}
          <label htmlFor="auratype-typing-input" className="sr-only">
            Nhập nội dung bài luyện gõ tại đây
          </label>
          <textarea
            id="auratype-typing-input"
            ref={textareaRef}
            data-testid="typing-textarea"
            rows={1}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            autoComplete="off"
            disabled={engine.status === 'interrupted' || engine.status === 'loading'}
            onFocus={() => setIsTextareaFocused(true)}
            onBlur={() => setIsTextareaFocused(false)}
            onBeforeInput={handleBeforeInput}
            onCompositionStart={handleCompositionStart}
            onCompositionUpdate={handleCompositionUpdate}
            onCompositionEnd={handleCompositionEnd}
            onInput={handleTextareaInput}
            onKeyDown={handleKeyDown}
            onPaste={(e) => {
              e.preventDefault();
              setInputNotice(
                'Không hỗ trợ dán (paste) văn bản. Hãy gõ trực tiếp từng phím.'
              );
            }}
            onDrop={(e) => {
              e.preventDefault();
              setInputNotice('Không hỗ trợ kéo thả văn bản vào vùng luyện gõ.');
            }}
            className="absolute top-0 left-0 h-1 w-1 opacity-0 pointer-events-none"
          />

          {/* Top Arena Metadata Bar */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-3 text-xs text-slate-400">
            <div className="flex items-center gap-2 font-mono">
              <span className="font-semibold text-slate-200">
                {currentPassage?.language === 'vi' ? 'Tiếng Việt (NFC)' : 'English'}
              </span>
              <span aria-hidden="true">·</span>
              <span>Chủ đề: {currentPassage?.topic || settings.topic}</span>
              <span aria-hidden="true">·</span>
              <span>{engine.targetGraphemes.length} ký tự</span>
              <span aria-hidden="true">·</span>
              <span>
                Nguồn:{' '}
                {currentPassage?.source === 'ai'
                  ? 'AI Generated'
                  : currentPassage?.source === 'imported'
                  ? 'Imported'
                  : 'Bài mẫu chuẩn'}
              </span>
            </div>

            <div className="flex items-center gap-3">
              {isRevealingText && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    skipTextReveal();
                    focusTypingInput();
                  }}
                  className="rounded-md border border-sky-500/40 bg-sky-950/50 px-2.5 py-0.5 text-xs font-medium text-sky-300 hover:bg-sky-900/60 cursor-pointer"
                >
                  Bỏ qua hiệu ứng chữ
                </button>
              )}
              <span className="text-xs text-slate-400">
                {engine.status === 'ready'
                  ? 'Gõ phím đầu tiên để bắt đầu tính giờ'
                  : engine.status === 'running'
                  ? 'Đang tính giờ · Esc để mở Cài đặt'
                  : engine.status === 'completed'
                  ? 'Đã hoàn thành bài'
                  : 'Tạm dừng'}
              </span>
            </div>
          </div>

          {/* Grapheme Stream & Caret Viewport */}
          <div
            ref={textContainerRef}
            data-testid="passage-display"
            className="relative max-h-[240px] overflow-y-auto py-2 font-mono text-xl sm:text-2xl leading-[2.05] tracking-wide select-none"
          >
            {/* Particle & Shockwave Canvas */}
            <TypingCanvas
              signal={particleSignal}
              getCharCoordinates={getCharCenterCoordinates}
              enabled={settings.fxMode === 'ultra' && !settings.reducedMotionSystem}
            />

            {/* Comet User Caret & Ghost Caret */}
            {engine.status !== 'loading' && (
              <Caret
                userPos={userCaretPos}
                ghostPos={ghostCaretPos}
                wpm={engine.wpm}
                isRunning={engine.status === 'running'}
                cometTrailEnabled={settings.cometTrailEnabled}
                fxMode={settings.fxMode}
                reducedMotion={settings.reducedMotionSystem}
              />
            )}

            {/* Character Spans grouped by word boundaries to prevent mid-word line breaks */}
            <div className="relative z-10">
              {(() => {
                const groups: { isSpace: boolean; indices: number[] }[] = [];
                engine.targetGraphemes.forEach((g, idx) => {
                  const isSpace = g === ' ';
                  const last = groups[groups.length - 1];
                  if (!last || last.isSpace !== isSpace) {
                    groups.push({ isSpace, indices: [idx] });
                  } else {
                    last.indices.push(idx);
                  }
                });

                const typedLen = engine.typedGraphemes.length;

                return groups.map((group, gIdx) => (
                  <span
                    key={gIdx}
                    className={
                      group.isSpace
                        ? 'inline-block whitespace-pre'
                        : 'inline-block whitespace-nowrap'
                    }
                  >
                    {group.indices.map((idx) => {
                      const targetChar = engine.targetGraphemes[idx];
                      const isTyped = idx < typedLen;
                      const typedChar = isTyped ? engine.typedGraphemes[idx] : null;
                      const isCorrect = isTyped && typedChar === targetChar;
                      const isError = isTyped && typedChar !== targetChar;

                      const compOffset = idx - typedLen;
                      const isComposingHere =
                        engine.isComposing &&
                        compOffset >= 0 &&
                        compOffset < compositionGraphemes.length;
                      const composedChar = isComposingHere
                        ? compositionGraphemes[compOffset]
                        : null;

                      const isScrambled =
                        isRevealingText &&
                        revealProgress < 1 &&
                        idx / Math.max(1, engine.targetGraphemes.length) >
                          revealProgress &&
                        targetChar !== ' ';
                      const displayChar = isScrambled
                        ? SCRAMBLE_GLYPHS[
                            (idx * 7 + Math.floor(revealProgress * 20)) %
                              SCRAMBLE_GLYPHS.length
                          ]
                        : isComposingHere && composedChar
                        ? composedChar
                        : targetChar;

                      let charClass = 'text-slate-500/75';
                      if (isCorrect) {
                        charClass = 'text-slate-100';
                      } else if (isError) {
                        charClass =
                          'bg-rose-500/20 text-rose-300 underline decoration-rose-400 decoration-wavy underline-offset-4 rounded-xs';
                      } else if (isComposingHere) {
                        charClass =
                          'bg-sky-500/20 text-sky-200 underline decoration-sky-400 decoration-dotted underline-offset-4';
                      }

                      const isJustTyped =
                        idx === engine.lastCommitIndex && engine.status === 'running';

                      return (
                        <span
                          key={idx}
                          ref={(el) => {
                            charSpansRef.current[idx] = el;
                          }}
                          data-char-index={idx}
                          data-char-state={
                            isCorrect
                              ? 'correct'
                              : isError
                              ? 'error'
                              : isComposingHere
                              ? 'composing'
                              : 'pending'
                          }
                          className={`${
                            targetChar === ' '
                              ? 'whitespace-pre-wrap'
                              : 'inline-block whitespace-pre'
                          } transition-transform duration-75 ${charClass} ${
                            isJustTyped &&
                            !settings.reducedMotionSystem &&
                            engine.lastCommitOutcome === 'error'
                              ? 'scale-110'
                              : ''
                          }`}
                        >
                          {displayChar}
                        </span>
                      );
                    })}
                  </span>
                ));
              })()}
            </div>
          </div>

          {/* Interrupted State Overlay (Section 7.1: Requires explicit restart, does not auto-resume) */}
          {engine.status === 'interrupted' && (
            <div
              data-testid="interrupted-overlay"
              className="absolute inset-0 z-30 flex flex-col items-center justify-center rounded-2xl bg-slate-950/90 p-6 text-center backdrop-blur-md"
            >
              <AlertCircle className="h-8 w-8 text-amber-400" />
              <h3 className="mt-2 font-display text-lg font-bold text-slate-100">
                Lượt gõ đã tạm dừng (Bỏ dở)
              </h3>
              <p className="mt-1 max-w-md text-xs leading-relaxed text-slate-300">
                {engine.interruptReason ||
                  'Để đảm bảo tính chính xác của WPM và PB, lượt gõ bị gián đoạn khi rời tiêu điểm sẽ không tính điểm.'}
              </p>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  retryCurrentPassage();
                  setTimeout(focusTypingInput, 20);
                }}
                className="mt-4 flex items-center gap-2 rounded-lg bg-sky-500 px-5 py-2.5 text-xs font-semibold text-slate-950 hover:bg-sky-400 cursor-pointer"
              >
                <RotateCcw className="h-4 w-4" />
                <span>Bắt đầu lại lượt mới (0s)</span>
              </button>
            </div>
          )}

          {/* Bottom Hint Bar inside Arena */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/80 pt-3 text-xs text-slate-400">
            <div className="flex items-center gap-2">
              {engine.typedGraphemes.length === engine.targetGraphemes.length &&
              engine.status === 'running' ? (
                <span className="font-semibold text-rose-300">
                  Ký tự cuối đang gõ sai — Hãy nhấn Backspace xóa và gõ đúng ký tự cuối để hoàn thành bài!
                </span>
              ) : (
                <span>
                  Hỗ trợ gõ Tiếng Việt (Telex / VNI) chuẩn NFC · Backspace để sửa ký tự cuối · Ctrl+Backspace xóa cụm từ
                </span>
              )}
            </div>

            {engine.status === 'completed' && resultModalDismissed && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setResultModalDismissed(false);
                }}
                className="flex items-center gap-1.5 rounded-md bg-emerald-500/20 px-2.5 py-1 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/30 cursor-pointer"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>Xem lại bảng Kết quả</span>
              </button>
            )}
          </div>
        </section>

        {/* 2.5D Virtual Mechanical Keyboard */}
        {settings.virtualKeyboardEnabled && (
          <VirtualKeyboard
            expectedGrapheme={expectedNextGrapheme}
            lastKeyPressed={lastKeyPressed}
            lastOutcome={engine.lastCommitOutcome}
          />
        )}

        {/* Quiet Footer */}
        <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-900 pt-4 text-xs text-slate-500">
          <div>
            AuraType AI · Grapheme-Accurate Typing Engine · Dữ liệu lưu cục bộ trên trình duyệt của bạn
          </div>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={handleOpenHistory}
              className="hover:text-slate-300 transition-colors cursor-pointer"
            >
              Kho Lịch sử & Ghost
            </button>
            <button
              type="button"
              onClick={handleOpenSettings}
              className="hover:text-slate-300 transition-colors cursor-pointer"
            >
              Sao lưu / Import JSON
            </button>
          </div>
        </footer>
      </main>

      {/* Modals & Drawers */}
      {engine.status === 'completed' && !resultModalDismissed && (
        <ResultModal
          onClose={() => setResultModalDismissed(true)}
          onRetry={() => {
            setResultModalDismissed(false);
            retryCurrentPassage();
            setTimeout(focusTypingInput, 20);
          }}
          onOpenHistory={() => setHistoryOpen(true)}
          onGenerateAI={handleRequestGenerateAI}
        />
      )}

      {settingsOpen && (
        <SettingsModal
          onClose={() => {
            setSettingsOpen(false);
            if (useTypingStore.getState().engine.status === 'ready') {
              setTimeout(focusTypingInput, 20);
            }
          }}
        />
      )}

      {historyOpen && (
        <HistoryDrawer
          onClose={() => {
            setHistoryOpen(false);
            if (useTypingStore.getState().engine.status === 'ready') {
              setTimeout(focusTypingInput, 20);
            }
          }}
          onSelectPassage={(passageId) => {
            selectPassageById(passageId);
            setHistoryOpen(false);
            setTimeout(focusTypingInput, 20);
          }}
        />
      )}

      {pendingConfirm && (
        <ConfirmAbandonModal
          title={pendingConfirm.title}
          description={pendingConfirm.description}
          confirmLabel={pendingConfirm.confirmLabel}
          onConfirm={pendingConfirm.action}
          onCancel={() => {
            setPendingConfirm(null);
            if (useTypingStore.getState().engine.status === 'ready') {
              setTimeout(focusTypingInput, 20);
            }
          }}
        />
      )}
    </div>
  );
}
