'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Award,
  Play,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { selectPbAndGhost, formatAccuracy } from '../../utils/calculations';
import { countGraphemes } from '../../utils/text';
import { useTypingStore } from '../../store/useTypingStore';

interface HistoryDrawerProps {
  onClose: () => void;
  onSelectPassage: (passageId: string) => void;
}

export default function HistoryDrawer({
  onClose,
  onSelectPassage,
}: HistoryDrawerProps) {
  const { passages, attempts, currentPassage, deletePassageFromHistory } =
    useTypingStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'sample' | 'ai' | 'imported'>('all');
  const [langFilter, setLangFilter] = useState<'all' | 'vi' | 'en'>('all');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const enrichedPassages = useMemo(() => {
    return passages
      .filter((p) => {
        if (sourceFilter !== 'all' && p.source !== sourceFilter) return false;
        if (langFilter !== 'all' && p.language !== langFilter) return false;
        if (
          searchQuery.trim() &&
          !p.content.toLowerCase().includes(searchQuery.trim().toLowerCase())
        ) {
          return false;
        }
        return true;
      })
      .map((p) => {
        const passageAttempts = attempts.filter(
          (a) => a.passageId === p.id || a.contentHash === p.contentHash
        );
        const completedCount = passageAttempts.filter(
          (a) => a.status === 'completed'
        ).length;
        const pbGhost = selectPbAndGhost(attempts, p.contentHash);
        const graphemeLen = countGraphemes(p.content);
        return {
          passage: p,
          totalAttempts: passageAttempts.length,
          completedCount,
          pbAttempt: pbGhost.pbAttempt,
          hasGhost: pbGhost.ghostAttempt !== null,
          graphemeLen,
        };
      });
  }, [passages, attempts, sourceFilter, langFilter, searchQuery]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="history-drawer-title"
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/75 backdrop-blur-sm"
    >
      <div className="flex h-full w-full max-w-xl flex-col border-l border-slate-800 bg-slate-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <div>
            <h2
              id="history-drawer-title"
              className="font-display text-lg font-bold text-slate-100"
            >
              Kho Lịch sử & Ghost Vault
            </h2>
            <p className="text-xs text-slate-400">
              Chọn lại bất kỳ bài nào với 0 giây hồi chiêu để đua cùng Ghost Caret kỷ lục cũ.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng ngăn kéo lịch sử"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100 cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Search & Filters */}
        <div className="border-b border-slate-800 bg-slate-950/50 px-6 py-3 space-y-2.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm theo nội dung đoạn văn..."
              aria-label="Tìm kiếm trong lịch sử bài gõ"
              className="w-full rounded-lg border border-slate-800 bg-slate-900 pl-9 pr-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-1 rounded-lg bg-slate-900 p-0.5 border border-slate-800">
              {(
                [
                  { id: 'all', label: 'Tất cả nguồn' },
                  { id: 'sample', label: 'Bài mẫu' },
                  { id: 'ai', label: 'AI tạo' },
                  { id: 'imported', label: 'Đã Import' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setSourceFilter(tab.id)}
                  className={`rounded-md px-2.5 py-1 font-medium cursor-pointer ${
                    sourceFilter === tab.id
                      ? 'bg-slate-800 text-sky-300'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 rounded-lg bg-slate-900 p-0.5 border border-slate-800">
              {(
                [
                  { id: 'all', label: 'Mọi ngôn ngữ' },
                  { id: 'vi', label: 'Tiếng Việt' },
                  { id: 'en', label: 'English' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setLangFilter(tab.id)}
                  className={`rounded-md px-2.5 py-1 font-medium cursor-pointer ${
                    langFilter === tab.id
                      ? 'bg-slate-800 text-sky-300'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Passage List */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {enrichedPassages.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center rounded-xl border border-slate-800 bg-slate-950/40 p-6 text-center">
              <p className="text-sm font-medium text-slate-300">
                Không tìm thấy bài luyện nào khớp bộ lọc.
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Hãy thử đổi bộ lọc hoặc tạo bài mới từ thanh công cụ.
              </p>
            </div>
          ) : (
            enrichedPassages.map(
              ({
                passage,
                totalAttempts,
                completedCount,
                pbAttempt,
                hasGhost,
                graphemeLen,
              }) => {
                const isCurrent = currentPassage?.id === passage.id;
                const isConfirmingDelete = confirmDeleteId === passage.id;

                return (
                  <div
                    key={passage.id}
                    className={`rounded-xl border p-4 transition-colors ${
                      isCurrent
                        ? 'border-sky-500/60 bg-slate-950/80'
                        : 'border-slate-800 bg-slate-950/40 hover:border-slate-700'
                    }`}
                  >
                    {/* Metadata line (clean unboxed text with · separators) */}
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                      <div className="flex items-center gap-1.5 font-mono tabular-nums">
                        <span className="font-semibold text-slate-300">
                          {passage.language === 'vi' ? 'Tiếng Việt' : 'English'}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{passage.topic}</span>
                        <span aria-hidden="true">·</span>
                        <span>{graphemeLen} ký tự</span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {passage.source === 'ai'
                            ? 'AI'
                            : passage.source === 'imported'
                            ? 'Imported'
                            : 'Bài mẫu'}
                        </span>
                        {isCurrent && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-sky-400 font-semibold">Đang mở</span>
                          </>
                        )}
                      </div>

                      <div className="font-mono text-xs text-slate-400 tabular-nums">
                        Hoàn thành: {completedCount}/{totalAttempts} lượt
                      </div>
                    </div>

                    {/* Snippet */}
                    <p className="mt-2 line-clamp-2 font-mono text-xs leading-relaxed text-slate-200">
                      {passage.content}
                    </p>

                    {/* PB & Actions */}
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800/80">
                      <div className="flex items-center gap-2 font-mono text-xs tabular-nums">
                        {pbAttempt ? (
                          <span className="flex items-center gap-1.5 text-amber-300">
                            <Award className="h-3.5 w-3.5" />
                            <span>
                              PB: {Math.round(pbAttempt.wpm)} WPM ({formatAccuracy(pbAttempt.accuracy)})
                            </span>
                            {hasGhost && (
                              <span className="text-teal-400">· Có Ghost</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-slate-500">
                            Chưa có PB (Cần hoàn thành ≥95% & 0 lỗi tồn đọng)
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        {isConfirmingDelete ? (
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={async () => {
                                await deletePassageFromHistory(passage.id);
                                setConfirmDeleteId(null);
                              }}
                              className="rounded-md bg-rose-500 px-2.5 py-1 text-xs font-semibold text-slate-950 hover:bg-rose-400 cursor-pointer"
                            >
                              Xác nhận xóa
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-300 cursor-pointer"
                            >
                              Hủy
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(passage.id)}
                            aria-label={`Xóa bài ${passage.id}`}
                            className="rounded-lg border border-slate-800 bg-slate-900 p-1.5 text-slate-400 hover:border-rose-500/40 hover:text-rose-300 cursor-pointer"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => onSelectPassage(passage.id)}
                          className="flex items-center gap-1.5 rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-400 whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          <Play className="h-3 w-3 fill-current" />
                          <span>Luyện bài này (0s)</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              }
            )
          )}
        </div>
      </div>
    </div>
  );
}
