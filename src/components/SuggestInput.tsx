import { useLayoutEffect, useRef, useState } from 'react';
import './SuggestInput.css';

export interface Suggestion {
  label: string;
  detail?: string;
  insert: string;
}
export interface SuggestResult {
  items: Suggestion[];
  from: number;
  to: number;
}

interface Props extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  value: string;
  onChange: (value: string) => void;
  suggest: (value: string, caret: number) => SuggestResult | null;
  openOnFocus?: boolean; // 一點進輸入框就列出選項（不用先打字）
}

export default function SuggestInput({ value, onChange, suggest, openOnFocus, onKeyDown, onBlur, onFocus, ...rest }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [list, setList] = useState<(SuggestResult & { index: number }) | null>(null);
  const [box, setBox] = useState<DOMRect | null>(null);
  const caretAfter = useRef<number | null>(null);
  const refresh = (text: string, caret: number) => {
    const r = suggest(text, caret);
    if (r && r.items.length > 0) {
      setList({ ...r, index: 0 });
      setBox(inputRef.current!.getBoundingClientRect());
    } else setList(null);
  };
  useLayoutEffect(() => {
    if (caretAfter.current !== null && inputRef.current) {
      inputRef.current.setSelectionRange(caretAfter.current, caretAfter.current);
      caretAfter.current = null;
    }
  });
  const apply = (item: Suggestion) => {
    if (!list) return;
    const next = value.slice(0, list.from) + item.insert + value.slice(list.to);
    caretAfter.current = list.from + item.insert.length;
    setList(null);
    onChange(next);
  };
  return (
    <>
      <input
        {...rest}
        ref={inputRef}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          refresh(e.target.value, e.target.selectionStart ?? e.target.value.length);
        }}
        onFocus={(e) => {
          if (openOnFocus) refresh(value, e.target.selectionStart ?? value.length);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setList(null);
          onBlur?.(e);
        }}
        onKeyDown={(e) => {
          if (list) {
            const n = list.items.length;
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              setList({ ...list, index: (list.index + (e.key === 'ArrowDown' ? 1 : n - 1)) % n });
              return;
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault();
              apply(list.items[list.index]);
              return;
            }
            if (e.key === 'Escape') {
              e.stopPropagation(); // 只關清單，不要連對話框一起關
              setList(null);
              return;
            }
          }
          onKeyDown?.(e);
        }}
      />
      {list && box && (
        <div className="suggest-list" style={{ left: box.left, top: box.bottom + 2, minWidth: box.width }}>
          {list.items.map((item, i) => (
            <div
              key={item.label}
              className={`suggest-item${i === list.index ? ' active' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                apply(item);
              }}
              onMouseEnter={() => setList({ ...list, index: i })}
            >
              <span className="suggest-label">{item.label}</span>
              {item.detail && <span className="suggest-detail">{item.detail}</span>}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
