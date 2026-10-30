// 版面：四個區塊各自放在哪裡（左側欄、右側欄、浮動視窗）、哪些被隱藏、各自多高、側邊欄多寬
// 會記在瀏覽器的 localStorage；這個檔案只放資料的形狀和純函式，不碰畫面
import { SectionId } from './model';
import { sectionOrder } from './sampleData';

export type Side = 'left' | 'right';

// 一個浮動面板：座標與大小都相對於主區域（活動列 + 側邊欄 + 編輯區那一塊）
// z 越大越上面（點一下就把 z 設成最大，不改陣列順序，避免 DOM 被搬動）
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
}

export const LAYOUT_KEY = 'vn-editor-layout';
export const MIN_SIDEBAR_WIDTH = 180;
export const MAX_SIDEBAR_WIDTH = 700;
export const FLOAT_MIN_W = 200;
export const FLOAT_MIN_H = 150;
export const FLOAT_DEFAULT_W = 300;
export const FLOAT_DEFAULT_H = 380;

const defaultLayout = (): Layout => ({
  left: { sections: [...sectionOrder], width: 300 },
  right: { sections: [], width: 300 },
  floating: [],
  hidden: [],
  sizes: {},
});

const isSection = (x: unknown): x is SectionId => sectionOrder.includes(x as SectionId);
const num = (x: unknown, fallback: number) => (typeof x === 'number' && Number.isFinite(x) ? x : fallback);
const clampWidth = (w: number) => Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, w));

// 把讀到的任何東西整理成合法的 Layout：
//  - 舊格式（{open, sizes, width}）→ 全部放左邊，沒在 open 裡的算隱藏，width 沿用到左邊
//  - 新格式：去掉不認得／重複的區塊；漏掉的區塊補回左邊，確保每個區塊剛好出現一次
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
  for (const id of sectionOrder) {
    const v = r.sizes?.[id];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) sizes[id] = v;
  }

  // 舊格式
  if (!r.left || typeof r.left !== 'object') {
    const open: SectionId[] = Array.isArray(r.open) ? r.open.filter(isSection) : [...sectionOrder];
    return {
      ...base,
      left: { sections: [...sectionOrder], width: clampWidth(num(r.width, 300)) },
      hidden: sectionOrder.filter((s) => !open.includes(s)),
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
  for (const id of sectionOrder) if (!seen.has(id)) left.push(id); // 漏掉的補回左邊

  return {
    left: { sections: left, width: clampWidth(num(r.left.width, 300)) },
    right: { sections: right, width: clampWidth(num(r.right?.width, 300)) },
    floating,
    hidden: [...new Set(Array.isArray(r.hidden) ? r.hidden.filter(isSection) : [])] as SectionId[],
    sizes,
  };
}

export function loadLayout(): Layout {
  try {
    return normalizeLayout(JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? 'null'));
  } catch {
    return defaultLayout();
  }
}

// ── 純函式：搬動區塊（都回傳新的 Layout，不改原本的）──

// 把區塊從目前的位置（左、右、浮動）拿掉
const detach = (l: Layout, id: SectionId): Layout => ({
  ...l,
  left: { ...l.left, sections: l.left.sections.filter((s) => s !== id) },
  right: { ...l.right, sections: l.right.sections.filter((s) => s !== id) },
  floating: l.floating.filter((f) => f.id !== id),
});

const unhide = (l: Layout, id: SectionId): Layout => ({ ...l, hidden: l.hidden.filter((s) => s !== id) });

// 放進某個側邊欄，插在 before 這個區塊前面（null = 放到最後）；放下去就一定會顯示出來
export function dockSection(l: Layout, id: SectionId, side: Side, before: SectionId | null): Layout {
  const next = detach(l, id);
  const list = [...next[side].sections];
  const at = before ? list.indexOf(before) : -1;
  list.splice(at < 0 ? list.length : at, 0, id);
  return unhide({ ...next, [side]: { ...next[side], sections: list } }, id);
}

// 變成浮動面板（放到最上層）
export function floatSection(l: Layout, id: SectionId, rect: { x: number; y: number; w: number; h: number }): Layout {
  const next = detach(l, id);
  const z = Math.max(0, ...l.floating.map((f) => f.z)) + 1;
  return unhide({ ...next, floating: [...next.floating, { id, ...rect, z }] }, id);
}
