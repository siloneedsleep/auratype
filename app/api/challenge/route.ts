import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomUUID } from 'node:crypto';
import {
  hasSharedStorage,
  readValue,
  redis,
  writeValue,
} from '@/services/generationStorage';
import { dailyPassage, dayKey, scoreChallenge } from '@/utils/journey';
import { splitGraphemes } from '@/utils/text';
export const runtime = 'nodejs';
const ttl = 172800;
type Run = { day: string; language: 'vi' | 'en'; owner: string; start: number };
const reply = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
export async function GET(req: NextRequest) {
  const language =
      req.nextUrl.searchParams.get('language') === 'en' ? 'en' : 'vi',
    day = dayKey();
  if (!hasSharedStorage()) return reply({ day, rows: [], available: false });
  try {
    const ids = (await redis([
      'ZREVRANGE',
      `auratype:daily:${day}:${language}`,
      0,
      19,
    ])) as string[];
    const rows = await Promise.all(
      ids.map(async (id) =>
        JSON.parse(
          String(
            await redis(['HGET', `auratype:daily:${day}:${language}:names`, id])
          )
        )
      )
    );
    return reply({ day, rows, available: true });
  } catch {
    return reply({ error: 'Bảng xếp hạng đang tạm nghỉ.' }, 503);
  }
}
export async function POST(req: NextRequest) {
  if (
    req.headers.get('origin') &&
    req.headers.get('origin') !== req.nextUrl.origin
  )
    return reply({ error: 'Nguồn không hợp lệ.' }, 403);
  if (!hasSharedStorage())
    return reply(
      { error: 'Bảng xếp hạng chưa kết nối. Bạn vẫn có thể luyện thường.' },
      503
    );
  try {
    const raw = await req.text();
    if (raw.length > 180000) return reply({ error: 'Kết quả quá lớn.' }, 413);
    const b = JSON.parse(raw),
      language = b.language === 'en' ? 'en' : 'vi',
      day = dayKey();
    const owner =
      req.cookies.get('aura-player')?.value?.match(/^[a-f0-9-]{36}$/)?.[0] ??
      randomUUID();
    if (b.action === 'start') {
      const ip = createHash('sha256')
        .update(req.headers.get('x-forwarded-for')?.split(',')[0] ?? 'local')
        .digest('hex');
      const allowed = await redis([
        'EVAL',
        "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],3600) end; return n",
        1,
        `auratype:daily:budget:${ip}:${Math.floor(Date.now() / 3600000)}`,
      ]);
      if (Number(allowed) > 60)
        return reply({ error: 'Bạn đã mở nhiều lượt. Hãy quay lại sau.' }, 429);
      const runId = randomUUID(),
        start = Date.now();
      await writeValue(`run:${runId}`, { day, language, owner, start }, 1800);
      const response = reply({
        runId,
        day,
        passage: dailyPassage(language, day).content,
      });
      response.cookies.set('aura-player', owner, {
        httpOnly: true,
        sameSite: 'strict',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 31536000,
        path: '/',
      });
      return response;
    }
    if (
      b.action !== 'finish' ||
      typeof b.runId !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(b.runId)
    )
      return reply({ error: 'Lượt không hợp lệ.' }, 400);
    const run = await readValue<Run>(`run:${b.runId}`);
    if (!run || run.owner !== owner || run.day !== day)
      return reply({ error: 'Lượt đã hết hạn. Hãy mở thử thách mới.' }, 400);
    const length = splitGraphemes(
      dailyPassage(run.language, day).content
    ).length;
    let wpm: number, accuracy: number;
    try {
      ({ wpm, accuracy } = scoreChallenge(
        b.replay,
        length,
        Date.now() - run.start
      ));
    } catch (e) {
      return reply(
        { error: e instanceof Error ? e.message : 'Kết quả không hợp lệ.' },
        400
      );
    }
    const name =
      typeof b.name === 'string'
        ? b.name.trim().normalize('NFC').slice(0, 24)
        : '';
    if (!name || /[<>\x00-\x1f]/.test(name))
      return reply({ error: 'Nhập tên từ 1–24 ký tự.' }, 400);
    const board = `auratype:daily:${day}:${run.language}`,
      row = {
        name,
        wpm: Math.round(wpm * 10) / 10,
        accuracy: Math.round(accuracy * 10) / 10,
      };
    await redis([
      'EVAL',
      "if redis.call('EXISTS',KEYS[3])==0 then return 0 end; local old=redis.call('ZSCORE',KEYS[1],ARGV[1]); if not old or tonumber(ARGV[2])>tonumber(old) then redis.call('ZADD',KEYS[1],ARGV[2],ARGV[1]); redis.call('HSET',KEYS[2],ARGV[1],ARGV[3]); end; redis.call('EXPIRE',KEYS[1],ARGV[4]);redis.call('EXPIRE',KEYS[2],ARGV[4]);redis.call('DEL',KEYS[3]);return 1",
      3,
      board,
      board + ':names',
      `auratype:v2:run:${b.runId}`,
      owner,
      wpm,
      JSON.stringify(row),
      ttl,
    ]);
    return reply({ ok: true });
  } catch {
    return reply({ error: 'Chưa gửi được kết quả. Vui lòng thử lại.' }, 503);
  }
}
