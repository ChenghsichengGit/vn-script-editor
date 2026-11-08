// 程式的設定（UI 大小、字體大小等）：全程式共用一份，不跟著專案走，記在 localStorage
import { useSyncExternalStore } from 'react';
import { readJSON, writeJSON } from './hooks';

export interface Settings {
  uiZoom: number; // 整個程式的縮放比例（1 = 100%）
  scriptFontSize: number; // 劇本編輯器的文字大小（Ctrl＋滾輪改的也是這個）
  scriptFontFamily: string; // 劇本編輯器的字型，空白 = 預設
  wordWrap: boolean; // 劇本自動換行
  minimap: boolean; // 劇本右側的小地圖
  minimapScale: 1 | 2 | 3; // 小地圖的放大倍數（小／中／大）
  cardFontSize: number; // 設定卡編輯畫面的內文大小
  autoSave: boolean; // 關掉後只有 Ctrl+S 才存檔
  openLastProject: boolean; // 程式啟動時直接開啟上次的專案
  aiPlayback: boolean; // 外部（例如 AI）改了檔案時：切到那個分頁、播放打字效果
  aiSpeed: 'slow' | 'normal' | 'fast'; // 打字效果的速度
  markExternal: boolean; // 外部（一起寫的人、AI）改過的地方用淡黃底標出來，直到按「清除標記」
  theme: 'dark' | 'light' | 'hc'; // 顏色主題：深色、淺色、高對比
  richScript: boolean; // 劇本用 Notion 式編輯器
}

const KEY = 'vn-editor-settings';

export const DEFAULT_FONT_FAMILY = "'Cascadia Code', 'Microsoft JhengHei UI', monospace";

export const defaultSettings: Settings = {
  uiZoom: 1,
  scriptFontSize: 15,
  scriptFontFamily: '',
  wordWrap: true,
  minimap: true,
  minimapScale: 2,
  cardFontSize: 15,
  autoSave: true,
  openLastProject: true,
  aiPlayback: true,
  aiSpeed: 'normal',
  markExternal: true,
  theme: 'dark',
  richScript: true,
};

export const LIMITS = {
  uiZoom: { min: 0.8, max: 1.5, step: 0.1 },
  scriptFontSize: { min: 10, max: 40, step: 1 },
  cardFontSize: { min: 11, max: 28, step: 1 },
} as const;

const clamp = (k: keyof typeof LIMITS, v: unknown, fallback: number) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(LIMITS[k].max, Math.max(LIMITS[k].min, v));
};

function normalize(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = defaultSettings;
  const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
  return {
    uiZoom: clamp('uiZoom', r.uiZoom, d.uiZoom),
    scriptFontSize: clamp('scriptFontSize', r.scriptFontSize, d.scriptFontSize),
    scriptFontFamily: typeof r.scriptFontFamily === 'string' ? r.scriptFontFamily : d.scriptFontFamily,
    wordWrap: bool(r.wordWrap, d.wordWrap),
    minimap: bool(r.minimap, d.minimap),
    minimapScale: r.minimapScale === 1 || r.minimapScale === 2 || r.minimapScale === 3 ? r.minimapScale : d.minimapScale,
    cardFontSize: clamp('cardFontSize', r.cardFontSize, d.cardFontSize),
    autoSave: bool(r.autoSave, d.autoSave),
    openLastProject: bool(r.openLastProject, d.openLastProject),
    aiPlayback: bool(r.aiPlayback, d.aiPlayback),
    aiSpeed: r.aiSpeed === 'slow' || r.aiSpeed === 'normal' || r.aiSpeed === 'fast' ? r.aiSpeed : d.aiSpeed,
    markExternal: bool(r.markExternal, d.markExternal),
    theme: r.theme === 'dark' || r.theme === 'light' || r.theme === 'hc' ? r.theme : d.theme,
    richScript: bool(r.richScript, d.richScript),
  };
}


let current = normalize(readJSON(KEY));
const listeners = new Set<() => void>();

export function getSettings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>) {
  current = normalize({ ...current, ...patch });
  writeJSON(KEY, current);
  listeners.forEach((fn) => fn());
}

export function resetSettings() {
  updateSettings(defaultSettings);
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, getSettings);
}
