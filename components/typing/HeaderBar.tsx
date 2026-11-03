'use client';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useTypingStore } from '@/store/useTypingStore';
import { Language, PassageLength, Topic } from '@/utils/text';
import {
  ArrowUpRight,
  Command,
  History,
  LoaderCircle,
  Settings2,
  Sparkles,
} from 'lucide-react';

interface Props {
  onOpenHistory: () => void;
  onOpenSettings: () => void;
  onRequestGenerateAI: () => void;
  onRequestSampleChange: (
    lang: Language,
    topic: Topic,
    length: PassageLength
  ) => void;
}
export default function HeaderBar({
  onOpenHistory,
  onOpenSettings,
  onRequestGenerateAI,
}: Props) {
  const generating = useTypingStore((s) => s.aiGenerating);
  const remaining = useTypingStore((s) => s.cooldownRemainingMs);
  const ready = useTypingStore((s) => s.aiReady);
  const cancel = useTypingStore((s) => s.cancelAiGeneration);
  const language = useSettingsStore((s) => s.language);
  return (
    <header className="app-header">
      <a
        href="#studio"
        className="wordmark"
        aria-label="AuraType — phòng luyện gõ"
      >
        <span className="brand-symbol">
          <Command size={21} />
        </span>
        aura<span>type</span>
        <small>STUDIO</small>
      </a>
      <nav aria-label="Điều hướng chính" className="header-nav">
        <a className="nav-active" href="#studio">
          Luyện gõ
        </a>
        <button onClick={onOpenHistory}>
          <History size={15} /> Lịch sử
        </button>
      </nav>
      <div className="header-actions">
        <span className="local-status">
          <i /> Lưu trên thiết bị
        </span>
        <button
          className="icon-button"
          aria-label="Cài đặt"
          onClick={onOpenSettings}
        >
          <Settings2 size={19} />
        </button>
        <button
          className="primary-button generate-button"
          onClick={generating ? cancel : onRequestGenerateAI}
          aria-disabled={!generating && (!ready || remaining > 0)}
          title={
            !ready
              ? 'Gemini chưa được cấu hình. Bạn vẫn có thể luyện bài mẫu.'
              : undefined
          }
        >
          {generating ? (
            <LoaderCircle size={16} className="loading-spin" />
          ) : (
            <Sparkles size={16} />
          )}
          <span>
            {generating
              ? 'Đang tạo · Hủy'
              : remaining > 0
                ? `Tạo sau ${Math.ceil(remaining / 1000)}s`
                : language === 'vi'
                  ? 'Tạo bài AI'
                  : 'Generate AI'}
          </span>
          {!generating && remaining <= 0 && <ArrowUpRight size={16} />}
        </button>
      </div>
    </header>
  );
}
