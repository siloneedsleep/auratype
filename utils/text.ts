export type Language = 'en' | 'vi';
export type Topic = 'code' | 'philosophy' | 'scifi';
export type PassageLength = 'short' | 'medium' | 'long';

export const LENGTH_BOUNDS: Record<PassageLength, { min: number; max: number; label: string }> = {
  short: { min: 150, max: 300, label: 'Short (150–300)' },
  medium: { min: 400, max: 700, label: 'Medium (400–700)' },
  long: { min: 900, max: 1400, label: 'Long (900–1400)' },
};

const sharedSegmenter =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter !== 'undefined'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

/**
 * Normalizes a string to Unicode NFC form.
 */
export function normalizeNFC(input: string): string {
  if (!input) return '';
  return input.normalize('NFC');
}

/**
 * Splits a string into user-perceived characters (grapheme clusters) after NFC normalization.
 */
export function splitGraphemes(input: string): string[] {
  const normalized = normalizeNFC(input);
  if (!normalized) return [];
  if (sharedSegmenter) {
    const segments = sharedSegmenter.segment(normalized);
    const result: string[] = [];
    for (const seg of segments) {
      result.push(seg.segment);
    }
    return result;
  }
  return Array.from(normalized);
}

/**
 * Counts graphemes in NFC-normalized string.
 */
export function countGraphemes(input: string): number {
  return splitGraphemes(input).length;
}

/**
 * Normalizes spaces to standard U+0020 single spaces and trims ends.
 * Does NOT strip newlines or control chars silently during validation if we want to detect them,
 * so we provide a dedicated sanitizer for raw text before validation.
 */
export function normalizeSpaces(input: string): string {
  return normalizeNFC(input)
    .replace(/\u00A0/g, ' ')
    .replace(/ +/g, ' ')
    .trim();
}

export interface TextValidationResult {
  valid: boolean;
  reason?: string;
  normalizedText: string;
  graphemeCount: number;
}

const CONTROL_CHAR_REGEX = /[\u0000-\u001F\u007F-\u009F]/;
const ZERO_WIDTH_REGEX = /[\u200B-\u200D\u2060\uFEFF]/;
const EMOJI_REGEX = /\p{Extended_Pictographic}/u;

/**
 * Strictly validates passage content according to Section 7.2 & 10.2:
 * - Unicode NFC normalized
 * - Only standard space U+0020 (no tabs, newlines, control chars, zero-width chars, or emojis)
 * - Grapheme count within target bounds (or minimum 150 graphemes if general check)
 */
export function validatePassageText(
  rawText: string,
  lengthTarget?: PassageLength
): TextValidationResult {
  if (typeof rawText !== 'string') {
    return { valid: false, reason: 'Nội dung không phải chuỗi hợp lệ.', normalizedText: '', graphemeCount: 0 };
  }

  const nfc = normalizeNFC(rawText.trim());
  if (!nfc) {
    return { valid: false, reason: 'Nội dung trống.', normalizedText: '', graphemeCount: 0 };
  }

  if (/[\r\n\t]/.test(nfc)) {
    return {
      valid: false,
      reason: 'Nội dung không được chứa ký tự xuống dòng hoặc tab.',
      normalizedText: nfc,
      graphemeCount: 0,
    };
  }

  if (CONTROL_CHAR_REGEX.test(nfc)) {
    return {
      valid: false,
      reason: 'Nội dung chứa ký tự điều khiển không hợp lệ.',
      normalizedText: nfc,
      graphemeCount: 0,
    };
  }

  if (ZERO_WIDTH_REGEX.test(nfc)) {
    return {
      valid: false,
      reason: 'Nội dung chứa ký tự độ rộng bằng 0 (zero-width).',
      normalizedText: nfc,
      graphemeCount: 0,
    };
  }

  if (EMOJI_REGEX.test(nfc)) {
    return {
      valid: false,
      reason: 'Nội dung không được chứa biểu tượng cảm xúc (emoji).',
      normalizedText: nfc,
      graphemeCount: 0,
    };
  }

  const normalizedText = normalizeSpaces(nfc);
  const graphemes = splitGraphemes(normalizedText);
  const graphemeCount = graphemes.length;

  if (lengthTarget) {
    const bounds = LENGTH_BOUNDS[lengthTarget];
    if (graphemeCount < bounds.min || graphemeCount > bounds.max) {
      return {
        valid: false,
        reason: `Độ dài bài (${graphemeCount} ký tự) nằm ngoài khoảng yêu cầu (${bounds.min}–${bounds.max} ký tự).`,
        normalizedText,
        graphemeCount,
      };
    }
  } else if (graphemeCount < 1) {
    return {
      valid: false,
      reason: 'Nội dung quá ngắn.',
      normalizedText,
      graphemeCount,
    };
  }

  return {
    valid: true,
    normalizedText,
    graphemeCount,
  };
}

