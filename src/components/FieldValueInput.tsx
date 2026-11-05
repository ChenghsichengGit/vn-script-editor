import { useLayoutEffect, useRef, useState } from 'react';
import { hasList, listKey } from '../listText';
import FieldText from './FieldText';

// 卡片分頁裡一個欄位的內容輸入框
// 條列：行首打「- 」或「1. 」就是清單；按 Enter 自動補下一項（編號自動加 1），空的一項再按 Enter 結束清單，
//       游標在記號後面按 Backspace 拿掉記號
// 沒在編輯、而且內容有清單時，顯示成排好的清單（點一下就回到輸入框）
export default function FieldValueInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const pendingCursor = useRef<number | null>(null);

  // 自動補項目後，等新內容畫上去再把游標放到對的位置
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && pendingCursor.current !== null) {
      el.setSelectionRange(pendingCursor.current, pendingCursor.current);
      pendingCursor.current = null;
    }
  });

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' && e.key !== 'Backspace') return;
    // 選字中（注音、日文輸入法）按 Enter 是確定選字，不要當成換行處理
    if (e.nativeEvent.isComposing || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
    const el = e.currentTarget;
    if (el.selectionStart !== el.selectionEnd) return;
    const r = listKey(el.value, el.selectionStart, e.key);
    if (!r) return;
    e.preventDefault();
    pendingCursor.current = r.cursor;
    onChange(r.text);
  };

  if (!editing && hasList(value)) {
    return (
      <div
        className="field-value-view"
        tabIndex={0}
        title="點一下編輯"
        onClick={() => setEditing(true)}
        onFocus={() => setEditing(true)}
      >
        <FieldText text={value} />
      </div>
    );
  }

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      placeholder="內容（行首打「- 」或「1. 」變成條列）"
      autoFocus={editing}
      onFocus={() => setEditing(true)}
      onBlur={() => setEditing(false)}
      onKeyDown={onKeyDown}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
