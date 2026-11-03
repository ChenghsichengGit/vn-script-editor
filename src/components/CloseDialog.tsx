import { useEffect, useState } from 'react';

// 關閉程式（或關分頁）時還有沒存的內容：問要不要先存（跟 VS Code 一樣：儲存／不儲存／取消）
// Enter = 儲存、Esc = 取消；存檔失敗就留在這個視窗，顯示原因
export default function CloseDialog({
  message = '有尚未儲存的變更，要先儲存嗎？',
  onSave,
  onDiscard,
  onCancel,
}: {
  message?: string;
  onSave: () => Promise<string | null>; // 存完回傳 null；失敗回傳錯誤訊息
  onDiscard: () => void;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError(await onSave());
    setBusy(false);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      else if (e.key === 'Enter') void save();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  return (
    <div className="close-backdrop">
      <div className="close-panel" role="dialog" aria-label="尚未儲存">
        <div className="close-message">{message}</div>
        {error && <div className="close-error">存檔失敗：{error}</div>}
        <div className="close-buttons">
          <button type="button" className="close-btn primary" disabled={busy} onClick={() => void save()} autoFocus>
            {busy ? '儲存中…' : '儲存'}
          </button>
          <button type="button" className="close-btn" disabled={busy} onClick={onDiscard}>
            不儲存
          </button>
          <button type="button" className="close-btn" disabled={busy} onClick={onCancel}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
