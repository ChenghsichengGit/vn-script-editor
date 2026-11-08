// 各元件共用的小工具：按鍵、點外面關閉、用事件打開的浮動視窗、localStorage 讀寫
import { RefObject, useEffect, useRef, useState } from 'react';

// 整個視窗的按鍵（捕捉階段，比編輯器先收到）；handler 回傳 true = 處理掉了，不再往下傳
export function useKeys(handler: (e: KeyboardEvent) => boolean | void, deps: unknown[]) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!handler(e)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', on, true);
    return () => window.removeEventListener('keydown', on, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export const useEscape = (onClose: () => void) => useKeys((e) => e.key === 'Escape' && (onClose(), true), [onClose]);

// 在 ref 以外的地方按下滑鼠就關掉
export function useOutsideClick(ref: RefObject<HTMLElement>, onClose: () => void) {
  useEffect(() => {
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    window.addEventListener('mousedown', down, true);
    return () => window.removeEventListener('mousedown', down, true);
  }, [ref, onClose]);
}

// 任何地方呼叫 open(資料) 就打開；畫面那邊用 useValue() 拿到最新一次的資料（null = 關著）
export function eventChannel<T>(name: string) {
  return {
    open: (detail: T) => window.dispatchEvent(new CustomEvent<T>(name, { detail })),
    useValue() {
      const state = useState<T | null>(null);
      useEffect(() => {
        const on = (e: Event) => state[1]((e as CustomEvent<T>).detail);
        window.addEventListener(name, on);
        return () => window.removeEventListener(name, on);
      }, []);
      return state;
    },
  };
}

// localStorage（讀不到、存不了都不影響使用）
export function readJSON(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}
export function writeJSON(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 存不了就算了 */
  }
}

// 每次重畫都更新成最新值的 ref（事件只訂閱一次、但要用到最新的函式或資料時用）
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// 按住滑鼠拖曳：移動時呼叫 onMove，放開時呼叫 onEnd（拖曳中 body 加上 dragging，游標不會亂跳）
export function dragWith(onMove: (ev: MouseEvent) => void, onEnd?: (ev: MouseEvent) => void) {
  const onUp = (ev: MouseEvent) => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    document.body.classList.remove('dragging');
    onEnd?.(ev);
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  document.body.classList.add('dragging');
}

// 拖曳排序：滑鼠在 y 時 item 該在哪（經過別的項目的中線就換位置）；位置沒變回傳原本的陣列
export function reorderAt<T>(list: T[], item: T, y: number, rectOf: (t: T) => DOMRect | undefined): T[] {
  const others = list.filter((t) => t !== item);
  let at = others.findIndex((t) => {
    const box = rectOf(t);
    return box ? y < box.top + box.height / 2 : false;
  });
  if (at < 0) at = others.length;
  if (list.indexOf(item) === at) return list;
  others.splice(at, 0, item);
  return others;
}
