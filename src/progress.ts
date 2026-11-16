// 目前進度：最後看的劇本（切到卡片分頁時不變）。記憶的「看到」預設跟著它，「本場」區塊也看它
import { useSyncExternalStore } from 'react';

export interface Progress {
  fileId: string; // 劇本的 id（沒有 = 還沒打開過劇本）
  path: string; // 相對於「劇本/」的路徑，跟記憶的出處同一種寫法
  order: string[]; // 所有劇本照側邊欄排列的順序（判斷哪些劇本在目前進度之前）
}

let state: Progress = { fileId: '', path: '', order: [] };
const listeners = new Set<() => void>();

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export function setProgress(next: Progress) {
  if (next.fileId === state.fileId && next.path === state.path && sameList(next.order, state.order)) return;
  state = next;
  listeners.forEach((f) => f());
}

const subscribe = (f: () => void) => {
  listeners.add(f);
  return () => void listeners.delete(f);
};
export const getProgress = () => state;
export const useProgress =() => useSyncExternalStore(subscribe, () => state);
