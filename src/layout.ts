// 版面：四個區塊各自放在哪裡（左側欄、右側欄、浮動視窗）、哪些被隱藏、各自多高、側邊欄多寬
import { SectionId } from './model';
import { sectionOrder } from './sections';
import { readJSON } from './hooks';

export type Side = 'left' | 'right';

export interface FloatPanel {
  id: SectionId;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
}

export interface SidebarLayout {
  sections: SectionId[]; // 住在這個側邊欄的區塊，由上到下（含被隱藏的，隱藏只是暫時不顯示，位置會保留）
  width: number;
}

export interface Layout {
  left: SidebarLayout;
  right: SidebarLayout;
  floating: FloatPanel[];
  hidden: SectionId[]; // 被活動列關掉的區塊（不管它在左、右還是浮動）
  sizes: Partial<Record<SectionId, number>>; // 固定高度的區塊拖出來的高度
  leftCollapsed: boolean; // 左側欄整排收起來（裡面的區塊、高度都照樣保留，打開時一模一樣）
  problemsOpen: boolean; // 編輯區下方的面板（問題 Ctrl+Shift+M／搜尋 Ctrl+Shift+F）開著沒（名稱沿用舊的，才讀得到舊設定）
  problemsHeight: number;
  panelTab: 'problems' | 'search'; // 下方面板顯示哪個分頁
}

export const LAYOUT_KEY = 'vn-editor-layout';
export const MIN_SIDEBAR_WIDTH = 180;
export const MAX_SIDEBAR_WIDTH = 700;
export const FLOAT_MIN_W = 200;
export const FLOAT_MIN_H = 150;
export const FLOAT_DEFAULT_W = 300;
export const FLOAT_DEFAULT_H = 380;

const defaultLayout = (): Layout => ({
  left: { sections: sectionOrder(), width: 300 },
  right: { sections: [], width: 300 },
  floating: [],
  hidden: [],
  sizes: {},
  leftCollapsed: false,
  problemsOpen: false,
  problemsHeight: 180,
  panelTab: 'problems',
});

const isSection = (x: unknown): x is SectionId => typeof x === 'string' && x !== '';
const num = (x: unknown, fallback: number) => (typeof x === 'number' && Number.isFinite(x) ? x : fallback);
const clampWidth = (w: number) => Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, w));

function normalizeLayout(raw: unknown): Layout {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const base = defaultLayout();
  const seen = new Set<SectionId>();
  const take = (list: unknown): SectionId[] =>
    (Array.isArray(list) ? list : []).filter((s): s is SectionId => {
      if (!isSection(s) || seen.has(s)) return false;
      seen.add(s);
      return true;
    });
  const sizes: Layout['sizes'] = {};
  for (const id of Object.keys(r.sizes ?? {})) {
    const v = r.sizes?.[id];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) sizes[id] = v;
  }
  if (!r.left || typeof r.left !== 'object') {
    const open: SectionId[] = Array.isArray(r.open) ? r.open.filter(isSection) : sectionOrder();
    return {
      ...base,
      left: { sections: sectionOrder(), width: clampWidth(num(r.width, 300)) },
      hidden: sectionOrder().filter((s) => !open.includes(s)),
      sizes,
    };
  }
  const left = take(r.left.sections);
  const right = take(r.right?.sections);
  const floating: FloatPanel[] = [];
  for (const f of Array.isArray(r.floating) ? r.floating : []) {
    if (!f || !isSection(f.id) || seen.has(f.id)) continue;
    seen.add(f.id);
    floating.push({
      id: f.id,
      x: num(f.x, 80),
      y: num(f.y, 60),
      w: Math.max(FLOAT_MIN_W, num(f.w, FLOAT_DEFAULT_W)),
      h: Math.max(FLOAT_MIN_H, num(f.h, FLOAT_DEFAULT_H)),
      z: num(f.z, floating.length + 1),
    });
  }
  for (const id of sectionOrder()) if (!seen.has(id)) left.push(id); // 漏掉的補回左邊
  return {
    left: { sections: left, width: clampWidth(num(r.left.width, 300)) },
    right: { sections: right, width: clampWidth(num(r.right?.width, 300)) },
    floating,
    hidden: [...new Set(Array.isArray(r.hidden) ? r.hidden.filter(isSection) : [])] as SectionId[],
    sizes,
    leftCollapsed: r.leftCollapsed === true,
    problemsOpen: r.problemsOpen === true,
    problemsHeight: Math.min(600, Math.max(80, num(r.problemsHeight, 180))),
    panelTab: r.panelTab === 'search' ? 'search' : 'problems',
  };
}

export const loadLayout = (): Layout => normalizeLayout(readJSON(LAYOUT_KEY));

const detach = (l: Layout, id: SectionId): Layout => ({
  ...l,
  left: { ...l.left, sections: l.left.sections.filter((s) => s !== id) },
  right: { ...l.right, sections: l.right.sections.filter((s) => s !== id) },
  floating: l.floating.filter((f) => f.id !== id),
});

const unhide = (l: Layout, id: SectionId): Layout => ({ ...l, hidden: l.hidden.filter((s) => s !== id) });

export function dockSection(l: Layout, id: SectionId, side: Side, before: SectionId | null): Layout {
  const next = detach(l, id);
  const list = [...next[side].sections];
  const at = before ? list.indexOf(before) : -1;
  list.splice(at < 0 ? list.length : at, 0, id);
  return unhide({ ...next, [side]: { ...next[side], sections: list } }, id);
}

export function floatSection(l: Layout, id: SectionId, rect: { x: number; y: number; w: number; h: number }): Layout {
  const next = detach(l, id);
  const z = Math.max(0, ...l.floating.map((f) => f.z)) + 1;
  return unhide({ ...next, floating: [...next.floating, { id, ...rect, z }] }, id);
}

export function reconcileLayout(l: Layout, ids: SectionId[]): Layout {
  const placed = new Set([...l.left.sections, ...l.right.sections, ...l.floating.map((f) => f.id)]);
  const missing = ids.filter((id) => !placed.has(id));
  return missing.length === 0 ? l : { ...l, left: { ...l.left, sections: [...l.left.sections, ...missing] } };
}
