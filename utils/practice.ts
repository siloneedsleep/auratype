import { AttemptRecord } from './calculations';
import { validatePassageText } from './text';

export function prepareCustomPassage(raw: string) {
  return validatePassageText(raw.normalize('NFC').replace(/\s+/gu, ' ').trim());
}

export function targetPosition(wpm: number, elapsedMs: number, length: number) {
  return Math.min(
    length,
    Math.max(0, Math.floor((wpm * 5 * elapsedMs) / 60_000))
  );
}

export function practiceSummary(attempts: AttemptRecord[]) {
  const completed = attempts.filter(
    (a) => a.status === 'completed' && !a.imported
  );
  const recent = [...completed]
    .sort((a, b) => a.startedAt - b.startedAt)
    .slice(-12);
  return {
    count: completed.length,
    minutes: completed.reduce((sum, a) => sum + a.elapsedMs, 0) / 60_000,
    average: completed.length
      ? completed.reduce((sum, a) => sum + a.wpm, 0) / completed.length
      : 0,
    recent,
  };
}

export function coachingTip(
  accuracy: number | null,
  errors: number,
  wpm: number
) {
  if (accuracy === null)
    return 'Thả lỏng bàn tay. Độ chính xác trước, tốc độ sẽ đến sau.';
  if (errors > 0)
    return 'Thử chậm lại một nhịp và sửa các ký tự gõ sai trước khi đi tiếp.';
  if (accuracy < 95)
    return 'Ưu tiên một lượt trên 95% chính xác trước khi tăng tốc.';
  if (wpm < 40) return 'Giữ nhịp đều giữa các từ. Thử đua với mục tiêu 40 WPM.';
  return 'Nhịp gõ đang tốt. Thử tăng mục tiêu thêm 5 WPM ở lượt tiếp theo.';
}

export function mistakeTargets(target: string[], typed: string[]) {
  const counts = new Map<string, number>();
  typed.forEach((char, i) => {
    if (char !== target[i] && target[i])
      counts.set(target[i], (counts.get(target[i]) ?? 0) + 1);
  });
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 5);
}
