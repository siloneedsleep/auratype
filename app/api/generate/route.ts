import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI, Type } from '@google/genai';
import {
  Language,
  LENGTH_BOUNDS,
  PassageLength,
  Topic,
  validatePassageText,
} from '../../../utils/text';
import {
  acquireGenerationSlot,
  createRateLimitStore,
  getClientCooldownStatus,
  releaseGenerationSlot,
} from '../../../utils/rateLimit';

const globalRateStore = createRateLimitStore();

function isAiProviderConfigured(): boolean {
  const key = process.env.GEMINI_API_KEY?.trim();
  return Boolean(key && key !== 'MY_GEMINI_API_KEY' && key.length >= 10);
}

function getClientIdentifier(req: NextRequest, bodySessionId?: string): string {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  const sessionPart =
    typeof bodySessionId === 'string' && bodySessionId.length <= 64
      ? bodySessionId.replace(/[^a-zA-Z0-9_-]/g, '')
      : 'anon';
  return `${forwarded}:${sessionPart}`;
}

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('sessionId') || 'anon';
  const clientKey = getClientIdentifier(req, sessionId);
  const serverNow = Date.now();
  const status = getClientCooldownStatus(globalRateStore, clientKey, serverNow);
  const aiReady = isAiProviderConfigured();

  return NextResponse.json({
    aiReady,
    reason: aiReady
      ? null
      : 'Nhà cung cấp AI chưa được cấu hình trên máy chủ (GEMINI_API_KEY chưa sẵn sàng). Chế độ bài mẫu và Ghost Replay vẫn hoạt động đầy đủ.',
    serverNow: status.serverNow,
    nextAllowedAt: status.nextAllowedAt,
    retryAfterMs: status.retryAfterMs,
  });
}

function buildSystemInstruction(language: Language, topic: Topic, length: PassageLength): string {
  const bounds = LENGTH_BOUNDS[length];
  const targetMid = Math.round((bounds.min + bounds.max) / 2);

  const langDesc =
    language === 'vi'
      ? 'Tiếng Việt chuẩn có đầy đủ dấu thanh và dấu phụ (Unicode NFC), văn phong tự nhiên, mạch lạc.'
      : 'Natural, articulate English prose.';

  const topicDesc =
    topic === 'code'
      ? 'A clean single-line TypeScript or JavaScript code snippet with a short inline comment explaining a pure functional concept. Must NOT contain any line breaks or tabs—use spaces only.'
      : topic === 'philosophy'
      ? 'A contemplative, inspiring reflection on focus, craftsmanship, mindfulness, or human thought.'
      : 'An atmospheric science-fiction log about deep-space exploration, orbital archives, or quantum navigation.';

  return [
    'You are the passage generator for AuraType AI, a precision typing studio.',
    `Language requirement: ${langDesc}`,
    `Topic requirement: ${topicDesc}`,
    `STRICT LENGTH REQUIREMENT: The generated "text" value MUST be between ${bounds.min} and ${bounds.max} visible characters (graphemes) including spaces. Aim closely for ${targetMid} characters.`,
    'STRICT FORMATTING RULES:',
    '1. Return ONLY a JSON object with a single property: { "text": "..." }.',
    '2. Do NOT include any newline (\\n), carriage return (\\r), or tab (\\t) characters inside "text". Use single standard spaces (U+0020) only.',
    '3. Do NOT include emojis, zero-width characters, or markdown code fences.',
    '4. Complete all sentences cleanly within the character budget.',
  ].join('\n');
}

