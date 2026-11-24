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
  folded: SectionId[]; // 摺疊成只剩標題列的區塊（在側邊欄裡）
  leftCollapsed: boolean; // 左側欄整排收起來（裡面的區塊、高度都照樣保留，打開時一模一樣）
  problemsOpen: boolean; // 編輯區下方的面板（問題 Ctrl+Shift+M／搜尋 Ctrl+Shift+F）開著沒（名稱沿用舊的，才讀得到舊設定）
  problemsHeight: number;
  panelTab: 'problems' | 'search'; // 下方面板顯示哪個分頁
  // 疊成標籤的區塊：key = 佔位的區塊（它的 id 放在側邊欄清單或浮動視窗裡），值 = 這一疊所有的區塊（標籤順序，含佔位的）
  tabs: Partial<Record<SectionId, SectionId[]>>;
  current: Partial<Record<SectionId, SectionId>>; // 每一疊目前顯示哪個標籤
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
  folded: [],
  leftCollapsed: false,
  problemsOpen: false,
  problemsHeight: 180,
  panelTab: 'problems',
  tabs: {},
  current: {},
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
  // 疊成標籤：佔位的區塊要在清單或浮動視窗裡，其他成員不能在別的地方出現過
  const tabs: Layout['tabs'] = {};
  const current: Layout['current'] = {};
  const hosts = new Set(seen);
  for (const [host, list] of Object.entries(r.tabs && typeof r.tabs === 'object' ? r.tabs : {})) {
    if (!hosts.has(host) || !Array.isArray(list)) continue;
    const members = [host, ...list.filter((s: unknown): s is SectionId => isSection(s) && s !== host && !seen.has(s))];
    members.slice(1).forEach((s) => seen.add(s));
    const ordered = list.filter((s: unknown) => members.includes(s as SectionId)) as SectionId[];
    if (!ordered.includes(host)) ordered.unshift(host);
    if (ordered.length < 2) continue;
    tabs[host] = ordered;
    const cur = r.current?.[host];
    if (isSection(cur) && ordered.includes(cur)) current[host] = cur;
  }
  for (const id of sectionOrder()) if (!seen.has(id)) left.push(id); // 漏掉的補回左邊
  return {
    left: { sections: left, width: clampWidth(num(r.left.width, 300)) },
    right: { sections: right, width: clampWidth(num(r.right?.width, 300)) },
    floating,
    hidden: [...new Set(Array.isArray(r.hidden) ? r.hidden.filter(isSection) : [])] as SectionId[],
    sizes,
    folded: [...new Set(Array.isArray(r.folded) ? r.folded.filter(isSection) : [])] as SectionId[],
    leftCollapsed: r.leftCollapsed === true,
    problemsOpen: r.problemsOpen === true,
    problemsHeight: Math.min(600, Math.max(80, num(r.problemsHeight, 180))),
    panelTab: r.panelTab === 'search' ? 'search' : 'problems',
    tabs,
    current,
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

// ── 疊成標籤 ──
export const membersOf = (l: Layout, host: SectionId): SectionId[] => l.tabs[host] ?? [host];
export const hostOf = (l: Layout, id: SectionId): SectionId => (Object.keys(l.tabs).find((h) => l.tabs[h]!.includes(id)) as SectionId | undefined) ?? id;
const withoutKey = <T>(rec: Partial<Record<SectionId, T>>, key: SectionId) => {
  const next = { ...rec };
  delete next[key];
  return next;
};
// 把一個區塊從它那一疊拿出來（變成沒有放在任何地方，接著要 dock／float／疊到別處）
// 拿走的是佔位的區塊時，由下一個成員接手它的位置、高度
export function unstack(l: Layout, id: SectionId): Layout {
  const host = hostOf(l, id);
  const list = l.tabs[host];
  if (!list) return l;
  const rest = list.filter((s) => s !== id);
  const nextCur = l.current[host] === id ? undefined : l.current[host];
  if (id !== host) {
    const tabs = rest.length > 1 ? { ...l.tabs, [host]: rest } : withoutKey(l.tabs, host);
    const current = rest.length > 1 && nextCur ? { ...l.current, [host]: nextCur } : withoutKey(l.current, host);
    return { ...l, tabs, current };
  }
  const heir = rest[0];
  const swap = (s: SectionId) => (s === host ? heir : s);
  let tabs = withoutKey(l.tabs, host);
  let current = withoutKey(l.current, host);
  if (rest.length > 1) {
    tabs = { ...tabs, [heir]: rest };
    if (nextCur) current = { ...current, [heir]: nextCur };
  }
  const sizes = { ...l.sizes };
  if (sizes[host] !== undefined) sizes[heir] = sizes[host];
  return {
    ...l,
    left: { ...l.left, sections: l.left.sections.map(swap) },
    right: { ...l.right, sections: l.right.sections.map(swap) },
    floating: l.floating.map((f) => (f.id === host ? { ...f, id: heir } : f)),
    tabs,
    current,
    sizes,
  };
}
// 疊到 host 那一疊，插在 before 這個標籤前面（null = 最後）；whole = 拖的是整疊（標題列空白處），整疊一起併過去
export function stackSection(l: Layout, id: SectionId, host: SectionId, before: SectionId | null, whole: boolean): Layout {
  const insert = (list: SectionId[], items: SectionId[]) => {
    const at = before ? list.indexOf(before) : -1;
    list.splice(at < 0 ? list.length : at, 0, ...items);
    return list;
  };
  if (hostOf(l, id) === host && !whole) {
    const list = insert(membersOf(l, host).filter((s) => s !== id), [id]);
    return { ...l, tabs: { ...l.tabs, [host]: list }, current: { ...l.current, [host]: id } };
  }
  let next: Layout;
  let moving: SectionId[];
  if (whole) {
    moving = membersOf(l, id);
    next = { ...detach(l, id), tabs: withoutKey(l.tabs, id), current: withoutKey(l.current, id) };
  } else {
    moving = [id];
    next = unstack(l, id);
    next = detach(next, id);
  }
  const list = insert(membersOf(next, host).filter((s) => !moving.includes(s)), moving);
  next ={ ...next, tabs: { ...next.tabs, [host]: list }, current: { ...next.current, [host]: id } };
  return moving.reduce(unhide, next);
}

export function reconcileLayout(l: Layout, ids: SectionId[]): Layout {
  const placed = new Set([...l.left.sections, ...l.right.sections, ...l.floating.map((f) => f.id), ...Object.values(l.tabs).flat()]);
  const missing = ids.filter((id) => !placed.has(id));
  return missing.length === 0 ? l : { ...l, left: { ...l.left, sections: [...l.left.sections, ...missing] } };
}
