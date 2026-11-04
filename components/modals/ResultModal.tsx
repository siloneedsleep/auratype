'use client';
import { downloadResultCard } from '@/utils/shareResult';
import { useDialog } from '@/hooks/useDialog';
import { coachingTip, mistakeTargets } from '@/utils/practice';

import confetti from 'canvas-confetti';
import {
  AlertTriangle,
  Award,
  CheckCircle2,
  History,
  RefreshCw,
  RotateCcw,
  Sparkles,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useTypingStore } from '../../store/useTypingStore';
import { formatAccuracy, RankTier, WpmSample } from '../../utils/calculations';

interface ResultModalProps {
  onClose: () => void;
  onRetry: () => void;
  onOpenHistory: () => void;
  onGenerateAI: () => void;
}

const RANK_STYLES: Record<
  RankTier,
  { badge: string; label: string; thresholdText: string }
> = {
  'S+': {
    badge: 'border-amber-400 bg-amber-500/15 text-amber-300',
    label: 'Huyền thoại · S+',
    thresholdText: 'Đạt ≥ 100 WPM & ≥ 99% Chính xác',
  },
  S: {
    badge: 'border-violet-400 bg-violet-500/15 text-violet-300',
    label: 'Xuất sắc · S',
    thresholdText: 'Đạt ≥ 80 WPM & ≥ 98% Chính xác',
  },
  A: {
    badge: 'border-sky-400 bg-sky-500/15 text-sky-300',
    label: 'Thuần thục · A',
    thresholdText: 'Đạt ≥ 60 WPM & ≥ 95% Chính xác',
  },
  B: {
    badge: 'border-emerald-400 bg-emerald-500/15 text-emerald-300',
    label: 'Ổn định · B',
    thresholdText: 'Đạt ≥ 40 WPM & ≥ 90% Chính xác',
  },
  C: {
    badge: 'border-slate-500 bg-slate-800 text-slate-300',
    label: 'Hoàn thành · C',
    thresholdText: 'Hoàn thành toàn bộ bài gõ',
  },
};

