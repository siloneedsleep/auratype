'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Crosshair,
  Flame,
  Keyboard,
  Trophy,
  TrendingUp,
} from 'lucide-react';
import { useTypingStore } from '@/store/useTypingStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import {
  dailyPassage,
  dayKey,
  insights,
  makeDrill,
  weeklyProgress,
} from '@/utils/journey';
import { computeContentHash } from '@/utils/text';

type Row = { name: string; wpm: number; accuracy: number };
type Run = {
  runId: string;
  day: string;
  hash: string;
  language: 'en' | 'vi';
  started: number;
};
export default function JourneyPanel() {
  const attempts = useTypingStore((s) => s.attempts),
    passages = useTypingStore((s) => s.passages),
    engine = useTypingStore((s) =>
      s.engine.status === 'completed' ? s.engine : null
    ),
    load = useTypingStore((s) => s.loadCustomPassage);
  const status = useTypingStore((s) => s.engine.status);
  const language = useSettingsStore((s) => s.language),
    topic = useSettingsStore((s) => s.topic),
    setTopic = useSettingsStore((s) => s.setTopic),
    setTarget = useSettingsStore((s) => s.setTargetWpm);
  const [tab, setTab] = useState('keys'),
    [goal, setGoal] = useState<'accuracy' | 'speed'>('accuracy'),
    [target, setTargetValue] = useState(80),
    [ready, setReady] = useState(false),
    [notice, setNotice] = useState(''),
    [rows, setRows] = useState<Row[]>([]),
    [run, setRun] = useState<Run | null>(null),
    [busy, setBusy] = useState(false),
    [name, setName] = useState(''),
    [sent, setSent] = useState(false);
  const [today, setToday] = useState(dayKey());
  useEffect(() => {
    const timer = window.setInterval(() => setToday(dayKey()), 60000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('aura-goal-v1') ?? 'null');
      if (saved?.goal === 'speed' || saved?.goal === 'accuracy')
        setGoal(saved.goal);
      if (Number.isFinite(saved?.target))
        setTargetValue(Math.max(10, Math.min(200, saved.target)));
    } catch {}
    setReady(true);
  }, []);
  useEffect(() => {
    if (ready)
      try {
        localStorage.setItem('aura-goal-v1', JSON.stringify({ goal, target }));
      } catch {}
  }, [goal, target, ready]);
  const data = useMemo(
    () => insights(attempts, passages, language),
    [attempts, passages, language]
  );
  const week = useMemo(
    () =>
      weeklyProgress(
        attempts,
        passages,
        language,
        Date.parse(today + 'T12:00:00+07:00')
      ),
    [attempts, passages, language, today]
  );
  const total = week.reduce((s, d) => s + d.count, 0),
    minutes = week[6]?.minutes ?? 0;
  const keyMap = new Map(data.keys.map((k) => [k.key, k]));
  const weak = data.weak.slice(0, 6);
  async function refresh() {
    try {
      const res = await fetch('/api/challenge?language=' + language);
      const result = await res.json();
      if (!res.ok) throw Error(result.error);
      setRows(result.rows ?? []);
      if (!result.available) setNotice('Bảng xếp hạng đang chờ kết nối.');
    } catch {
      setNotice('Chưa tải được bảng xếp hạng. Hãy thử lại.');
    }
  }
  useEffect(() => {
    if (tab !== 'daily') return;
    let active = true;
    fetch('/api/challenge?language=' + language)
      .then((r) => r.json())
      .then((d) => {
        if (active) setRows(d.rows ?? []);
      })
      .catch(() => {
        if (active) setNotice('Chưa tải được bảng xếp hạng.');
      });
    return () => {
      active = false;
    };
  }, [tab, language, today]);
  async function start(drill: boolean) {
    if (status === 'running') {
      setNotice('Hoàn thành hoặc làm lại lượt hiện tại trước khi đổi bài.');
      return;
    }
    setBusy(true);
    setNotice('');
    try {
      if (drill) {
        setRun(null);
        await load(
          makeDrill(language, topic, [
            ...weak.map((k) => k.key),
            ...data.pairs.map((p) => p[0]),
          ])
        );
        setNotice(
          'Bài luyện đã sẵn sàng phía trên. Ưu tiên nhịp đều và gõ đúng.'
        );
      } else {
        const res = await fetch('/api/challenge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'start', language }),
        });
        const d = await res.json();
        if (!res.ok) throw Error(d.error);
        await load(d.passage);
        setRun({
          runId: d.runId,
          day: d.day,
          hash: computeContentHash(d.passage, language),
          language,
          started: Date.now(),
        });
        setSent(false);
        setNotice(
          'Thử thách đã sẵn sàng. Hoàn thành rồi quay lại đây để gửi kết quả.'
        );
      }
      document
        .getElementById('typing-controls')
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Chưa mở được bài.');
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    if (!run || !engine) return;
    setBusy(true);
    try {
      const res = await fetch('/api/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'finish',
          runId: run.runId,
          name,
          replay: engine.replay,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw Error(d.error);
      setSent(true);
      setNotice('Đã gửi! Bảng giữ thành tích cao nhất của bạn hôm nay.');
      await refresh();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Gửi thất bại.');
    } finally {
      setBusy(false);
    }
  }
  const eligible =
    run &&
    engine &&
    run.day === today &&
    run.language === language &&
    status === 'completed' &&
    engine.contentHash === run.hash &&
    (engine.startedAtEpoch ?? 0) >= run.started;
  const tabs = [
    { id: 'keys', label: 'Điểm yếu', icon: Keyboard },
    { id: 'plan', label: 'Lộ trình & tiến bộ', icon: TrendingUp },
    { id: 'daily', label: 'Thử thách ngày', icon: Trophy },
  ];
  return (
    <section id="journey" className="journey" aria-labelledby="journey-title">
      <div className="journey-heading">
        <div>
          <span className="eyebrow">MỖI NGÀY, TỐT HƠN MỘT CHÚT</span>
          <h2 id="journey-title">
            Hành trình của bạn<span>.</span>
          </h2>
        </div>
        <span className="journey-private">
          <Flame size={15} />
          {total} bài trong 7 ngày ·{' '}
          {language === 'vi' ? 'Tiếng Việt' : 'English'}
        </span>
      </div>
      <div
        className="journey-tabs"
        role="group"
        aria-label="Nội dung hành trình"
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            aria-pressed={tab === t.id}
            onClick={() => {
              setTab(t.id);
              setNotice('');
            }}
          >
            <t.icon size={16} />
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'keys' && (
        <div className="journey-grid">
          <div className="journey-card">
            <div className="journey-card-title">
              <Keyboard size={18} />
              <h3>Bản đồ ký tự</h3>
            </div>
            <p>
              Rê chuột hoặc chạm phím để xem độ chính xác. Dữ liệu được tính cả
              những lỗi bạn đã sửa.
            </p>
            <div className="heat-keyboard">
              {['qwertyuiop', 'asdfghjkl', 'zxcvbnm'].map((line) => (
                <div key={line}>
                  {[...line].map((k) => {
                    const r = keyMap.get(k),
                      acc = r
                        ? Math.round((1 - r.errors / r.hits) * 100)
                        : null;
                    return (
                      <button
                        key={k}
                        className={
                          r
                            ? r.errors
                              ? 'heat-warm'
                              : 'heat-good'
                            : 'heat-empty'
                        }
                        onClick={() =>
                          setNotice(
                            r
                              ? `${k.toUpperCase()}: ${acc}% đúng · ${r.hits} lần nhập${r.timed ? ` · nhịp trung bình ${Math.round(r.delay / r.timed)} ms` : ''}`
                              : `Chưa có dữ liệu cho ${k.toUpperCase()}.`
                          )
                        }
                        title={
                          r ? `${acc}% đúng · ${r.hits} lần` : 'Chưa có dữ liệu'
                        }
                      >
                        {k}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
            <div className="heat-legend">
              <span>○ Chưa có dữ liệu</span>
              <span className="good">● Gõ đúng</span>
              <span className="warm">● Có lỗi cần luyện</span>
            </div>
            <small>
              Đo theo ký tự đã nhập, không phải phím Telex/VNI vật lý. Nhịp nhập
              chỉ tính khoảng cách dưới 2 giây, bỏ qua các ký tự nhập đồng thời.
            </small>
            <div className="weak-chips">
              {weak.length ? (
                weak.map((k) => (
                  <span key={k.key}>
                    <b>{k.key === ' ' ? '␣' : k.key}</b>
                    {k.errors}/{k.hits} lỗi
                  </span>
                ))
              ) : (
                <p>
                  {data.keys.length
                    ? 'Bạn đang gõ rất chắc! Tiếp tục giữ nhịp đều.'
                    : 'Hoàn thành bài đầu tiên để mở bản đồ của bạn.'}
                </p>
              )}
            </div>
            {data.pairs.length > 0 && (
              <p>
                Cặp ký tự cần chú ý:{' '}
                {data.pairs.map((p) => `${p[0]} (${p[1]})`).join(' · ')}
              </p>
            )}
          </div>
          <div className="journey-card journey-accent">
            <span className="eyebrow">BÀI LUYỆN RIÊNG</span>
            <h3>
              Biến lỗi nhỏ thành
              <br />
              phản xạ tốt.
            </h3>
            <p>
              Bài tập từ vựng ưu tiên ký tự và cặp chữ bạn hay sai. Chọn chủ đề
              để luyện gần với điều bạn thích.
            </p>
            <label className="journey-label">
              Chủ đề
              <select
                value={topic}
                disabled={status === 'running'}
                onChange={(e) => setTopic(e.target.value as typeof topic)}
              >
                <option value="philosophy">Đời sống & suy ngẫm</option>
                <option value="code">Công nghệ & lập trình</option>
                <option value="scifi">Khoa học viễn tưởng</option>
              </select>
            </label>
            <button
              className="journey-primary"
              disabled={busy}
              onClick={() => start(true)}
            >
              Luyện điểm yếu <ArrowUpRight size={17} />
            </button>
            <small>Bài luyện được tạo ngay trên máy, không tốn lượt AI.</small>
          </div>
        </div>
      )}
      {tab === 'plan' && (
        <div className="journey-grid">
          <div className="journey-card">
            <div className="journey-card-title">
              <Crosshair size={18} />
              <h3>5 phút dành cho mình</h3>
            </div>
            <label className="journey-label">
              Mục tiêu
              <select
                value={goal}
                onChange={(e) => setGoal(e.target.value as typeof goal)}
              >
                <option value="accuracy">
                  Gõ chính xác hơn · mục tiêu 98%
                </option>
                <option value="speed">Tăng tốc độ</option>
              </select>
            </label>
            {goal === 'speed' && (
              <label className="journey-label">
                Tốc độ mong muốn
                <input
                  type="number"
                  min={10}
                  max={200}
                  value={target}
                  onChange={(e) =>
                    setTargetValue(
                      Math.max(10, Math.min(200, Number(e.target.value) || 10))
                    )
                  }
                />
              </label>
            )}
            <ol className="training-steps">
              <li>
                <b>01</b>
                <div>
                  <strong>Khởi động · 1 phút</strong>
                  <span>Gõ nhẹ, thả lỏng vai và nhìn vào nội dung.</span>
                </div>
              </li>
              <li>
                <b>02</b>
                <div>
                  <strong>Luyện điểm yếu · 3 phút</strong>
                  <span>
                    {weak.length
                      ? `Chú ý ${weak
                          .slice(0, 3)
                          .map((k) => k.key)
                          .join(', ')}. `
                      : ''}
                    {goal === 'accuracy'
                      ? 'Chậm lại cho đến khi đạt 98% chính xác.'
                      : `Giữ nhịp cùng Ghost ${target} WPM.`}
                  </span>
                </div>
              </li>
              <li>
                <b>03</b>
                <div>
                  <strong>Đánh giá · 1 phút</strong>
                  <span>Xem kết quả, chọn một lỗi để cải thiện ngày mai.</span>
                </div>
              </li>
            </ol>
            <button
              className="journey-primary"
              disabled={busy}
              onClick={() => {
                setTarget(goal === 'speed' ? target : 0);
                void start(true);
              }}
            >
              Bắt đầu buổi luyện <ArrowUpRight size={17} />
            </button>
            <div className="daily-progress">
              <span>Hôm nay: {minutes.toFixed(1)} / 5 phút gõ</span>
              <progress max={5} value={Math.min(5, minutes)} />
              <small>
                Thời gian gõ của các bài đã hoàn thành, không gồm thời gian đọc.
              </small>
            </div>
          </div>
          <div className="journey-card">
            <div className="journey-card-title">
              <TrendingUp size={18} />
              <h3>Nhịp tiến bộ · 7 ngày</h3>
            </div>
            <p>
              Tốc độ trung bình theo ngày. So với chính mình, từng chút một.
            </p>
            <div className="weekly-bars">
              {week.map((d) => (
                <div key={d.day}>
                  <span>{d.count ? Math.round(d.wpm) : '—'}</span>
                  <div
                    style={{
                      height: `${Math.max(3, (d.wpm / Math.max(...week.map((x) => x.wpm), 1)) * 110)}px`,
                    }}
                  />
                  <small>
                    {d.day.slice(8)}/{d.day.slice(5, 7)}
                  </small>
                  <small>
                    {d.count ? `${Math.round(d.accuracy)}%` : 'Chưa tập'}
                  </small>
                </div>
              ))}
            </div>
            <div className="journey-mini-stats">
              <div>
                <b>{total}</b>
                <span>Bài hoàn thành</span>
              </div>
              <div>
                <b>{week.reduce((s, d) => s + d.minutes, 0).toFixed(1)}</b>
                <span>Phút luyện tuần này</span>
              </div>
              <div>
                <b>{week.filter((d) => d.count).length}/7</b>
                <span>Ngày đã luyện</span>
              </div>
            </div>
            <small>
              Chỉ tính bài cùng ngôn ngữ trên thiết bị này; bỏ qua kết quả nhập
              từ tệp.
            </small>
          </div>
        </div>
      )}
      {tab === 'daily' && (
        <div className="journey-grid">
          <div className="journey-card journey-accent">
            <span className="eyebrow">DAILY FLOW · {today}</span>
            <h3>
              Cùng một bài.
              <br />
              Nhịp điệu riêng.
            </h3>
            <p>
              Mỗi ngày một đoạn chung cho từng ngôn ngữ. Ngày mới bắt đầu lúc
              00:00 giờ Việt Nam.
            </p>
            <blockquote>
              {dailyPassage(language, today).content.slice(0, 140)}…
            </blockquote>
            <button
              className="journey-primary"
              disabled={busy}
              onClick={() => start(false)}
            >
              {busy ? 'Đang xử lý…' : 'Tham gia thử thách'}{' '}
              <ArrowUpRight size={17} />
            </button>
            <small>
              Cần ít nhất 90% chính xác. Mỗi trình duyệt giữ điểm cao nhất; bảng
              cộng đồng không phải giải đấu có giám sát.
            </small>
            {eligible && !sent && (
              <div className="challenge-submit">
                <label className="journey-label">
                  Tên hiển thị công khai
                  <input
                    maxLength={24}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Tên của bạn"
                  />
                </label>
                <button
                  className="journey-primary"
                  disabled={busy || !name.trim()}
                  onClick={submit}
                >
                  Gửi {Math.round(engine?.wpm ?? 0)} WPM
                </button>
              </div>
            )}
          </div>
          <div className="journey-card">
            <div className="journey-card-title">
              <Trophy size={18} />
              <h3>Bảng xếp hạng hôm nay</h3>
              <button className="text-link" onClick={refresh}>
                Làm mới
              </button>
            </div>
            {rows.length ? (
              <ol className="leaderboard">
                {rows.map((r, i) => (
                  <li key={i}>
                    <b>{String(i + 1).padStart(2, '0')}</b>
                    <span>
                      {r.name}
                      <small>{r.accuracy}% chính xác</small>
                    </span>
                    <strong>
                      {r.wpm}
                      <small>WPM</small>
                    </strong>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="journey-empty">
                <Trophy size={30} />
                <h4>Ngày mới, cơ hội mới.</h4>
                <p>Chưa có thành tích. Bạn có thể là người mở màn.</p>
              </div>
            )}
            <small>
              Top 20 · {language === 'vi' ? 'Tiếng Việt' : 'English'} · Chỉ gửi
              khi bạn chọn công khai kết quả.
            </small>
          </div>
        </div>
      )}
      <p className="journey-notice" role="status">
        {notice}
      </p>
    </section>
  );
}
