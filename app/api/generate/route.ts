import {
  configuredKeys,
  generateGeminiPassage,
  ProviderError,
} from '@/services/geminiProvider';
import {
  addCachedPassage,
  cachedPassages,
  generationStorageReady,
  nextAllowed,
  releaseGeneration,
  reserveGeneration,
} from '@/services/generationStorage';
import { resolveEffectiveCooldownMs } from '@/utils/rateLimit';
import {
  computeContentHash,
  Language,
  PassageLength,
  Topic,
  validatePassageText,
} from '@/utils/text';
import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';

export const runtime = 'nodejs';
export const maxDuration = 30;
const clientId = (req: NextRequest) =>
  createHash('sha256')
    .update(
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
        'local-development'
    )
    .digest('hex');
function json(data: Record<string, unknown>, status = 200) {
  const now = Date.now();
  const next = Number(data.nextAllowedAt) || 0;
  return NextResponse.json(
    { ...data, serverNow: now, retryAfterMs: Math.max(0, next - now) },
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
        ...(status === 429
          ? {
              'Retry-After': String(
                Math.max(1, Math.ceil((next - now) / 1000))
              ),
            }
          : {}),
      },
    }
  );
}
export async function GET(req: NextRequest) {
  const aiReady = configuredKeys().length > 0 && generationStorageReady();
  try {
    return json({
      aiReady,
      reason: aiReady
        ? null
        : 'AI chưa sẵn sàng. Bạn vẫn có thể luyện bài mẫu.',
      nextAllowedAt: aiReady ? await nextAllowed(clientId(req)) : 0,
    });
  } catch {
    return json({
      aiReady: false,
      reason: 'AI đang tạm ngưng. Bài mẫu vẫn hoạt động.',
    });
  }
}
export async function POST(req: NextRequest) {
  // Browser-origin requests must come from this application; no wildcard CORS.
  const origin = req.headers.get('origin');
  if (origin && origin !== req.nextUrl.origin)
    return json({ error: 'Nguồn yêu cầu không hợp lệ.' }, 403);
  if (Number(req.headers.get('content-length')) > 16_384)
    return json({ error: 'Yêu cầu quá lớn.' }, 413);
  let body: Record<string, unknown>;
  try {
    const raw = await req.text();
    if (Buffer.byteLength(raw) > 16_384)
      return json({ error: 'Yêu cầu quá lớn.' }, 413);
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error();
    body = parsed;
  } catch {
    return json({ error: 'Nội dung yêu cầu không hợp lệ.' }, 400);
  }
  const { language, topic, length, requestId } = body;
  if (
    typeof language !== 'string' ||
    typeof topic !== 'string' ||
    typeof length !== 'string' ||
    !['vi', 'en'].includes(String(language)) ||
    !['code', 'philosophy', 'scifi'].includes(String(topic)) ||
    !['short', 'medium', 'long'].includes(String(length)) ||
    typeof requestId !== 'string' ||
    !requestId ||
    requestId.length > 64
  )
    return json({ error: 'Cấu hình bài chưa hợp lệ.' }, 400);
  if (!configuredKeys().length || !generationStorageReady())
    return json(
      {
        error:
          'Gemini chưa được cấu hình. Hãy luyện bài mẫu hoặc nhập bài của bạn.',
        aiReady: false,
      },
      503
    );
  const seen = new Set(
    Array.isArray(body.seenHashes)
      ? body.seenHashes
          .filter((v): v is string => typeof v === 'string' && v.length <= 80)
          .slice(0, 100)
      : []
  );
  const bucket = `${process.env.GEMINI_MODEL || 'gemini-3.5-flash'}:2:${language}:${topic}:${length}`;
  let lease: string | null = null;
  let next = 0;
  try {
    const pool = await cachedPassages(bucket);
    const cached = pool.find(
      (text) =>
        validatePassageText(text, length as PassageLength).valid &&
        !seen.has(computeContentHash(text, language as Language))
    );
    const slot = await reserveGeneration(
      clientId(req),
      resolveEffectiveCooldownMs(Number(body.personalCooldownSec)),
      !cached
    );
    next = slot.nextAllowedAt;
    if (!slot.allowed)
      return json(
        {
          error:
            'Đã đến giới hạn tạo bài. Bạn có thể tiếp tục với bài mẫu hoặc lịch sử.',
          nextAllowedAt: next,
          requestId,
        },
        429
      );
    lease = slot.lease;
    const text =
      cached ||
      (await generateGeminiPassage(
        language as Language,
        topic as Topic,
        length as PassageLength,
        AbortSignal.any([req.signal, AbortSignal.timeout(20_000)])
      ));
    if (!cached) await addCachedPassage(bucket, text);
    return json({
      text,
      requestId,
      nextAllowedAt: next,
      fromCache: Boolean(cached),
    });
  } catch (error) {
    const status = error instanceof ProviderError ? error.status : 503;
    if (status === 429) next = Math.max(next, Date.now() + 60_000);
    return json(
      {
        error:
          error instanceof ProviderError
            ? error.message
            : 'Kết nối AI tạm thời không khả dụng. Bài hiện tại được giữ nguyên.',
        nextAllowedAt: next,
        requestId,
      },
      status
    );
  } finally {
    if (lease) await releaseGeneration(lease).catch(() => {});
  }
}