function WpmTimelineChart({ samples }: { samples: WpmSample[] }) {
  if (!samples || samples.length === 0) {
    return (
      <div className="flex h-36 items-center justify-center rounded-lg border border-slate-800 bg-slate-950/60 text-xs text-slate-500">
        Chưa đủ mẫu thời gian để vẽ biểu đồ.
      </div>
    );
  }

  const width = 560;
  const height = 140;
  const padX = 36;
  const padY = 20;
  const plotW = width - padX * 2;
  const plotH = height - padY * 2;

  const maxT = Math.max(1, samples[samples.length - 1].t);
  const maxWpm = Math.max(60, ...samples.map((s) => s.wpm)) * 1.15;

  const points = samples.map((s) => {
    const x = padX + (s.t / maxT) * plotW;
    const y = padY + plotH - Math.min(1, Math.max(0, s.wpm / maxWpm)) * plotH;
    return { x, y, t: s.t, wpm: Math.round(s.wpm) };
  });

  const polylinePoints =
    points.length === 1
      ? `${padX},${points[0].y} ${padX + plotW},${points[0].y}`
      : points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  const areaPath =
    points.length === 1
      ? `M ${padX} ${padY + plotH} L ${padX} ${points[0].y} L ${padX + plotW} ${
          points[0].y
        } L ${padX + plotW} ${padY + plotH} Z`
      : `M ${points[0].x.toFixed(1)} ${padY + plotH} ` +
        points.map((p) => `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ') +
        ` L ${points[points.length - 1].x.toFixed(1)} ${padY + plotH} Z`;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
      <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
        <span>Biểu đồ WPM tích lũy theo thời gian thực</span>
        <span className="font-mono tabular-nums">
          Đỉnh: {Math.round(Math.max(...samples.map((s) => s.wpm)))} WPM
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-36 w-full overflow-visible"
        role="img"
        aria-label="Biểu đồ tốc độ WPM theo giây"
      >
        <defs>
          <linearGradient id="wpmAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#38BDF8" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#38BDF8" stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Horizontal reference lines */}
        {[0, 0.5, 1].map((ratio, idx) => {
          const y = padY + plotH * (1 - ratio);
          const val = Math.round(maxWpm * ratio);
          return (
            <g key={idx}>
              <line
                x1={padX}
                y1={y}
                x2={width - padX}
                y2={y}
                stroke="#1E293B"
                strokeDasharray="3 3"
              />
              <text
                x={padX - 6}
                y={y + 3}
                textAnchor="end"
                className="fill-slate-500 font-mono text-[10px]"
              >
                {val}
              </text>
            </g>
          );
        })}

        <path d={areaPath} fill="url(#wpmAreaGrad)" />
        <polyline
          fill="none"
          stroke="#38BDF8"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={polylinePoints}
        />

        {points.map((pt, i) => (
          <circle
            key={i}
            cx={pt.x}
            cy={pt.y}
            r={i === points.length - 1 ? 3.5 : 2}
            className={
              i === points.length - 1 ? 'fill-amber-400' : 'fill-sky-400'
            }
          />
        ))}
      </svg>
    </div>
  );
}

export default function ResultModal({
  onClose,
  onRetry,
  onOpenHistory,
  onGenerateAI,
}: ResultModalProps) {
  const {
    engine,
    pbAttempt,
    saveStatus,
    saveErrorMessage,
    retrySaveCurrentAttempt,
  } = useTypingStore();
  const { fxMode, reducedMotionSystem } = useSettingsStore();

  const retryButtonRef = useRef<HTMLButtonElement | null>(null);
  const targetWpm = Math.round(engine.wpm);
  const [displayWpm, setDisplayWpm] = useState(
    reducedMotionSystem ? targetWpm : 0
  );

  // Odometer number roll & optional Confetti in Ultra Juice mode
  useEffect(() => {
    if (reducedMotionSystem) {
      setDisplayWpm(targetWpm);
      return;
    }

    let rafId: number;
    const duration = 550;
    const start = performance.now();

    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayWpm(Math.round(targetWpm * eased));
      if (progress < 1) {
        rafId = requestAnimationFrame(step);
      }
    };
    rafId = requestAnimationFrame(step);

    if (
      fxMode === 'ultra' &&
      (engine.rank === 'S+' || engine.rank === 'S' || engine.rank === 'A')
    ) {
      try {
        confetti({
          particleCount: 55,
          spread: 65,
          origin: { y: 0.6 },
          disableForReducedMotion: true,
        });
      } catch {
        // Ignore confetti canvas errors
      }
    }

    return () => cancelAnimationFrame(rafId);
  }, [targetWpm, reducedMotionSystem, fxMode, engine.rank]);

  const rankInfo = engine.rank ? RANK_STYLES[engine.rank] : null;
  const isNewPB =
    pbAttempt &&
    pbAttempt.id === engine.attemptId &&
    engine.remainingErrors === 0 &&
    (engine.accuracy ?? 0) >= 95;
  const elapsedSec = (engine.elapsedMs / 1000).toFixed(2);

  const language = useSettingsStore((s) => s.language);
  const mistakes = mistakeTargets(
    engine.targetGraphemes,
    engine.typedGraphemes
  );
  const dialogRef = useDialog(onClose);
  return (
    <dialog
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="result-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-md"
    >
      <div className="relative w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
        <div className="result-coach">
          <span className="eyebrow">BƯỚC TIẾP THEO</span>
          <p>
            {coachingTip(engine.accuracy, engine.remainingErrors, engine.wpm)}
          </p>
          {mistakes.length > 0 && (
            <small>
              Ký tự còn sai:{' '}
              {mistakes
                .map(
                  ([char, count]) =>
                    `${char === ' ' ? 'dấu cách' : char} (${count})`
                )
                .join(' · ')}
            </small>
          )}
        </div>
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
          <div>
            <h2
              id="result-modal-title"
              className="font-display text-xl font-bold text-slate-100"
            >
              Hoàn thành lượt luyện gõ
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Dữ liệu kết quả được khóa chính xác tại thời điểm hoàn tất ký tự
              cuối cùng.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng bảng kết quả"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100 cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Hero Row: Odometer WPM + Accuracy + Rank Stamp */}
        <div className="my-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
            <span className="text-xs font-medium text-slate-400">
              WPM Chính (Net)
            </span>
            <div
              data-testid="result-net-wpm"
              className="mt-1 font-mono text-4xl font-bold tracking-tight text-sky-400 tabular-nums"
            >
              {displayWpm}
            </div>
            <div className="mt-1 font-mono text-xs text-slate-400 tabular-nums">
              Gross WPM: {Math.round(engine.grossWpm)}
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
            <span className="text-xs font-medium text-slate-400">
              Độ chính xác (Accuracy)
            </span>
            <div
              data-testid="result-accuracy"
              className="mt-1 font-mono text-4xl font-bold tracking-tight text-emerald-400 tabular-nums"
            >
              {formatAccuracy(engine.accuracy)}
            </div>
            <div className="mt-1 font-mono text-xs text-slate-400 tabular-nums">
              Đúng {engine.correctInsertions} / {engine.insertedTotal} lần nhập
            </div>
          </div>

          <div className="flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-950/60 p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-400">
                Hạng đánh giá
              </span>
              {isNewPB && (
                <span className="flex items-center gap-1 font-mono text-xs font-semibold text-amber-300">
                  <Award className="h-3.5 w-3.5" />
                  Kỷ lục PB mới
                </span>
              )}
            </div>
            {rankInfo ? (
              <div className="mt-1">
                <div
                  data-testid="result-rank"
                  className={`inline-flex items-center rounded-lg border px-3 py-1 font-mono text-lg font-bold ${rankInfo.badge}`}
                >
                  {rankInfo.label}
                </div>
                <p className="mt-1.5 text-[11px] text-slate-400">
                  {rankInfo.thresholdText}
                </p>
              </div>
            ) : (
              <div className="mt-2 text-xs text-slate-400">
                Bài dưới 150 ký tự không xếp hạng Rank.
              </div>
            )}
          </div>
        </div>

        {/* Secondary Metrics Strip */}
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4 font-mono text-xs tabular-nums">
          <div className="rounded-lg border border-slate-800/80 bg-slate-950/40 px-3 py-2.5">
            <div className="text-slate-400">Thời gian thực</div>
            <div className="mt-0.5 text-sm font-semibold text-slate-100">
              {elapsedSec}s
            </div>
          </div>
          <div className="rounded-lg border border-slate-800/80 bg-slate-950/40 px-3 py-2.5">
            <div className="text-slate-400">Chuỗi Combo cao nhất</div>
            <div className="mt-0.5 text-sm font-semibold text-amber-300">
              {engine.maxCombo}
            </div>
          </div>
          <div className="rounded-lg border border-slate-800/80 bg-slate-950/40 px-3 py-2.5">
            <div className="text-slate-400">Ký tự khớp đích</div>
            <div className="mt-0.5 text-sm font-semibold text-slate-100">
              {engine.correctFinal} / {engine.targetGraphemes.length}
            </div>
          </div>
          <div className="rounded-lg border border-slate-800/80 bg-slate-950/40 px-3 py-2.5">
            <div className="text-slate-400">Lỗi chưa sửa</div>
            <div
              className={`mt-0.5 text-sm font-semibold ${
                engine.remainingErrors > 0
                  ? 'text-rose-400'
                  : 'text-emerald-400'
              }`}
            >
              {engine.remainingErrors}
            </div>
          </div>
        </div>

        {/* Real-time WPM Chart */}
        <WpmTimelineChart samples={engine.samples} />

        {/* Honest Database Persistence Status */}
        <div className="mt-4 flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/50 px-3.5 py-2 text-xs">
          {saveStatus === 'saved' && (
            <div className="flex items-center gap-2 text-emerald-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>
                Đã lưu kết quả và Ghost Replay vào Lịch sử trình duyệt.
              </span>
            </div>
          )}
          {saveStatus === 'saving' && (
            <div className="flex items-center gap-2 text-slate-300">
              <RefreshCw className="h-4 w-4 animate-spin shrink-0" />
              <span>Đang lưu kết quả vào cơ sở dữ liệu...</span>
            </div>
          )}
          {saveStatus === 'error' && (
            <div className="flex flex-wrap items-center justify-between gap-3 w-full text-amber-300">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
                <span>
                  {saveErrorMessage ||
                    'Chưa lưu được kết quả trên thiết bị này.'}
                </span>
              </div>
              <button
                type="button"
                onClick={retrySaveCurrentAttempt}
                className="rounded-md border border-amber-400/50 bg-amber-950/60 px-2.5 py-1 font-medium text-amber-200 hover:bg-amber-900/60 cursor-pointer"
              >
                Thử lưu lại
              </button>
            </div>
          )}
        </div>

        <button
          type="button"
          className="share-result mt-4"
          onClick={() =>
            downloadResultCard(engine.wpm, engine.accuracy ?? 0, language)
          }
        >
          Tải thẻ kết quả ↗
        </button>
        {/* Footer Actions */}
        <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenHistory();
            }}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-4 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <History className="h-3.5 w-3.5" />
            <span>Xem Lịch sử</span>
          </button>

          <button
            type="button"
            onClick={() => {
              onClose();
              onGenerateAI();
            }}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-4 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>Tạo bài AI mới</span>
          </button>

          <button
            ref={retryButtonRef}
            type="button"
            onClick={onRetry}
            className="flex items-center gap-1.5 rounded-lg bg-sky-500 px-5 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Gõ lại cùng Ghost (0s)</span>
          </button>
        </div>
      </div>
    </dialog>
  );
}
