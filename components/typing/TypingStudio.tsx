'use client';

import {
  evaluateBeforeInput,
  reconcileInputDiff,
  resolveCompositionEnd,
} from '@/engine/inputAdapter';
import { getGhostPositionAtTime } from '@/engine/replayEngine';
import { countGraphemesForWordDelete } from '@/engine/typingEngine';
import { subscribeCooldownSync } from '@/services/llmService';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useTypingStore } from '@/store/useTypingStore';
import { formatLiveWpm } from '@/utils/calculations';
import { coachingTip, practiceSummary, targetPosition } from '@/utils/practice';
import { Language, PassageLength, Topic } from '@/utils/text';
import {
  AlertCircle,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  FileText,
  Ghost,
  Keyboard,
  Leaf,
  RotateCcw,
  Sparkles as Sparkle,
  TrendingUp,
  Volume2,
  VolumeX,
  Zap,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import ConfirmAbandonModal from '../modals/ConfirmAbandonModal';
import Caret, { CaretVisualPosition } from './Caret';
import HeaderBar from './HeaderBar';
import PassageText from './PassageText';
import TypingCanvas from './TypingCanvas';
import VirtualKeyboard from './VirtualKeyboard';
const CustomPassageModal = dynamic(
  () => import('../modals/CustomPassageModal')
);
const JourneyPanel = dynamic(() => import('./JourneyPanel'));
const ResultModal = dynamic(() => import('../modals/ResultModal'));
const SettingsModal = dynamic(() => import('../modals/SettingsModal'));
const HistoryDrawer = dynamic(() => import('../history/HistoryDrawer'));

export default function TypingStudio() {
  const settings = useSettingsStore();
  const typingStore = useTypingStore();
  const {
    engine,
    currentPassage,
    ghostAttempt,
    storageFallback,
    inputNotice,
    particleSignal,
    screenShakeSeq,
    lastKeyPressed,
    aiReady,
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

  // Modals & Drawers
  const [customOpen, setCustomOpen] = useState(false);
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
  const [ghostCaretPos, setGhostCaretPos] =
    useState<CaretVisualPosition | null>(null);

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

  const setReducedMotion = settings.setReducedMotion;
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [setReducedMotion]);

  // Trigger transient screen shake without remounting the DOM tree
  useEffect(() => {
    if (screenShakeSeq <= 0) return;
    setIsShaking(true);
    const id = window.setTimeout(() => setIsShaking(false), 240);
    return () => window.clearTimeout(id);
  }, [screenShakeSeq]);

  const hasCooldown = cooldownRemainingMs > 0;
  useEffect(() => {
    if (!hasCooldown) return;
    let previous = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      tickCooldown(now - previous);
      previous = now;
    }, 250);
    return () => window.clearInterval(id);
  }, [hasCooldown, tickCooldown]);

  useEffect(() => {
    if (isRevealingText) skipTextReveal();
  }, [isRevealingText, skipTextReveal]);

  // Sync hidden textarea value when engine resets to ready
  useEffect(() => {
    if (engine.status === 'ready' && textareaRef.current) {
      textareaRef.current.value = '';
    }
  }, [engine.status, currentPassage?.id]);

  useEffect(() => {
    setResultModalDismissed(false);
  }, [engine.attemptId]);

  // Focus textarea helper
  const focusTypingInput = useCallback(() => {
    if (
      settingsOpen ||
      customOpen ||
      historyOpen ||
      pendingConfirm ||
      (engine.status === 'completed' && !resultModalDismissed)
    ) {
      return;
    }
    textareaRef.current?.focus({ preventScroll: true });
  }, [
    settingsOpen,
    customOpen,
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
    if (!settings.ghostEnabled || (!ghostAttempt && !settings.targetWpm))
      return null;
    if (engine.status === 'ready') {
      return { index: 0, correctCount: 0, finished: false };
    }
    if (settings.targetWpm) {
      const index = targetPosition(
        settings.targetWpm,
        engine.elapsedMs,
        engine.targetGraphemes.length
      );
      return {
        index,
        correctCount: index,
        finished: index === engine.targetGraphemes.length,
      };
    }
    if (!ghostAttempt) return null;
    return getGhostPositionAtTime(
      ghostAttempt.replay,
      engine.elapsedMs,
      engine.targetGraphemes.length
    );
  }, [
    settings.targetWpm,
    settings.ghostEnabled,
    ghostAttempt,
    engine.status,
    engine.elapsedMs,
    engine.targetGraphemes.length,
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
      (ghostAttempt || settings.targetWpm > 0) &&
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
    settings.targetWpm,
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
    const observer = new ResizeObserver(onResize);
    if (textContainerRef.current) observer.observe(textContainerRef.current);
    document.fonts.ready.then(onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      observer.disconnect();
    };
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

    const syncedTyped = useTypingStore
      .getState()
      .engine.typedGraphemes.join('');
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
    const syncedTyped = useTypingStore
      .getState()
      .engine.typedGraphemes.join('');
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

    if ((e.ctrlKey || e.metaKey || e.altKey) && e.key !== 'Backspace') return;

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
          const synced = useTypingStore
            .getState()
            .engine.typedGraphemes.join('');
          textareaRef.current.value = synced;
          textareaRef.current.setSelectionRange(synced.length, synced.length);
        }
      }
      return;
    }

    // Block arrow keys / Home / End from moving hidden textarea caret away from end
    if (
      [
        'ArrowLeft',
        'ArrowRight',
        'ArrowUp',
        'ArrowDown',
        'Home',
        'End',
      ].includes(e.key)
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
          onInterruptAttempt(
            'Đã kết thúc lượt để thực hiện thao tác mới.',
            performance.now()
          );
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
    if (!aiReady) {
      useTypingStore.setState({
        aiError:
          'Gemini chưa được cấu hình. Bạn vẫn có thể luyện bài mẫu hoặc nhập bài của bạn.',
      });
      return;
    }
    if (cooldownRemainingMs > 0) {
      triggerAiGeneration();
      return;
    }

    guardRunningAction(
      'Tạo bài AI mới khi đang gõ?',
      'Lượt gõ đang chạy sẽ bị hủy để tạo văn bản mới từ AI.',
      'Tạo bài AI mới',
      () => {
        setResultModalDismissed(true);
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
          onInterruptAttempt(
            'Đã hủy lượt gõ để mở Cài đặt.',
            performance.now()
          );
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
          onInterruptAttempt(
            'Đã hủy lượt gõ để xem Lịch sử.',
            performance.now()
          );
        }
        setHistoryOpen(true);
      }
    );
  };

  const expectedNextGrapheme =
    engine.targetGraphemes[engine.typedGraphemes.length];

  const statusBannerMessage =
    inputNotice || aiError || null || storageFallback.reason;

  const summary = useMemo(
    () => practiceSummary(typingStore.attempts),
    [typingStore.attempts]
  );
  const progress = engine.targetGraphemes.length
    ? (engine.typedGraphemes.length / engine.targetGraphemes.length) * 100
    : 0;
  const change = (lang: Language, topic: Topic, length: PassageLength) => {
    if (!typingStore.aiGenerating)
      handleRequestSampleChange(lang, topic, length);
  };
  const retry = () =>
    guardRunningAction(
      'Bắt đầu lại?',
      'Lượt hiện tại sẽ được lưu là bỏ dở.',
      'Bắt đầu lại',
      retryCurrentPassage
    );
  const openCustom = () =>
    guardRunningAction(
      'Đổi nội dung luyện?',
      'Lượt hiện tại sẽ kết thúc để mở bài của bạn.',
      'Tiếp tục',
      () => setCustomOpen(true)
    );
  return (
    <div className="studio-app">
      <a className="skip-link" href="#typing-controls">
        Đến vùng luyện gõ
      </a>
      <HeaderBar
        onOpenHistory={handleOpenHistory}
        onOpenSettings={handleOpenSettings}
        onRequestGenerateAI={handleRequestGenerateAI}
        onRequestSampleChange={handleRequestSampleChange}
      />
      <main id="studio" className="studio-main">
        <div className="page-intro">
          <div>
            <div className="eyebrow">
              <span className="live-dot" /> KHÔNG GIAN CỦA SỰ TẬP TRUNG
            </div>
            <h1>
              Tìm nhịp gõ <em>của bạn.</em>
            </h1>
            <p>Mỗi phím gõ, một chút tiến bộ. Thả lỏng và bắt đầu.</p>
          </div>
          <a className="text-link intro-link" href="#journey">
            Hành trình của bạn <ArrowUpRight size={17} />
          </a>
        </div>
        <div className="workspace-tabs">
          <span className="workspace-tab active">
            <Keyboard size={16} /> Phòng luyện
          </span>
          <button onClick={openCustom} disabled={typingStore.aiGenerating}>
            <FileText size={15} /> Bài của bạn
          </button>
          <button onClick={handleOpenHistory}>
            <TrendingUp size={15} /> Thành tích
          </button>
          <span className="workspace-hint">
            <span className="tiny-key">esc</span> cài đặt
          </span>
        </div>
        <section className="practice-panel" aria-label="Phòng luyện gõ">
          <div id="typing-controls" className="practice-toolbar">
            <div className="control-set" role="group" aria-label="Ngôn ngữ">
              {(['vi', 'en'] as const).map((lang) => (
                <button
                  key={lang}
                  disabled={typingStore.aiGenerating}
                  aria-pressed={settings.language === lang}
                  onClick={() => change(lang, settings.topic, settings.length)}
                >
                  {lang === 'vi' ? 'Tiếng Việt' : 'English'}
                </button>
              ))}
            </div>
            <span className="toolbar-divider" />
            <label className="topic-select">
              <BookOpen size={14} />
              <select
                aria-label="Chủ đề"
                disabled={typingStore.aiGenerating}
                value={settings.topic}
                onChange={(e) =>
                  change(
                    settings.language,
                    e.target.value as Topic,
                    settings.length
                  )
                }
              >
                <option value="philosophy">Suy ngẫm</option>
                <option value="scifi">Viễn tưởng</option>
                <option value="code">Lập trình</option>
              </select>
            </label>
            <div
              className="control-set length-control"
              role="group"
              aria-label="Độ dài"
            >
              {(['short', 'medium', 'long'] as const).map((length) => (
                <button
                  key={length}
                  disabled={typingStore.aiGenerating}
                  aria-pressed={settings.length === length}
                  onClick={() =>
                    change(settings.language, settings.topic, length)
                  }
                >
                  {{ short: 'Ngắn', medium: 'Vừa', long: 'Dài' }[length]}
                </button>
              ))}
            </div>
            <button
              className="mode-toggle"
              aria-pressed={settings.fxMode === 'ultra'}
              onClick={() =>
                settings.setFxMode(
                  settings.fxMode === 'lite' ? 'ultra' : 'lite'
                )
              }
            >
              {settings.fxMode === 'lite' ? (
                <Leaf size={14} />
              ) : (
                <Zap size={14} />
              )}{' '}
              {settings.fxMode === 'lite' ? 'Zen mode' : 'Ultra mode'}{' '}
              <span
                className={`toggle-track ${settings.fxMode === 'ultra' ? 'on' : ''}`}
              />
            </button>
          </div>
          <div className="metrics-bar" aria-label="Chỉ số trực tiếp">
            <div className="metric primary-metric">
              <span>TỐC ĐỘ</span>
              <strong data-testid="hud-net-wpm">
                {formatLiveWpm(
                  engine.correctFinal,
                  engine.elapsedMs,
                  engine.status
                )}
                <small> WPM</small>
              </strong>
            </div>
            <div className="metric">
              <span>CHÍNH XÁC</span>
              <strong data-testid="hud-accuracy">
                {engine.accuracy === null ? '—' : engine.accuracy.toFixed(1)}
                <small> %</small>
              </strong>
            </div>
            <div className="metric">
              <span>THỜI GIAN</span>
              <strong>
                {Math.floor(engine.elapsedMs / 1000)}
                <small> giây</small>
              </strong>
            </div>
            <div className="metric">
              <span>CHUỖI ĐÚNG</span>
              <strong>
                {engine.combo}
                <small> phím</small>
              </strong>
            </div>
            <div className="session-indicator">
              <span
                className={
                  engine.status === 'running' ? 'live-dot' : 'neutral-dot'
                }
              />
              {engine.status === 'running'
                ? 'Đang luyện'
                : engine.status === 'completed'
                  ? 'Hoàn thành'
                  : 'Sẵn sàng'}
            </div>
          </div>
          <div
            className={`typing-arena ${isShaking && settings.fxMode === 'ultra' && !settings.reducedMotionSystem ? 'arena-shake' : ''} ${isTextareaFocused ? 'focused' : ''}`}
            onClick={focusTypingInput}
          >
            <div className="passage-meta">
              <span>
                {currentPassage?.source === 'ai' ? (
                  <Sparkle size={13} />
                ) : (
                  <AlignIcon />
                )}
                {currentPassage?.source === 'ai'
                  ? 'AI GENERATED'
                  : currentPassage?.source === 'imported'
                    ? 'BÀI CỦA BẠN'
                    : 'BÀI MẪU'}
                <span className="meta-dot">·</span>
                {currentPassage?.language === 'vi' ? 'TIẾNG VIỆT' : 'ENGLISH'}
                <span className="meta-dot">·</span>
                {engine.targetGraphemes.length} KÝ TỰ
              </span>
              <span className="focus-hint">
                {isTextareaFocused
                  ? 'Bắt đầu khi bạn sẵn sàng'
                  : 'Bấm vào đây để luyện'}
              </span>
            </div>
            <label htmlFor="auratype-typing-input" className="sr-only">
              Nhập nội dung bài luyện gõ
            </label>
            <p id="typing-instructions" className="sr-only">
              Gõ theo bài bên dưới. Backspace để sửa. Tab để rời vùng gõ; Esc mở
              cài đặt. Dán văn bản không được tính.
            </p>
            <textarea
              id="auratype-typing-input"
              ref={textareaRef}
              data-testid="typing-textarea"
              rows={1}
              aria-describedby="typing-instructions"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              autoComplete="off"
              disabled={
                typingStore.aiGenerating ||
                engine.status === 'interrupted' ||
                engine.status === 'loading' ||
                engine.status === 'completed'
              }
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
                  'Hãy gõ trực tiếp. Bạn có thể dán văn bản trong mục Bài của bạn.'
                );
              }}
              onDrop={(e) => {
                e.preventDefault();
                setInputNotice('Không kéo thả vào lượt luyện.');
              }}
              className="typing-input"
            />
            <div
              ref={textContainerRef}
              data-testid="passage-display"
              className="passage-viewport"
            >
              <TypingCanvas
                signal={particleSignal}
                getCharCoordinates={getCharCenterCoordinates}
                enabled={
                  settings.fxMode === 'ultra' && !settings.reducedMotionSystem
                }
              />
              <Caret
                ghostLabel={settings.targetWpm ? `${settings.targetWpm}` : 'PB'}
                userPos={userCaretPos}
                ghostPos={ghostCaretPos}
                wpm={engine.wpm}
                isRunning={engine.status === 'running'}
                cometTrailEnabled={settings.cometTrailEnabled}
                fxMode={settings.fxMode}
                reducedMotion={settings.reducedMotionSystem}
              />
              <PassageText
                target={engine.targetGraphemes}
                typed={engine.typedGraphemes}
                composition={engine.compositionText}
                charRefs={charSpansRef}
              />
            </div>
            <p className="sr-only">Bài luyện: {engine.targetText}</p>
            {engine.status === 'interrupted' && (
              <div
                className="interrupted-overlay"
                data-testid="interrupted-overlay"
              >
                <Keyboard size={28} />
                <h2>Nghỉ một nhịp.</h2>
                <p>
                  Lượt vừa rồi đã kết thúc khi bạn rời cửa sổ.
                  <br />
                  Bắt đầu lượt mới để đo tốc độ chính xác.
                </p>
                <button
                  className="primary-button"
                  onClick={(e) => {
                    e.stopPropagation();
                    retryCurrentPassage();
                  }}
                >
                  Luyện lại <ArrowRight size={16} />
                </button>
              </div>
            )}
            {typingStore.aiGenerating && (
              <div className="generating-overlay">
                <Sparkle size={25} />
                <p>Đang chuẩn bị bài mới…</p>
                <button
                  className="text-link"
                  onClick={typingStore.cancelAiGeneration}
                >
                  Hủy yêu cầu
                </button>
              </div>
            )}
          </div>
          <div
            className="progress-track"
            role="progressbar"
            aria-label="Tiến độ bài"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress)}
          >
            <div style={{ transform: `scaleX(${progress / 100})` }} />
          </div>
          <div className="arena-footer">
            <span>
              <span className="tiny-key">
                {engine.status === 'running' ? '⌫' : '↵'}
              </span>
              {engine.status === 'running'
                ? 'Backspace để sửa ký tự'
                : 'Gõ ký tự đầu tiên để bắt đầu'}
              <span className="footer-progress" data-testid="hud-progress">
                {engine.typedGraphemes.length} / {engine.targetGraphemes.length}
              </span>
            </span>
            <div>
              <button
                className="icon-button"
                aria-label={
                  settings.soundEnabled ? 'Tắt âm thanh' : 'Bật âm thanh'
                }
                aria-pressed={settings.soundEnabled}
                onClick={() => settings.setSoundEnabled(!settings.soundEnabled)}
              >
                {settings.soundEnabled ? (
                  <Volume2 size={17} />
                ) : (
                  <VolumeX size={17} />
                )}
              </button>
              <button
                className="icon-button"
                aria-label="Bật tắt bàn phím ảo"
                aria-pressed={settings.virtualKeyboardEnabled}
                onClick={() =>
                  settings.setVirtualKeyboardEnabled(
                    !settings.virtualKeyboardEnabled
                  )
                }
              >
                <Keyboard size={17} />
              </button>
              <button
                className="retry-button"
                disabled={typingStore.aiGenerating}
                onClick={retry}
              >
                <RotateCcw size={15} /> Gõ lại
              </button>
            </div>
          </div>
        </section>
        {statusBannerMessage && (
          <div role="status" className="notice">
            <AlertCircle size={16} />
            <span>{statusBannerMessage}</span>
            <button
              className="text-link"
              onClick={() => {
                setInputNotice(null);
                useTypingStore.setState({ aiError: null });
              }}
            >
              Đã hiểu
            </button>
          </div>
        )}
        {engine.typedGraphemes.length === engine.targetGraphemes.length &&
          engine.status === 'running' && (
            <p role="status" className="notice">
              Ký tự cuối chưa đúng. Nhấn Backspace và sửa để hoàn thành.
            </p>
          )}
        {engine.status === 'completed' && resultModalDismissed && (
          <button
            className="text-link"
            onClick={() => setResultModalDismissed(false)}
          >
            Xem kết quả lượt vừa rồi <ArrowUpRight size={15} />
          </button>
        )}
        {settings.virtualKeyboardEnabled && (
          <div className="keyboard-wrap">
            <VirtualKeyboard
              expectedGrapheme={expectedNextGrapheme}
              lastKeyPressed={lastKeyPressed}
              lastOutcome={engine.lastCommitOutcome}
            />
          </div>
        )}
        <div className="support-grid">
          <section className="support-card ghost-card">
            <div className="card-heading">
              <span className="card-icon">
                <Ghost size={19} />
              </span>
              <span>Đua với chính mình</span>
              <span className="small-badge">GHOST</span>
            </div>
            <p>
              Biến nhịp gõ hôm qua thành
              <br className="desktop-break" /> cột mốc của hôm nay.
            </p>
            <label className="ghost-selector">
              <span>Đối thủ</span>
              <select
                aria-label="Chọn đối thủ Ghost"
                value={settings.targetWpm}
                onChange={(e) =>
                  guardRunningAction(
                    'Đổi đối thủ?',
                    'Đối thủ mới sẽ áp dụng cho lượt mới.',
                    'Bắt đầu lượt mới',
                    () => {
                      settings.setTargetWpm(Number(e.target.value));
                      retryCurrentPassage();
                    }
                  )
                }
              >
                <option value={0}>Kỷ lục cá nhân</option>
                {[
                  ...new Set([
                    30,
                    40,
                    50,
                    60,
                    80,
                    100,
                    120,
                    ...(settings.targetWpm > 0 ? [settings.targetWpm] : []),
                  ]),
                ]
                  .sort((a, b) => a - b)
                  .map((n) => (
                    <option key={n} value={n}>
                      Mục tiêu {n} WPM
                    </option>
                  ))}
              </select>
            </label>
            <div className="ghost-status" data-testid="hud-ghost-status">
              <span className="live-dot" />
              {settings.targetWpm
                ? `Đối thủ chạy đều ${settings.targetWpm} WPM`
                : ghostAttempt
                  ? `Ghost · ${Math.round(ghostAttempt.wpm)} WPM`
                  : 'Hoàn thành bài để mở Ghost'}
            </div>
          </section>
          <section className="support-card journey-card">
            <div className="card-heading">
              <span className="card-icon">
                <TrendingUp size={19} />
              </span>
              <span>Chậm mà chắc.</span>
              <span className="muted">{summary.count} lượt</span>
            </div>
            <div className="journey-metrics">
              <div>
                <strong>
                  {summary.count ? Math.round(summary.average) : '—'}
                </strong>
                <span>WPM trung bình</span>
              </div>
              <div>
                <strong>
                  {Math.round(summary.minutes)}
                  <small> phút</small>
                </strong>
                <span>Thời gian đã luyện</span>
              </div>
            </div>
            <div className="mini-chart" aria-label="Tốc độ các lượt gần đây">
              {summary.recent.length ? (
                summary.recent.map((a) => (
                  <div
                    key={a.id}
                    title={`${Math.round(a.wpm)} WPM`}
                    style={{
                      height: `${Math.max(8, (a.wpm / Math.max(...summary.recent.map((r) => r.wpm), 1)) * 100)}%`,
                    }}
                  />
                ))
              ) : (
                <div className="empty-chart">
                  Một lượt luyện hôm nay, một bước tiến ngày mai.
                </div>
              )}
            </div>
            <button className="text-link" onClick={handleOpenHistory}>
              Xem hành trình <ArrowUpRight size={14} />
            </button>
          </section>
          <section className="support-card coach-card">
            <div className="card-heading">
              <span className="card-icon">
                <Sparkle size={19} />
              </span>
              <span>Một chút gợi ý</span>
            </div>
            <p>
              {coachingTip(engine.accuracy, engine.remainingErrors, engine.wpm)}
            </p>
            <div className="coach-bottom">
              <span className="small-badge">TẬP TRUNG & TIẾN BỘ</span>
              <button
                className="icon-button"
                aria-label="Tùy chỉnh buổi luyện"
                onClick={handleOpenSettings}
              >
                <ArrowUpRight size={19} />
              </button>
            </div>
          </section>
        </div>
        <JourneyPanel />
        <footer className="studio-footer">
          <span>
            <span className="brand-mini">
              aura<span>type</span>
            </span>{' '}
            Ít xao nhãng. Nhiều tiến bộ.
          </span>
          <div>
            <span className="provider-status">
              <i className={aiReady ? 'live-dot' : 'neutral-dot'} />
              {aiReady ? 'Gemini sẵn sàng' : 'Chế độ bài mẫu'}
            </span>
            <button onClick={handleOpenSettings}>
              Dữ liệu & cài đặt <ArrowUpRight size={13} />
            </button>
          </div>
        </footer>
      </main>
      {engine.status === 'completed' &&
        !resultModalDismissed &&
        !settingsOpen &&
        !historyOpen &&
        !customOpen && (
          <ResultModal
            onClose={() => setResultModalDismissed(true)}
            onRetry={() => {
              setResultModalDismissed(false);
              retryCurrentPassage();
            }}
            onOpenHistory={() => {
              setResultModalDismissed(true);
              setHistoryOpen(true);
            }}
            onGenerateAI={handleRequestGenerateAI}
          />
        )}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      {historyOpen && (
        <HistoryDrawer
          onClose={() => setHistoryOpen(false)}
          onSelectPassage={(id) => {
            selectPassageById(id);
            setHistoryOpen(false);
          }}
        />
      )}
      {customOpen && (
        <CustomPassageModal
          onClose={() => setCustomOpen(false)}
          onStart={typingStore.loadCustomPassage}
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
            requestAnimationFrame(() =>
              textareaRef.current?.focus({ preventScroll: true })
            );
          }}
        />
      )}
    </div>
  );
}
function AlignIcon() {
  return <FileText size={13} />;
}
