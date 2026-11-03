'use client';

import React from 'react';
import {
  History,
  RotateCcw,
  Settings,
  Sparkles,
  Volume2,
  VolumeX,
  XCircle,
  Zap,
  Leaf,
} from 'lucide-react';
import { Language, LENGTH_BOUNDS, PassageLength, Topic } from '../../utils/text';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useTypingStore } from '../../store/useTypingStore';

interface HeaderBarProps {
  onOpenHistory: () => void;
  onOpenSettings: () => void;
  onRequestGenerateAI: () => void;
  onRequestSampleChange: (lang: Language, topic: Topic, length: PassageLength) => void;
}

export default function HeaderBar({
  onOpenHistory,
  onOpenSettings,
  onRequestGenerateAI,
  onRequestSampleChange,
}: HeaderBarProps) {
  const {
    fxMode,
    soundEnabled,
    language,
    topic,
    length,
    setFxMode,
    setSoundEnabled,
  } = useSettingsStore();

  const {
    passages,
    aiGenerating,
    cooldownRemainingMs,
    cooldownTotalMs,
    overheatShakeSeq,
    cancelAiGeneration,
    retryCurrentPassage,
  } = useTypingStore();

  const cooldownSec = Math.ceil(cooldownRemainingMs / 1000);
  const progressRatio =
    cooldownTotalMs > 0
      ? Math.min(1, Math.max(0, 1 - cooldownRemainingMs / cooldownTotalMs))
      : 1;
  const waveFillPercent = Math.round(progressRatio * 100);

  return (
    <div className="w-full border-b border-slate-800/80 bg-slate-950/90 backdrop-blur-md">
      {/* Top Bar Contract: 3 Clean Zones separated by gap-8 */}
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-8 px-6 py-3.5">
        {/* Zone 1: Single text element Brand wordmark */}
        <a
          href="#studio"
          className="font-display text-lg font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0"
        >
          AuraType AI
        </a>

        {/* Zone 2: Clean single-line text navigation links */}
        <nav aria-label="Điều hướng chính" className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-400">
          <button
            type="button"
            onClick={() => onRequestSampleChange(language, topic, length)}
            className="hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Bài mẫu
          </button>
          <button
            type="button"
            onClick={retryCurrentPassage}
            className="hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Gõ lại bài
          </button>
          <button
            type="button"
            onClick={onOpenHistory}
            className="hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Lịch sử ({passages.length})
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            className="hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Cài đặt
          </button>
        </nav>

        {/* Zone 3: 1 Primary Action (Generate AI Text with Liquid Wave Cooldown or Cancel) */}
        <div className="flex items-center gap-3 shrink-0">
          {aiGenerating ? (
            <button
              type="button"
              onClick={cancelAiGeneration}
              className="relative flex items-center gap-2 rounded-lg border border-amber-500/50 bg-amber-950/50 px-4 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-900/60 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <XCircle className="h-3.5 w-3.5 animate-spin" />
              <span>Đang tạo bài AI... (Hủy)</span>
            </button>
          ) : (
            <button
              key={overheatShakeSeq}
              type="button"
              onClick={onRequestGenerateAI}
              aria-label={
                cooldownRemainingMs > 0
                  ? `Tạo bài AI đang hồi năng lượng còn ${cooldownSec} giây`
                  : 'Tạo bài AI'
              }
              className={`relative overflow-hidden rounded-lg px-4 py-2 text-xs font-semibold transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                cooldownRemainingMs > 0
                  ? 'border border-rose-500/50 bg-slate-900 text-slate-200 animate-[shake_0.35s_ease-in-out]'
                  : 'border border-sky-400/40 bg-sky-500 text-slate-950 hover:bg-sky-400 shadow-sm'
              }`}
            >
              {/* Liquid Wave SVG Fill during 30s Cooldown */}
              {cooldownRemainingMs > 0 && (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 bottom-0 bg-sky-500/25 transition-all duration-300"
                  style={{ height: `${waveFillPercent}%` }}
                >
                  <svg
                    className="absolute -top-2 left-0 h-2.5 w-full fill-sky-400/30"
                    viewBox="0 0 120 10"
                    preserveAspectRatio="none"
                  >
                    <path d="M0 5 Q 30 0, 60 5 T 120 5 L 120 10 L 0 10 Z" />
                  </svg>
                </span>
              )}

              <span className="relative z-10 flex items-center gap-1.5 font-mono tabular-nums">
                <Sparkles className="h-3.5 w-3.5" />
                {cooldownRemainingMs > 0 ? (
                  <span>Hồi chiêu AI · {cooldownSec}s</span>
                ) : (
                  <span>Tạo bài AI</span>
                )}
              </span>
            </button>
          )}
        </div>
      </header>

      {/* Secondary Workspace Toolbar: Language, Topic, Length, Non-Blocking FX Selector & Quick Tools */}
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 border-t border-slate-900 px-6 py-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          {/* Language Segmented Control */}
          <div
            role="group"
            aria-label="Chọn ngôn ngữ"
            className="flex items-center rounded-lg bg-slate-900 p-0.5 border border-slate-800"
          >
            <button
              type="button"
              onClick={() => onRequestSampleChange('vi', topic, length)}
              className={`rounded-md px-2.5 py-1 font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                language === 'vi'
                  ? 'bg-slate-800 text-sky-300 shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Tiếng Việt
            </button>
            <button
              type="button"
              onClick={() => onRequestSampleChange('en', topic, length)}
              className={`rounded-md px-2.5 py-1 font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                language === 'en'
                  ? 'bg-slate-800 text-sky-300 shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              English
            </button>
          </div>

          {/* Topic Segmented Control */}
          <div
            role="group"
            aria-label="Chọn chủ đề"
            className="flex items-center rounded-lg bg-slate-900 p-0.5 border border-slate-800"
          >
            {(
              [
                { id: 'philosophy', label: 'Triết học' },
                { id: 'code', label: 'Code' },
                { id: 'scifi', label: 'Sci-Fi' },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onRequestSampleChange(language, item.id, length)}
                className={`rounded-md px-2.5 py-1 font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  topic === item.id
                    ? 'bg-slate-800 text-sky-300 shadow-xs'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {/* Length Segmented Control */}
          <div
            role="group"
            aria-label="Chọn độ dài bài"
            className="flex items-center rounded-lg bg-slate-900 p-0.5 border border-slate-800"
          >
            {(
              [
                { id: 'short', label: 'Ngắn' },
                { id: 'medium', label: 'Vừa' },
                { id: 'long', label: 'Dài' },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                title={LENGTH_BOUNDS[item.id].label}
                onClick={() => onRequestSampleChange(language, topic, item.id)}
                className={`rounded-md px-2.5 py-1 font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  length === item.id
                    ? 'bg-slate-800 text-sky-300 shadow-xs'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* Right Controls: Non-Blocking FX Selector (Lite vs Ultra Juice), Sound, Retry */}
        <div className="flex items-center gap-2">
          {/* Non-blocking FX Mode Selector (Section 6: replaces blocking Performance Gate) */}
          <div
            role="group"
            aria-label="Chế độ hiệu ứng FX"
            className="flex items-center rounded-lg bg-slate-900 p-0.5 border border-slate-800"
          >
            <button
              type="button"
              onClick={() => setFxMode('lite')}
              className={`flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                fxMode === 'lite'
                  ? 'bg-slate-800 text-emerald-300 shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Leaf className="h-3.5 w-3.5" />
              <span>Zen / Lite</span>
            </button>
            <button
              type="button"
              onClick={() => setFxMode('ultra')}
              className={`flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                fxMode === 'ultra'
                  ? 'bg-slate-800 text-amber-300 shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Zap className="h-3.5 w-3.5" />
              <span>Ultra Juice</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => setSoundEnabled(!soundEnabled)}
            aria-label={soundEnabled ? 'Tắt âm thanh bàn phím' : 'Bật âm thanh bàn phím'}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              soundEnabled
                ? 'border-sky-500/40 bg-sky-950/40 text-sky-300'
                : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
            }`}
          >
            {soundEnabled ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">{soundEnabled ? 'Âm: Bật' : 'Âm: Tắt'}</span>
          </button>

          <button
            type="button"
            onClick={retryCurrentPassage}
            aria-label="Gõ lại bài hiện tại (0 giây hồi chiêu)"
            className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1 font-medium text-slate-300 hover:border-slate-700 hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Gõ lại (0s)</span>
          </button>

          <button
            type="button"
            onClick={onOpenHistory}
            aria-label="Mở ngăn kéo lịch sử"
            className="flex md:hidden items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1 font-medium text-slate-300 hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <History className="h-3.5 w-3.5" />
            <span>Lịch sử</span>
          </button>

          <button
            type="button"
            onClick={onOpenSettings}
            aria-label="Mở bảng cài đặt (Esc)"
            className="flex md:hidden items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1 font-medium text-slate-300 hover:border-slate-700 hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Settings className="h-3.5 w-3.5" />
            <span>Cài đặt</span>
          </button>
        </div>
      </div>
    </div>
  );
}
