'use client';

import React from 'react';

export interface CaretVisualPosition {
  x: number;
  y: number;
  height: number;
  lineChanged: boolean;
}

interface CaretProps {
  userPos: CaretVisualPosition;
  ghostPos: CaretVisualPosition | null;
  wpm: number;
  isRunning: boolean;
  cometTrailEnabled: boolean;
  fxMode: 'lite' | 'ultra';
  reducedMotion: boolean;
}

/**
 * Determines Comet Caret color tier based on live WPM (Module 3):
 * Cyan/Sky (< 50 WPM) -> Violet/Purple (50-85 WPM) -> Neon Gold (>= 85 WPM)
 */
function getCometStyle(wpm: number): {
  barClass: string;
  trailClass: string;
} {
  if (wpm >= 85) {
    return {
      barClass: 'bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.85)]',
      trailClass: 'from-amber-400/45 to-transparent',
    };
  }
  if (wpm >= 50) {
    return {
      barClass: 'bg-violet-400 shadow-[0_0_12px_rgba(167,139,250,0.8)]',
      trailClass: 'from-violet-400/40 to-transparent',
    };
  }
  return {
    barClass: 'bg-sky-400 shadow-[0_0_10px_rgba(56,189,248,0.75)]',
    trailClass: 'from-sky-400/35 to-transparent',
  };
}

export default function Caret({
  userPos,
  ghostPos,
  wpm,
  isRunning,
  cometTrailEnabled,
  fxMode,
  reducedMotion,
}: CaretProps) {
  const { barClass, trailClass } = getCometStyle(wpm);
  // Section 11: Disable transition when wrapping across lines or in reduced motion so caret never lags
  const shouldAnimateMove = !reducedMotion && !userPos.lineChanged;

  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden" aria-hidden="true">
      {/* Ghost Caret (PB Replay) */}
      {ghostPos && (
        <div
          data-testid="ghost-caret"
          className={`absolute top-0 left-0 will-change-transform ${
            !reducedMotion && !ghostPos.lineChanged
              ? 'transition-transform duration-75 ease-out'
              : ''
          }`}
          style={{
            transform: `translate3d(${ghostPos.x}px, ${ghostPos.y}px, 0)`,
            height: `${ghostPos.height}px`,
          }}
        >
          <div className="h-full w-[2.5px] rounded-full bg-teal-400/55 border border-teal-300/40" />
          <span className="absolute -top-4 left-0 -translate-x-1/4 rounded bg-slate-900/90 px-1 py-0.5 font-mono text-[9px] font-semibold tracking-tight text-teal-300 border border-teal-500/30 whitespace-nowrap">
            PB
          </span>
        </div>
      )}

      {/* User Comet Caret */}
      <div
        data-testid="user-caret"
        className={`absolute top-0 left-0 will-change-transform ${
          shouldAnimateMove ? 'transition-transform duration-75 ease-out' : ''
        }`}
        style={{
          transform: `translate3d(${userPos.x}px, ${userPos.y}px, 0)`,
          height: `${userPos.height}px`,
        }}
      >
        {/* Optional Comet Trail */}
        {cometTrailEnabled && fxMode === 'ultra' && isRunning && !reducedMotion && (
          <div
            className={`absolute top-1 right-0 h-[calc(100%-8px)] w-6 bg-gradient-to-l ${trailClass} rounded-l-full pointer-events-none`}
          />
        )}
        <div
          className={`h-full w-[2.5px] rounded-full ${barClass} ${
            !isRunning && !reducedMotion ? 'animate-pulse' : ''
          }`}
        />
      </div>
    </div>
  );
}