/**
 * Computes a deterministic contentHash from language + NFC normalized text.
 */
export function computeContentHash(content: string, language: Language): string {
  const normalized = `${language}:${normalizeSpaces(content)}`;
  let h1 = 0xdeadbeef ^ normalized.length;
  let h2 = 0x41c6ce57 ^ normalized.length;
  for (let i = 0, ch: number; i < normalized.length; i++) {
    ch = normalized.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `h_${(h2 >>> 0).toString(16).padStart(8, '0')}${(h1 >>> 0).toString(16).padStart(8, '0')}`;
}

export interface SamplePassageDef {
  id: string;
  language: Language;
  topic: Topic;
  length: PassageLength;
  content: string;
}

export const SAMPLE_PASSAGES: SamplePassageDef[] = [
  // Vietnamese - Short (150-300 graphemes)
  {
    id: 'sample-vi-philosophy-short',
    language: 'vi',
    topic: 'philosophy',
    length: 'short',
    content:
      'Sự tĩnh lặng của tâm trí không phải là sự vắng mặt của suy nghĩ, mà là khả năng quan sát mọi chuyển động của ý thức mà không bị cuốn theo. Khi đôi tay gõ từng nhịp đều đặn, hơi thở và sự tập trung hòa làm một trong từng khoảnh khắc hiện tại.',
  },
  {
    id: 'sample-vi-code-short',
    language: 'vi',
    topic: 'code',
    length: 'short',
    content:
      'const computeVelocity = (chars: number, elapsedMs: number): number => { if (elapsedMs <= 0) return 0; const minutes = elapsedMs / 60000; return (chars / 5) / minutes; }; // Hàm thuần giúp kết quả luôn nhất quán và dễ kiểm thử.',
  },
  {
    id: 'sample-vi-scifi-short',
    language: 'vi',
    topic: 'scifi',
    length: 'short',
    content:
      'Trạm quan sát quỹ đạo Hải Vương Tinh nhận được tín hiệu ánh sáng phát ra từ vành đai băng giá. Từng xung nhịp quang học mang theo bản đồ dẫn đường cổ xưa, mở ra hành trình vượt qua ranh giới của hệ Mặt Trời trong thế kỷ hai mươi ba.',
  },
  // English - Short (150-300 graphemes)
  {
    id: 'sample-en-philosophy-short',
    language: 'en',
    topic: 'philosophy',
    length: 'short',
    content:
      'Clarity of thought emerges when attention rests deliberately on a single task. Each keystroke becomes a quiet measure of rhythm and discipline, transforming fleeting intention into lucid expression without haste or distraction.',
  },
  {
    id: 'sample-en-code-short',
    language: 'en',
    topic: 'code',
    length: 'short',
    content:
      'export function clampMetric(value: number, min: number, max: number): number { if (!Number.isFinite(value)) return min; return Math.min(max, Math.max(min, value)); } // Pure functions guarantee deterministic state transitions.',
  },
  {
    id: 'sample-en-scifi-short',
    language: 'en',
    topic: 'scifi',
    length: 'short',
    content:
      'Beyond the obsidian rings of Kepler station, deep-space telemetry arrays hummed in quiet synchrony. Navigators traced luminous starlanes across the holographic helm, preparing the vessel for its jump through the outer nebula.',
  },
  // Vietnamese - Medium (400-700 graphemes)
  {
    id: 'sample-vi-philosophy-medium',
    language: 'vi',
    topic: 'philosophy',
    length: 'medium',
    content:
      'Nghệ thuật rèn luyện kỹ năng luôn bắt đầu từ những chuyển động nhỏ nhặt nhưng chuẩn xác nhất. Người thợ thủ công không vội vã tìm kiếm tốc độ ngay từ giây phút khởi đầu; họ lắng nghe độ nảy của từng phím, cảm nhận nhịp điệu tự nhiên của các ngón tay và giữ cho tâm trí không xao động trước một lỗi sai nhỏ. Khi sự chính xác đã trở thành phản xạ tự nhiên, tốc độ sẽ tự khắc xuất hiện như dòng nước chảy qua khe đá, mềm mại nhưng bền bỉ và không hề gượng ép.',
  },
  // English - Medium (400-700 graphemes)
  {
    id: 'sample-en-philosophy-medium',
    language: 'en',
    topic: 'philosophy',
    length: 'medium',
    content:
      'Mastery in any craft rarely arrives through sudden leaps of effort; instead, it accumulates quietly through deliberate, attentive repetition. When a musician practices a complex passage, speed is treated as a byproduct of precision rather than a goal pursued by force. By observing every movement with calm awareness and releasing tension after each mistake, the mind builds a resilient rhythm that endures under pressure and turns practice into effortless flow.',
  },
  // Vietnamese - Long (900-1400 graphemes)
  {
    id: 'sample-vi-scifi-long',
    language: 'vi',
    topic: 'scifi',
    length: 'long',
    content:
      'Vào năm hai nghìn một trăm tám mươi tư, thư viện lưu trữ ký ức nhân loại được đặt sâu bên dưới lớp băng vĩnh cửu của vệ tinh Europa. Tại đây, các kỹ sư ngôn ngữ học làm việc cùng những hệ thống tính toán lượng tử để bảo tồn từng phương ngữ, từng câu chuyện cổ tích và từng dòng mã nguồn đã định hình nền văn minh Trái Đất. Mỗi buổi sáng theo giờ chuẩn trạm, kỹ thuật viên trưởng Minh Khôi đều khởi động bàn phím cơ học cổ điển của mình, nhập từng chuỗi lệnh kiểm tra tính toàn vẹn dữ liệu. Anh tin rằng giao tiếp giữa con người và máy móc không chỉ là việc truyền tải các bit nhị phân vô hồn, mà còn là sự nối dài của ý chí và trí tưởng tượng qua từng nhịp gõ phím. Bên ngoài lớp kính chịu lực dày ba mét, đại dương ngầm tối thẫm vẫn âm thầm chuyển động dưới lực hấp dẫn khổng lồ của sao Mộc, phát ra những dải sóng âm trầm hùng như bản giao hưởng vĩnh cửu của vũ trụ bao la, nhắc nhở mọi người rằng tri thức chỉ thực sự sống động khi được con người trân trọng và tiếp nối mỗi ngày.',
  },
  // English - Long (900-1400 graphemes)
  {
    id: 'sample-en-scifi-long',
    language: 'en',
    topic: 'scifi',
    length: 'long',
    content:
      'High above the copper clouds of Titan, the Meridian Archive orbited in silent equilibrium, preserving centuries of scientific treatises, musical scores, and foundational software architecture inside crystalline optical vaults. Every cycle, chief archivist Elena Vance sat before her tactile console to verify the linguistic calibration streams that connected twelve outposts across the outer system. While automated relays handled bulk transmission, the delicate semantic verification required human judgment and steady concentration. Each sentence she transcribed calibrated the neural decoders against subtle drift, ensuring that poetry and technical specifications alike arrived with unblemished fidelity. Through the observation cupola, Saturn cast a pale golden arc across the dark horizon, reminding the crew that across millions of kilometers of vacuum, precise language remained humanitys most reliable bridge between isolated worlds and shared discovery.',
  },
];

export function getSamplePassage(
  language: Language,
  topic: Topic,
  length: PassageLength
): SamplePassageDef {
  const exact = SAMPLE_PASSAGES.find(
    (p) => p.language === language && p.topic === topic && p.length === length
  );
  if (exact) return exact;

  const sameLangAndLength = SAMPLE_PASSAGES.find(
    (p) => p.language === language && p.length === length
  );
  if (sameLangAndLength) return sameLangAndLength;

  const sameLang = SAMPLE_PASSAGES.find((p) => p.language === language);
  return sameLang || SAMPLE_PASSAGES[0];
}
