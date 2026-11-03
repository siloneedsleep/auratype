import { normalizeNFC, splitGraphemes } from '../utils/text';
import { countGraphemesForWordDelete } from './typingEngine';

export type AdapterAction =
  | { type: 'noop' }
  | { type: 'blocked'; reason: string }
  | { type: 'composition_start' }
  | { type: 'composition_update'; text: string }
  | { type: 'composition_cancel' }
  | { type: 'commit'; graphemes: string[] }
  | { type: 'delete'; count: number };

const BLOCKED_INPUT_TYPES = new Set([
  'insertFromPaste',
  'insertFromPasteAsQuotation',
  'insertFromDrop',
  'insertFromYank',
  'insertReplacementText',
  'insertTranspose',
  'historyUndo',
  'historyRedo',
]);

/**
 * Evaluates a `beforeinput` event to block paste, drop, autofill, and history undo/redo.
 */
export function evaluateBeforeInput(
  inputType: string | undefined,
  isComposing: boolean,
  data: string | null | undefined
): { shouldPreventDefault: boolean; action: AdapterAction } {
  if (!inputType) {
    return { shouldPreventDefault: false, action: { type: 'noop' } };
  }

  if (BLOCKED_INPUT_TYPES.has(inputType)) {
    return {
      shouldPreventDefault: true,
      action: {
        type: 'blocked',
        reason: 'Không hỗ trợ dán (paste), kéo thả hoặc tự động điền khi đang luyện gõ.',
      },
    };
  }

  // Block multi-character non-composing insertText (e.g. browser autofill or clipboard injection)
  if (!isComposing && inputType === 'insertText' && typeof data === 'string') {
    const graphemes = splitGraphemes(data);
    if (graphemes.length > 1) {
      return {
        shouldPreventDefault: true,
        action: {
          type: 'blocked',
          reason: 'Đã chặn chèn hàng loạt ký tự ngoài bộ gõ IME.',
        },
      };
    }
  }

  if (!isComposing && (inputType === 'insertLineBreak' || inputType === 'insertParagraph')) {
    return {
      shouldPreventDefault: true,
      action: { type: 'noop' },
    };
  }

  return { shouldPreventDefault: false, action: { type: 'noop' } };
}

/**
 * Reconciles the current textarea value against the engine's committed graphemes.
 * Ensures that:
 * 1. During active composition (`isComposing`), only the uncommitted suffix is previewed.
 * 2. When not composing, new graphemes are committed, or deletions at the end are processed.
 * 3. Duplicate `input` right after `compositionend` with identical committed text produces `noop`.
 */
export function reconcileInputDiff(params: {
  committedGraphemes: string[];
  rawTextareaValue: string;
  inputType?: string;
  isComposing: boolean;
  justEndedCompositionText?: string | null;
}): AdapterAction {
  const {
    committedGraphemes,
    rawTextareaValue,
    inputType,
    isComposing,
    justEndedCompositionText,
  } = params;

  const committedString = normalizeNFC(committedGraphemes.join(''));
  const currentNormalized = normalizeNFC(rawTextareaValue.replace(/[\r\n\t]/g, ''));

  // Handle explicit word deletion
  if (!isComposing && inputType === 'deleteWordBackward') {
    const count = countGraphemesForWordDelete(committedGraphemes);
    return count > 0 ? { type: 'delete', count } : { type: 'noop' };
  }

  // During active IME composition, extract the preview suffix
  if (isComposing) {
    if (currentNormalized.startsWith(committedString)) {
      const preview = currentNormalized.slice(committedString.length);
      return { type: 'composition_update', text: preview };
    }
    const currentGraphemes = splitGraphemes(currentNormalized);
    const previewGraphemes = currentGraphemes.slice(committedGraphemes.length);
    return { type: 'composition_update', text: previewGraphemes.join('') };
  }

  // Deduplicate immediate input event after compositionend if value already matches committed
  if (currentNormalized === committedString) {
    return { type: 'noop' };
  }

  if (
    justEndedCompositionText &&
    currentNormalized === normalizeNFC(committedString + justEndedCompositionText)
  ) {
    // Already handled by compositionend
    return { type: 'noop' };
  }

  const currentGraphemes = splitGraphemes(currentNormalized);

  // Check if prefix matches committedGraphemes
  let commonPrefixLen = 0;
  const minLen = Math.min(committedGraphemes.length, currentGraphemes.length);
  while (
    commonPrefixLen < minLen &&
    committedGraphemes[commonPrefixLen] === currentGraphemes[commonPrefixLen]
  ) {
    commonPrefixLen++;
  }

  // Case 1: Pure deletion from the end
  if (
    currentGraphemes.length < committedGraphemes.length &&
    commonPrefixLen === currentGraphemes.length
  ) {
    const deleteCount = committedGraphemes.length - currentGraphemes.length;
    return { type: 'delete', count: deleteCount };
  }

  // Case 2: Appending at the end
  if (
    currentGraphemes.length > committedGraphemes.length &&
    commonPrefixLen === committedGraphemes.length
  ) {
    const added = currentGraphemes.slice(committedGraphemes.length);
    // Guard against unexpected bulk paste (> 1 grapheme when not from composition)
    if (
      added.length > 1 &&
      inputType !== 'insertCompositionText' &&
      inputType !== 'insertFromComposition'
    ) {
      return {
        type: 'blocked',
        reason: 'Đã chặn thay thế hoặc dán nhiều ký tự cùng lúc.',
      };
    }
    return { type: 'commit', graphemes: added };
  }

  // Case 3: Mid-string edit or bulk replacement attempt outside composition -> block and restore
  return {
    type: 'blocked',
    reason: 'Chỉ cho phép nhập và xóa ở vị trí cuối chuỗi.',
  };
}

/**
 * Processes `compositionend` data and returns the AdapterAction.
 */
export function resolveCompositionEnd(
  committedGraphemes: string[],
  compositionData: string | null | undefined,
  rawTextareaValue: string
): { action: AdapterAction; committedSuffix: string } {
  const committedString = normalizeNFC(committedGraphemes.join(''));
  const normalizedValue = normalizeNFC(rawTextareaValue.replace(/[\r\n\t]/g, ''));

  let suffix = '';
  if (typeof compositionData === 'string' && compositionData.length > 0) {
    suffix = normalizeNFC(compositionData.replace(/[\r\n\t]/g, ''));
  } else if (normalizedValue.startsWith(committedString)) {
    suffix = normalizedValue.slice(committedString.length);
  }

  const graphemes = splitGraphemes(suffix);
  if (graphemes.length === 0) {
    return { action: { type: 'composition_cancel' }, committedSuffix: '' };
  }

  return {
    action: { type: 'commit', graphemes },
    committedSuffix: suffix,
  };
}
