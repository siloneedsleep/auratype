'use client';
import { useDialog } from '@/hooks/useDialog';
import { prepareCustomPassage } from '@/utils/practice';
import { AlignLeft, ArrowUpRight, X } from 'lucide-react';
import { useState } from 'react';

export default function CustomPassageModal({
  onClose,
  onStart,
}: {
  onClose: () => void;
  onStart: (text: string) => Promise<void>;
}) {
  const dialog = useDialog(onClose);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const check = prepareCustomPassage(text);
  return (
    <dialog
      ref={dialog}
      aria-labelledby="custom-title"
      className="studio-dialog"
    >
      <div className="dialog-heading">
        <span className="eyebrow">
          <AlignLeft size={15} /> BÀI CỦA BẠN
        </span>
        <button className="icon-button" onClick={onClose} aria-label="Đóng">
          <X size={19} />
        </button>
      </div>
      <h2 id="custom-title">Luyện điều bạn thích.</h2>
      <p className="muted">
        Dán đoạn văn 150–1.400 ký tự. Nội dung được lưu trên trình duyệt của
        bạn, không gửi đến AI.
      </p>
      <label className="field-label" htmlFor="custom-text">
        Nội dung luyện gõ
      </label>
      <textarea
        autoFocus
        id="custom-text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={6000}
        className="custom-text"
        placeholder="Một đoạn sách, lời nhắn hay bài học bạn muốn luyện…"
      />
      <div className="dialog-summary">
        <span>{check.graphemeCount} ký tự · tự chuẩn hóa dấu cách</span>
        <span>
          {text && !check.valid ? check.reason : 'Chỉ lưu trên thiết bị này'}
        </span>
      </div>
      {error && <p role="alert">{error}</p>}
      <button
        className="primary-button"
        disabled={!check.valid || busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onStart(check.normalizedText);
            onClose();
          } catch {
            setError('Chưa thể nạp bài. Vui lòng thử lại.');
            setBusy(false);
          }
        }}
      >
        Bắt đầu luyện <ArrowUpRight size={17} />
      </button>
    </dialog>
  );
}