export async function POST(req: NextRequest) {
  const serverNow = Date.now();

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: 'Payload yêu cầu không phải JSON hợp lệ.', serverNow },
      { status: 400 }
    );
  }

  const language: Language | null =
    body.language === 'en' || body.language === 'vi' ? body.language : null;
  const topic: Topic | null =
    body.topic === 'code' || body.topic === 'philosophy' || body.topic === 'scifi'
      ? body.topic
      : null;
  const length: PassageLength | null =
    body.length === 'short' || body.length === 'medium' || body.length === 'long'
      ? body.length
      : null;
  const requestId = typeof body.requestId === 'string' ? body.requestId.slice(0, 64) : '';
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.slice(0, 64) : 'anon';
  const personalCooldownSec =
    typeof body.personalCooldownSec === 'number' ? body.personalCooldownSec : 30;

  if (!language || !topic || !length || !requestId) {
    return NextResponse.json(
      {
        error: 'Tham số ngôn ngữ, chủ đề, độ dài hoặc requestId không hợp lệ.',
        serverNow,
      },
      { status: 400 }
    );
  }

  // Check if AI provider is configured BEFORE acquiring cooldown slot (Section 10.3)
  if (!isAiProviderConfigured()) {
    return NextResponse.json(
      {
        error:
          'Nhà cung cấp AI chưa sẵn sàng (chưa cấu hình GEMINI_API_KEY trên server). Vui lòng sử dụng chế độ bài mẫu.',
        aiReady: false,
        serverNow,
      },
      { status: 503 }
    );
  }

  const clientKey = getClientIdentifier(req, sessionId);
  const slot = acquireGenerationSlot(globalRateStore, clientKey, serverNow, personalCooldownSec);

  if (!slot.allowed) {
    return NextResponse.json(
      {
        error: slot.reason,
        serverNow: slot.serverNow,
        nextAllowedAt: slot.nextAllowedAt,
        retryAfterMs: slot.retryAfterMs,
        requestId,
      },
      { status: 429 }
    );
  }

  try {
    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const bounds = LENGTH_BOUNDS[length];
    const targetMid = Math.round((bounds.min + bounds.max) / 2);
    const userPrompt =
      language === 'vi'
        ? `Hãy viết một đoạn văn bản chủ đề "${topic}" bằng tiếng Việt có dấu với độ dài chính xác trong khoảng ${bounds.min} đến ${bounds.max} ký tự (mục tiêu khoảng ${targetMid} ký tự, chỉ dùng dấu cách đơn, tuyệt đối không xuống dòng, không emoji).`
        : `Write a single-paragraph "${topic}" passage in English whose length is strictly between ${bounds.min} and ${bounds.max} characters (aim for ~${targetMid} characters, single spaces only, no newlines, no emojis).`;

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 20_000);

    let responseText: string | undefined;
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: userPrompt,
        config: {
          systemInstruction: buildSystemInstruction(language, topic, length),
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              text: {
                type: Type.STRING,
                description: `Single-line typing passage between ${bounds.min} and ${bounds.max} characters.`,
              },
            },
            required: ['text'],
          },
          abortSignal: abortController.signal,
        },
      });
      responseText = response.text;
    } finally {
      clearTimeout(timeoutId);
    }

    if (!responseText) {
      return NextResponse.json(
        {
          error: 'Mô hình AI trả về phản hồi rỗng. Bài hiện tại vẫn được giữ nguyên.',
          serverNow: Date.now(),
          nextAllowedAt: slot.nextAllowedAt,
          retryAfterMs: Math.max(0, slot.nextAllowedAt - Date.now()),
          requestId,
        },
        { status: 502 }
      );
    }

    let parsedJson: { text?: unknown };
    try {
      parsedJson = JSON.parse(responseText.trim()) as { text?: unknown };
    } catch {
      return NextResponse.json(
        {
          error: 'Định dạng JSON từ AI không hợp lệ. Bài hiện tại vẫn được giữ nguyên.',
          serverNow: Date.now(),
          nextAllowedAt: slot.nextAllowedAt,
          retryAfterMs: Math.max(0, slot.nextAllowedAt - Date.now()),
          requestId,
        },
        { status: 502 }
      );
    }

    if (typeof parsedJson.text !== 'string') {
      return NextResponse.json(
        {
          error: 'Dữ liệu AI thiếu trường "text". Bài hiện tại vẫn được giữ nguyên.',
          serverNow: Date.now(),
          nextAllowedAt: slot.nextAllowedAt,
          retryAfterMs: Math.max(0, slot.nextAllowedAt - Date.now()),
          requestId,
        },
        { status: 502 }
      );
    }

    // Sanitize single spaces only if there are no forbidden characters, then validate strictly
    const cleanedCandidate = parsedJson.text.replace(/\r?\n/g, ' ').replace(/\t/g, ' ');
    const validation = validatePassageText(cleanedCandidate, length);

    if (!validation.valid) {
      return NextResponse.json(
        {
          error: `Nội dung AI sinh ra không đạt chuẩn kiểm tra: ${validation.reason}`,
          serverNow: Date.now(),
          nextAllowedAt: slot.nextAllowedAt,
          retryAfterMs: Math.max(0, slot.nextAllowedAt - Date.now()),
          requestId,
        },
        { status: 422 }
      );
    }

    const doneNow = Date.now();
    return NextResponse.json({
      text: validation.normalizedText,
      graphemeCount: validation.graphemeCount,
      requestId,
      serverNow: doneNow,
      nextAllowedAt: slot.nextAllowedAt,
      retryAfterMs: Math.max(0, slot.nextAllowedAt - doneNow),
    });
  } catch (err) {
    const doneNow = Date.now();
    const isAbort =
      err instanceof Error && (err.name === 'AbortError' || err.message.includes('aborted'));
    const message = isAbort
      ? 'Yêu cầu tạo bài AI quá thời gian chờ (timeout 20s). Đã giữ nguyên bài hiện tại.'
      : err instanceof Error
      ? `Không thể tạo bài AI: ${err.message}`
      : 'Lỗi không xác định khi gọi nhà cung cấp AI.';

    return NextResponse.json(
      {
        error: message,
        serverNow: doneNow,
        nextAllowedAt: slot.nextAllowedAt,
        retryAfterMs: Math.max(0, slot.nextAllowedAt - doneNow),
        requestId,
      },
      { status: isAbort ? 504 : 502 }
    );
  } finally {
    releaseGenerationSlot(globalRateStore, clientKey);
  }
}
