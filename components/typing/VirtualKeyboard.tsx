'use client';

import React from 'react';

interface KeyDef {
  id: string;
  label: string;
  widthClass?: string;
}

const KEYBOARD_ROWS: KeyDef[][] = [
  [
    { id: '`', label: '`' },
    { id: '1', label: '1' },
    { id: '2', label: '2' },
    { id: '3', label: '3' },
    { id: '4', label: '4' },
    { id: '5', label: '5' },
    { id: '6', label: '6' },
    { id: '7', label: '7' },
    { id: '8', label: '8' },
    { id: '9', label: '9' },
    { id: '0', label: '0' },
    { id: '-', label: '-' },
    { id: '=', label: '=' },
    { id: 'Backspace', label: '⌫', widthClass: 'w-16 sm:w-20' },
  ],
  [
    { id: 'q', label: 'Q' },
    { id: 'w', label: 'W' },
    { id: 'e', label: 'E' },
    { id: 'r', label: 'R' },
    { id: 't', label: 'T' },
    { id: 'y', label: 'Y' },
    { id: 'u', label: 'U' },
    { id: 'i', label: 'I' },
    { id: 'o', label: 'O' },
    { id: 'p', label: 'P' },
    { id: '[', label: '[' },
    { id: ']', label: ']' },
    { id: '\\', label: '\\' },
  ],
  [
    { id: 'a', label: 'A' },
    { id: 's', label: 'S' },
    { id: 'd', label: 'D' },
    { id: 'f', label: 'F' },
    { id: 'g', label: 'G' },
    { id: 'h', label: 'H' },
    { id: 'j', label: 'J' },
    { id: 'k', label: 'K' },
    { id: 'l', label: 'L' },
    { id: ';', label: ';' },
    { id: "'", label: "'" },
  ],
  [
    { id: 'z', label: 'Z' },
    { id: 'x', label: 'X' },
    { id: 'c', label: 'C' },
    { id: 'v', label: 'V' },
    { id: 'b', label: 'B' },
    { id: 'n', label: 'N' },
    { id: 'm', label: 'M' },
    { id: ',', label: ',' },
    { id: '.', label: '.' },
    { id: '/', label: '/' },
  ],
  [{ id: ' ', label: 'SPACE', widthClass: 'w-56 sm:w-72' }],
];

/**
 * Strips Vietnamese diacritics to find the primary base Latin key on a standard QWERTY layout.
 */
function normalizeExpectedKey(grapheme: string | undefined): string | null {
  if (!grapheme) return null;
  if (grapheme === ' ') return ' ';
  const lower = grapheme.toLowerCase();
  if (lower === 'đ') return 'd';
  const base = lower.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const shiftMap: Record<string, string> = {
    '!': '1',
    '@': '2',
    '#': '3',
    $: '4',
    '%': '5',
    '^': '6',
    '&': '7',
    '*': '8',
    '(': '9',
    ')': '0',
    _: '-',
    '+': '=',
    '{': '[',
    '}': ']',
    '|': '\\',
    ':': ';',
    '"': "'",
    '<': ',',
    '>': '.',
    '?': '/',
    '~': '`',
  };
  return shiftMap[base] || base;
}

interface VirtualKeyboardProps {
  expectedGrapheme: string | undefined;
  lastKeyPressed: string | null;
  lastOutcome: 'none' | 'correct' | 'error' | 'delete';
}

export default function VirtualKeyboard({
  expectedGrapheme,
  lastKeyPressed,
  lastOutcome,
}: VirtualKeyboardProps) {
  const targetKey = normalizeExpectedKey(expectedGrapheme);
  const pressedKey =
    lastKeyPressed === 'Backspace'
      ? 'Backspace'
      : lastKeyPressed
      ? normalizeExpectedKey(lastKeyPressed)
      : null;

  return (
    <div
      aria-hidden="true"
      className="hidden md:flex flex-col items-center gap-1.5 select-none rounded-xl border border-slate-800/80 bg-slate-900/60 p-3.5"
    >
      {KEYBOARD_ROWS.map((row, rIdx) => (
        <div key={rIdx} className="flex items-center justify-center gap-1.5">
          {row.map((keyDef) => {
            const isTarget = targetKey === keyDef.id;
            const isPressed = pressedKey === keyDef.id;
            const isErrorPress = isPressed && lastOutcome === 'error';

            let keyStyle =
              'bg-slate-800/90 text-slate-300 border-slate-700/80 shadow-[0_3px_0_0_rgba(15,23,42,0.95)]';
            if (isErrorPress) {
              keyStyle =
                'bg-rose-950/90 text-rose-200 border-rose-500/80 translate-y-[2px] shadow-none';
            } else if (isPressed) {
              keyStyle =
                'bg-sky-500/30 text-sky-100 border-sky-400 translate-y-[2px] shadow-none';
            } else if (isTarget) {
              keyStyle =
                'bg-slate-800 text-sky-300 border-sky-500/60 shadow-[0_3px_0_0_rgba(14,116,144,0.65)]';
            }

            return (
              <div
                key={keyDef.id}
                className={`relative flex h-9 items-center justify-center rounded-lg border font-mono text-xs font-medium transition-transform duration-75 ${
                  keyDef.widthClass || 'w-9 sm:w-10'
                } ${keyStyle}`}
              >
                <span>{keyDef.label}</span>
                {(keyDef.id === 'f' || keyDef.id === 'j') && (
                  <span className="absolute bottom-1 h-0.5 w-2.5 rounded-full bg-slate-500" />
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
