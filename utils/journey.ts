import { AttemptRecord, PassageRecord } from './calculations';
import { Language, SAMPLE_PASSAGES, splitGraphemes, Topic } from './text';
export interface KeyInsight {
  key: string;
  hits: number;
  errors: number;
  delay: number;
  timed: number;
}
export function insights(
  attempts: AttemptRecord[],
  passages: PassageRecord[],
  language: Language
) {
  const keys = new Map<string, KeyInsight>(),
    pairs = new Map<string, number>();
  const texts = new Map(
    passages
      .filter((p) => p.language === language)
      .map((p) => [p.id, splitGraphemes(p.content)])
  );
  for (const a of attempts.filter(
    (a) => a.status === 'completed' && !a.imported && !a.replayTruncated
  )) {
    const text = texts.get(a.passageId);
    if (!text) continue;
    let index = 0,
      correct = 0,
      time = 0;
    for (const e of a.replay) {
      if (e.index === index + 1 && text[index]) {
        const key = text[index].toLowerCase(),
          row = keys.get(key) ?? {
            key,
            hits: 0,
            errors: 0,
            delay: 0,
            timed: 0,
          };
        const wrong = e.correctCount <= correct;
        row.hits++;
        row.errors += Number(wrong);
        const dt = e.t - time;
        if (index > 0 && dt > 0 && dt < 2000) {
          row.delay += dt;
          row.timed++;
        }
        keys.set(key, row);
        if (wrong && index > 0) {
          const pair = text
            .slice(index - 1, index + 1)
            .join('')
            .toLowerCase();
          pairs.set(pair, (pairs.get(pair) ?? 0) + 1);
        }
      }
      index = e.index;
      correct = e.correctCount;
      time = e.t;
    }
  }
  return {
    keys: [...keys.values()],
    weak: [...keys.values()]
      .filter((k) => k.errors)
      .sort(
        (a, b) => b.errors / Math.sqrt(b.hits) - a.errors / Math.sqrt(a.hits)
      ),
    pairs: [...pairs].sort((a, b) => b[1] - a[1]).slice(0, 5),
  };
}
export function makeDrill(language: Language, topic: Topic, weak: string[]) {
  const words = [
    ...new Set(
      SAMPLE_PASSAGES.filter(
        (p) => p.language === language && p.topic === topic
      ).flatMap((p) => p.content.split(/\s+/))
    ),
  ];
  const chosen = words
    .map((word, i) => ({
      word,
      i,
      score: weak.reduce(
        (n, k) => n + Number(word.toLowerCase().includes(k)),
        0
      ),
    }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, 32)
    .map((r) => r.word);
  if (!chosen.length) chosen.push('focus', 'practice', 'flow');
  const result: string[] = [];
  let size = 0;
  for (let i = 0; size < 260; i++) {
    const w = chosen[i % chosen.length];
    result.push(w);
    size += w.length + 1;
  }
  return result.join(' ');
}
export function dayKey(time = Date.now()) {
  return new Date(time + 7 * 3600000).toISOString().slice(0, 10);
}
export function dailyPassage(language: Language, day = dayKey()) {
  const pool = SAMPLE_PASSAGES.filter(
    (p) => p.language === language && p.length === 'short'
  );
  const hash = [...day].reduce((n, c) => n * 31 + c.charCodeAt(0), 0) >>> 0;
  return pool[hash % pool.length];
}
export function weeklyProgress(
  attempts: AttemptRecord[],
  passages: PassageRecord[],
  language: Language,
  now = Date.now()
) {
  const ids = new Set(
    passages.filter((p) => p.language === language).map((p) => p.id)
  );
  return Array.from({ length: 7 }, (_, i) => {
    const day = dayKey(now - (6 - i) * 86400000),
      rows = attempts.filter(
        (a) =>
          a.status === 'completed' &&
          !a.imported &&
          ids.has(a.passageId) &&
          dayKey(a.startedAt) === day
      );
    return {
      day,
      count: rows.length,
      wpm: rows.length ? rows.reduce((s, a) => s + a.wpm, 0) / rows.length : 0,
      accuracy: rows.length
        ? rows.reduce((s, a) => s + a.accuracy, 0) / rows.length
        : 0,
      minutes: rows.reduce((s, a) => s + a.elapsedMs, 0) / 60000,
    };
  });
}

export function scoreChallenge(
  events: unknown,
  length: number,
  wallTime: number
) {
  if (!Array.isArray(events) || events.length < length || events.length > 5000)
    throw Error('Không đủ dữ liệu lượt gõ.');
  let index = 0,
    correct = 0,
    time = 0,
    inserted = 0,
    hits = 0;
  for (const e of events) {
    if (
      !e ||
      !Number.isInteger(e.index) ||
      !Number.isInteger(e.correctCount) ||
      !Number.isFinite(e.t) ||
      e.t < time ||
      e.index < 0 ||
      e.index > length ||
      e.correctCount < 0 ||
      e.correctCount > e.index
    )
      throw Error('Dữ liệu lượt gõ không hợp lệ.');
    if (e.index === index + 1) {
      if (e.correctCount !== correct && e.correctCount !== correct + 1)
        throw Error('Điểm không hợp lệ.');
      inserted++;
      hits += e.correctCount - correct;
    } else if (e.index < index) {
      if (
        e.correctCount > correct ||
        correct - e.correctCount > index - e.index
      )
        throw Error('Điểm không hợp lệ.');
    } else throw Error('Chuỗi gõ không hợp lệ.');
    index = e.index;
    correct = e.correctCount;
    time = e.t;
  }
  if (index !== length || time < 5000 || time > wallTime + 1000)
    throw Error('Thời gian lượt gõ không hợp lệ.');
  const wpm = correct / 5 / (time / 60000),
    accuracy = (hits / inserted) * 100;
  if (wpm > 250 || accuracy < 90)
    throw Error(
      'Thử thách cần ít nhất 90% chính xác và tốc độ tối đa 250 WPM.'
    );
  return { wpm, accuracy };
}
