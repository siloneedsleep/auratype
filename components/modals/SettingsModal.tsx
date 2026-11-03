'use client';
import { useDialog } from '@/hooks/useDialog';

import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  RotateCcw,
  Sliders,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
  X,
} from 'lucide-react';
import React, { useRef, useState } from 'react';
import {
  createExportBundle,
  MAX_IMPORT_BYTES,
  PreparedImportPlan,
  validateAndPrepareImport,
} from '../../services/dataTransfer';
import { useSettingsStore } from '../../store/useSettingsStore';
import { useTypingStore } from '../../store/useTypingStore';
import { soundFX, SoundProfile } from '../../utils/soundFX';
import { Language, PassageLength, Topic } from '../../utils/text';

interface SettingsModalProps {
  onClose: () => void;
}

type SettingsTab = 'visuals' | 'acoustic' | 'ai' | 'data';

export default function SettingsModal({ onClose }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('visuals');
  const settings = useSettingsStore();
  const {
    passages,
    attempts,
    commitImportPlan,
    clearHistoryOnly,
    fullFactoryReset,
    loadSampleForCriteria,
  } = useTypingStore();

  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const [pendingPlan, setPendingPlan] = useState<{
    plan: PreparedImportPlan;
    importedSettings?: Record<string, unknown>;
  } | null>(null);
  const [confirmAction, setConfirmAction] = useState<
    'clear_history' | 'factory_reset' | null
  >(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleExportJson = () => {
    const bundle = createExportBundle(passages, attempts, {
      fxMode: settings.fxMode,
      ghostEnabled: settings.ghostEnabled,
      screenShakeEnabled: settings.screenShakeEnabled,
      cometTrailEnabled: settings.cometTrailEnabled,
      soundEnabled: settings.soundEnabled,
      soundProfile: settings.soundProfile,
      soundVolume: settings.soundVolume,
      language: settings.language,
      topic: settings.topic,
      length: settings.length,
      personalCooldownSec: settings.personalCooldownSec,
    });
    const jsonString = JSON.stringify(bundle, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateStr = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `auratype-backup-${dateStr}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setImportError(null);
    setImportSuccess(null);
    setPendingPlan(null);

    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_IMPORT_BYTES) {
      setImportError('File vượt quá giới hạn 10MB.');
      e.target.value = '';
      return;
    }

    try {
      const rawText = await file.text();
      const plan = validateAndPrepareImport(rawText, passages, attempts);
      if (!plan.valid) {
        setImportError(plan.error || 'Dữ liệu trong file không hợp lệ.');
        e.target.value = '';
        return;
      }

      let parsedSettings: Record<string, unknown> | undefined;
      try {
        const root = JSON.parse(rawText);
        if (root && typeof root.settings === 'object') {
          parsedSettings = root.settings;
        }
      } catch {
        // Already validated above
      }

      setPendingPlan({ plan, importedSettings: parsedSettings });
    } catch {
      setImportError('Không thể đọc file được chọn.');
    } finally {
      e.target.value = '';
    }
  };

  const handleConfirmImport = async () => {
    if (!pendingPlan) return;
    const res = await commitImportPlan(pendingPlan.plan);
    if (!res.ok) {
      setImportError(res.error || 'Giao dịch import thất bại.');
      return;
    }
    if (pendingPlan.importedSettings) {
      settings.applyImportedSettings(pendingPlan.importedSettings);
    }
    setImportSuccess(
      `Đã nhập thành công ${pendingPlan.plan.passagesToInsert.length} bài và ${pendingPlan.plan.attemptsToInsert.length} lượt gõ.`
    );
    setPendingPlan(null);
  };

  const dialogRef = useDialog(onClose);
  return (
    <dialog
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-md"
    >
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <div>
            <h2
              id="settings-modal-title"
              className="font-display text-lg font-bold text-slate-100"
            >
              Trung tâm Cấu hình AuraType
            </h2>
            <p className="text-xs text-slate-400">
              Thay đổi cấu hình có hiệu lực ngay và không làm mất bài đang mở.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng cài đặt"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100 cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tabs Navigation */}
        <div
          onKeyDown={(e) => {
            const ids: SettingsTab[] = ['visuals', 'acoustic', 'ai', 'data'];
            let next = ids.indexOf(activeTab);
            if (e.key === 'ArrowRight') next = (next + 1) % ids.length;
            else if (e.key === 'ArrowLeft')
              next = (next + ids.length - 1) % ids.length;
            else if (e.key === 'Home') next = 0;
            else if (e.key === 'End') next = ids.length - 1;
            else return;
            e.preventDefault();
            setActiveTab(ids[next]);
            e.currentTarget
              .querySelectorAll<HTMLButtonElement>('[role="tab"]')
              [next]?.focus();
          }}
          role="tablist"
          aria-label="Các mục cài đặt"
          className="flex overflow-x-auto border-b border-slate-800 bg-slate-950/50 px-6"
        >
          {(
            [
              { id: 'visuals', label: 'Hình ảnh & FX', icon: Sliders },
              { id: 'acoustic', label: 'Âm thanh Switch', icon: Volume2 },
              { id: 'ai', label: 'AI & Luật bài', icon: Sparkles },
              { id: 'data', label: 'Dữ liệu & Sao lưu', icon: Database },
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            const isSelected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                role="tab"
                id={`settings-tab-${tab.id}`}
                aria-controls="settings-panel"
                tabIndex={isSelected ? 0 : -1}
                type="button"
                aria-selected={isSelected}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 border-b-2 px-4 py-3 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  isSelected
                    ? 'border-sky-400 text-sky-300'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Tab Panels */}
        <div
          role="tabpanel"
          id="settings-panel"
          aria-labelledby={`settings-tab-${activeTab}`}
          className="flex-1 overflow-y-auto p-6 space-y-5"
        >
          {activeTab === 'visuals' && (
            <div className="space-y-4">
              {settings.reducedMotionSystem && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-950/30 p-3 text-xs text-amber-200">
                  Hệ điều hành đang bật <code>prefers-reduced-motion</code>. Các
                  hiệu ứng chuyển động mạnh và pháo giấy được tự động giảm
                  thiểu.
                </div>
              )}

              <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/50 p-4">
                <div>
                  <div className="text-sm font-semibold text-slate-100">
                    Chế độ Hiệu ứng (FX Mode)
                  </div>
                  <div className="mt-0.5 text-xs text-slate-400">
                    Lite/Zen tối ưu độ ổn định; Ultra Juice bật hạt bụi Canvas,
                    Shockwave và pháo giấy.
                  </div>
                </div>
                <div className="flex rounded-lg border border-slate-800 bg-slate-900 p-1">
                  <button
                    type="button"
                    onClick={() => settings.setFxMode('lite')}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium cursor-pointer ${
                      settings.fxMode === 'lite'
                        ? 'bg-slate-800 text-emerald-300'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    🍃 Zen / Lite
                  </button>
                  <button
                    type="button"
                    onClick={() => settings.setFxMode('ultra')}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium cursor-pointer ${
                      settings.fxMode === 'ultra'
                        ? 'bg-slate-800 text-amber-300'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    ⚡ Ultra Juice
                  </button>
                </div>
              </div>

              <label className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/50 p-4 cursor-pointer">
                <div>
                  <div className="text-sm font-semibold text-slate-100">
                    Hiển thị Ghost Caret (Đua với kỷ lục PB)
                  </div>
                  <div className="mt-0.5 text-xs text-slate-400">
                    Hiển thị con trỏ bóng mờ chạy theo đúng timeline của lượt PB
                    hợp lệ tốt nhất.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.ghostEnabled}
                  onChange={(e) => settings.setGhostEnabled(e.target.checked)}
                  className="h-4 w-4 accent-sky-400"
                />
              </label>

              <label className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/50 p-4 cursor-pointer">
                <div>
                  <div className="text-sm font-semibold text-slate-100">
                    Rung nhẹ màn hình khi gãy chuỗi Combo
                  </div>
                  <div className="mt-0.5 text-xs text-slate-400">
                    Tùy chọn độc lập. Có thể tắt hoàn toàn ngay cả khi đang bật
                    Ultra Juice.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.screenShakeEnabled}
                  onChange={(e) =>
                    settings.setScreenShakeEnabled(e.target.checked)
                  }
                  className="h-4 w-4 accent-sky-400"
                />
              </label>

              <label className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/50 p-4 cursor-pointer">
                <div>
                  <div className="text-sm font-semibold text-slate-100">
                    Vệt sáng Comet Caret (Motion Trail)
                  </div>
                  <div className="mt-0.5 text-xs text-slate-400">
                    Đuôi sáng đổi màu theo tốc độ WPM (Xanh → Tím → Vàng Neon).
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.cometTrailEnabled}
                  onChange={(e) =>
                    settings.setCometTrailEnabled(e.target.checked)
                  }
                  className="h-4 w-4 accent-sky-400"
                />
              </label>

              <label className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/50 p-4 cursor-pointer">
                <div>
                  <div className="text-sm font-semibold text-slate-100">
                    Bàn phím ảo 2.5D bên dưới
                  </div>
                  <div className="mt-0.5 text-xs text-slate-400">
                    Gợi ý phím tiếp theo và phản hồi nhấn phím trực quan trên
                    màn hình.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.virtualKeyboardEnabled}
                  onChange={(e) =>
                    settings.setVirtualKeyboardEnabled(e.target.checked)
                  }
                  className="h-4 w-4 accent-sky-400"
                />
              </label>
            </div>
          )}

          {activeTab === 'acoustic' && (
            <div className="space-y-4">
              <label className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/50 p-4 cursor-pointer">
                <div>
                  <div className="text-sm font-semibold text-slate-100">
                    Âm thanh cơ học Web Audio API
                  </div>
                  <div className="mt-0.5 text-xs text-slate-400">
                    Tổng hợp âm thanh trực tiếp không độ trễ khi chốt ký tự. Tắt
                    có hiệu lực tức thì.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.soundEnabled}
                  onChange={(e) => settings.setSoundEnabled(e.target.checked)}
                  className="h-4 w-4 accent-sky-400"
                />
              </label>

              <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-slate-100">
                      Hồ sơ âm thanh Switch (Sound Profile)
                    </div>
                    <div className="mt-0.5 text-xs text-slate-400">
                      Chọn âm sắc bàn phím cơ yêu thích của bạn.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      soundFX.playKeyCommit(
                        'correct',
                        settings.soundProfile,
                        Math.max(50, settings.soundVolume),
                        true
                      )
                    }
                    className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-sky-300 hover:bg-slate-700 cursor-pointer"
                  >
                    Nghe thử
                  </button>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2.5">
                  {(
                    [
                      {
                        id: 'creamy',
                        name: 'Creamy Linear',
                        desc: 'Êm, tròn âm, tần số trung',
                      },
                      {
                        id: 'thock',
                        name: 'Deep Thock',
                        desc: 'Trầm ấm, dày, PBT keycap',
                      },
                      {
                        id: 'typewriter',
                        name: 'Typewriter',
                        desc: 'Đanh sắc, cổ điển rõ nhịp',
                      },
                    ] as { id: SoundProfile; name: string; desc: string }[]
                  ).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        settings.setSoundProfile(p.id);
                        soundFX.playKeyCommit(
                          'correct',
                          p.id,
                          Math.max(50, settings.soundVolume),
                          true
                        );
                      }}
                      className={`rounded-lg border p-3 text-left transition-colors cursor-pointer ${
                        settings.soundProfile === p.id
                          ? 'border-sky-400 bg-sky-950/30 text-slate-100'
                          : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <div className="text-xs font-semibold">{p.name}</div>
                      <div className="mt-0.5 text-[11px] text-slate-400">
                        {p.desc}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
                <div className="flex items-center justify-between text-sm font-semibold text-slate-100">
                  <label htmlFor="sound-volume-range">
                    Âm lượng ({settings.soundVolume}%)
                  </label>
                  <span className="font-mono text-xs text-sky-300 tabular-nums">
                    {settings.soundVolume}%
                  </span>
                </div>
                <input
                  id="sound-volume-range"
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={settings.soundVolume}
                  onChange={(e) =>
                    settings.setSoundVolume(Number(e.target.value))
                  }
                  className="mt-3 w-full accent-sky-400"
                />
              </div>
            </div>
          )}

          {activeTab === 'ai' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4 space-y-3">
                <div className="text-sm font-semibold text-slate-100">
                  Cấu hình Sinh bài AI & Bài mẫu mặc định
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <label
                      htmlFor="setting-lang"
                      className="block text-xs font-medium text-slate-400"
                    >
                      Ngôn ngữ
                    </label>
                    <select
                      id="setting-lang"
                      value={settings.language}
                      onChange={(e) => {
                        const nextLang = e.target.value as Language;
                        settings.setLanguage(nextLang);
                      }}
                      className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100"
                    >
                      <option value="vi">Tiếng Việt (có dấu)</option>
                      <option value="en">English</option>
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="setting-topic"
                      className="block text-xs font-medium text-slate-400"
                    >
                      Chủ đề
                    </label>
                    <select
                      id="setting-topic"
                      value={settings.topic}
                      onChange={(e) =>
                        settings.setTopic(e.target.value as Topic)
                      }
                      className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100"
                    >
                      <option value="philosophy">Triết học (Philosophy)</option>
                      <option value="code">Mã nguồn (Code)</option>
                      <option value="scifi">
                        Khoa học viễn tưởng (Sci-Fi)
                      </option>
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="setting-length"
                      className="block text-xs font-medium text-slate-400"
                    >
                      Độ dài bài (grapheme)
                    </label>
                    <select
                      id="setting-length"
                      value={settings.length}
                      onChange={(e) =>
                        settings.setLength(e.target.value as PassageLength)
                      }
                      className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100"
                    >
                      <option value="short">Short (150–300 ký tự)</option>
                      <option value="medium">Medium (400–700 ký tự)</option>
                      <option value="long">Long (900–1400 ký tự)</option>
                    </select>
                  </div>
                </div>

                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() =>
                      loadSampleForCriteria(
                        settings.language,
                        settings.topic,
                        settings.length
                      )
                    }
                    className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-sky-300 hover:bg-slate-700 cursor-pointer"
                  >
                    Nạp bài mẫu khớp lựa chọn trên ngay
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="cooldown-range"
                    className="text-sm font-semibold text-slate-100"
                  >
                    Thời gian Cooldown cá nhân (30s – 60s)
                  </label>
                  <span className="font-mono text-xs font-semibold text-sky-300 tabular-nums">
                    {settings.personalCooldownSec} giây
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  Mức sàn bảo vệ máy chủ là 30 giây. Thời gian áp dụng thực tế
                  là giá trị lớn hơn giữa cài đặt cá nhân và giới hạn máy chủ.
                </p>
                <input
                  id="cooldown-range"
                  type="range"
                  min={30}
                  max={60}
                  step={5}
                  value={settings.personalCooldownSec}
                  onChange={(e) =>
                    settings.setPersonalCooldownSec(Number(e.target.value))
                  }
                  className="mt-3 w-full accent-sky-400"
                />
              </div>

              <div className="rounded-xl border border-slate-800/80 bg-slate-950/40 p-3.5 text-xs text-slate-400">
                Bảo mật API: Khóa kết nối AI được quản lý hoàn toàn ở phía máy
                chủ. Ứng dụng không lưu trữ hay xuất khóa bí mật ở trình duyệt.
              </div>
            </div>
          )}

          {activeTab === 'data' && (
            <div className="space-y-4">
              {/* Export & Import */}
              <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4 space-y-3">
                <div className="text-sm font-semibold text-slate-100">
                  Sao lưu & Khôi phục dữ liệu (JSON)
                </div>
                <p className="text-xs text-slate-400">
                  File xuất chứa toàn bộ bài luyện, lịch sử attempts, Ghost
                  Replay và cài đặt không nhạy cảm. Khi nhập (tối đa 10MB), hệ
                  thống tự động tính lại WPM/Rank từ bộ đếm gốc và không ghi đè
                  dữ liệu hiện có.
                </p>

                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <button
                    type="button"
                    onClick={handleExportJson}
                    className="flex items-center gap-1.5 rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400 cursor-pointer"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>Export dữ liệu JSON</span>
                  </button>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/json,.json"
                    onChange={handleFileSelected}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-100 hover:bg-slate-700 cursor-pointer"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    <span>Chọn file JSON để Import</span>
                  </button>
                </div>

                {importError && (
                  <div className="mt-3 flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-950/40 p-3 text-xs text-rose-200">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
                    <span>Từ chối Import: {importError}</span>
                  </div>
                )}

                {importSuccess && (
                  <div className="mt-3 flex items-start gap-2 rounded-lg border border-emerald-500/40 bg-emerald-950/40 p-3 text-xs text-emerald-200">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400 mt-0.5" />
                    <span>{importSuccess}</span>
                  </div>
                )}

                {pendingPlan && (
                  <div className="mt-3 rounded-xl border border-sky-500/40 bg-sky-950/30 p-4 space-y-2.5 text-xs">
                    <div className="font-semibold text-sky-200">
                      Kiểm tra file hợp lệ — Xác nhận trước khi ghi vào cơ sở dữ
                      liệu:
                    </div>
                    <ul className="space-y-1 font-mono text-slate-300 tabular-nums">
                      <li>
                        • Bài mới sẽ thêm:{' '}
                        <strong>
                          {pendingPlan.plan.passagesToInsert.length}
                        </strong>{' '}
                        (đổi ID do trùng:{' '}
                        {pendingPlan.plan.passagesRemappedCount}, bỏ qua trùng:{' '}
                        {pendingPlan.plan.passagesSkippedCount})
                      </li>
                      <li>
                        • Lượt gõ sẽ thêm:{' '}
                        <strong>
                          {pendingPlan.plan.attemptsToInsert.length}
                        </strong>{' '}
                        (bỏ qua trùng: {pendingPlan.plan.attemptsSkippedCount})
                      </li>
                    </ul>
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={handleConfirmImport}
                        className="rounded-lg bg-emerald-500 px-3.5 py-1.5 font-semibold text-slate-950 hover:bg-emerald-400 cursor-pointer"
                      >
                        Xác nhận ghi dữ liệu
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingPlan(null)}
                        className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-slate-300 hover:bg-slate-700 cursor-pointer"
                      >
                        Hủy
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Danger Zone: Clear History vs Full Reset */}
              <div className="rounded-xl border border-rose-900/50 bg-rose-950/15 p-4 space-y-3">
                <div className="text-sm font-semibold text-rose-200">
                  Quản lý Xóa dữ liệu
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setConfirmAction('clear_history')}
                    className="flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-950/50 px-3.5 py-2 text-xs font-semibold text-rose-200 hover:bg-rose-900/60 cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Xóa lịch sử (Giữ cài đặt)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setConfirmAction('factory_reset')}
                    className="flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-slate-900 px-3.5 py-2 text-xs font-semibold text-rose-300 hover:bg-rose-950/60 cursor-pointer"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span>Khôi phục toàn bộ (Xóa cả cài đặt)</span>
                  </button>
                </div>

                {confirmAction && (
                  <div className="mt-3 rounded-lg border border-rose-500/50 bg-slate-950 p-3.5 text-xs">
                    <p className="font-medium text-rose-200">
                      {confirmAction === 'clear_history'
                        ? 'Bạn có chắc chắn muốn xóa toàn bộ lịch sử bài AI và các lượt gõ? Cài đặt cá nhân vẫn được giữ nguyên.'
                        : 'Bạn có chắc chắn muốn khôi phục toàn bộ ứng dụng về mặc định ban đầu (xóa cả lịch sử và cài đặt)?'}
                    </p>
                    <div className="mt-3 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          if (confirmAction === 'clear_history') {
                            await clearHistoryOnly();
                          } else {
                            await fullFactoryReset();
                          }
                          setConfirmAction(null);
                        }}
                        className="rounded-md bg-rose-500 px-3 py-1.5 font-semibold text-slate-950 hover:bg-rose-400 cursor-pointer"
                      >
                        Xác nhận thực hiện
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmAction(null)}
                        className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-slate-300 hover:bg-slate-700 cursor-pointer"
                      >
                        Hủy
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </dialog>
  );
}
