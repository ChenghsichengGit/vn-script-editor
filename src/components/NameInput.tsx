import { useRef, useState } from 'react';

interface Props {
  initial?: string; // 改名時的原名稱；新增時省略
  selectTo?: number; // 一開始選取到第幾個字（預設全選）
  // 按 Enter（或離開輸入框時有打字）時呼叫：回傳錯誤訊息就留在輸入框並顯示，回傳 null 代表成功
  onSubmit: (value: string) => string | null | Promise<string | null>;
  onClose: () => void; // 成功或取消後都會呼叫，由上層把輸入框拿掉
}

// 側邊欄用的「先命名」輸入框（新增檔案／資料夾、改名都用它）
// Enter 確定；Esc 取消；離開輸入框時，空白或沒改動就取消，否則當成確定
// 名稱不能用時輸入框保持開著，紅字訊息浮在輸入框正下方
export default function NameInput({ initial = '', selectTo, onSubmit, onClose }: Props) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false); // 正在處理確定（可能是非同步），這時的 blur 不要再處理一次
  const closed = useRef(false);

  const close = () => {
    if (closed.current) return;
    closed.current = true;
    onClose();
  };

  const submit = async () => {
    if (busy.current || closed.current) return;
    busy.current = true;
    try {
      const err = await onSubmit(value);
      if (err) setError(err);
      else close();
    } finally {
      busy.current = false;
    }
  };

  return (
    <span className="name-input-wrap" onClick={(e) => e.stopPropagation()}>
      <input
        className={`rename-input${error ? ' invalid' : ''}`}
        value={value}
        autoFocus
        onFocus={(e) => e.currentTarget.setSelectionRange(0, selectTo ?? e.currentTarget.value.length)}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit();
          else if (e.key === 'Escape') close();
        }}
        onBlur={() => {
          if (busy.current) return;
          const text = value.trim();
          if (text === '' || text === initial) close();
          else void submit();
        }}
      />
      {error && <div className="name-error">{error}</div>}
    </span>
  );
}
