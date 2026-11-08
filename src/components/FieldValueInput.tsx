import { useLayoutEffect, useRef, useState } from 'react';
import { hasList, listKey } from '../listText';
import FieldText from './FieldText';

export default function FieldValueInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const pendingCursor = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && pendingCursor.current !== null) {
      el.setSelectionRange(pendingCursor.current, pendingCursor.current);
      pendingCursor.current = null;
    }
  });
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' && e.key !== 'Backspace') return;
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
      <div className="field-value-view" tabIndex={0} title="點一下編輯" onClick={() => setEditing(true)} onFocus={() => setEditing(true)}>
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
