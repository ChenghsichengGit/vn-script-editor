// 左側的區塊：「檔案」（劇本）固定在最前面；其他都是設定卡區塊，清單存在 project.json 的 sections
// 「指令」也是設定卡區塊，但跟劇本語法綁在一起，不能刪、不能改名；其他（角色、世界觀、自己加的）都可以自訂
//
// 目前開著的專案的區塊清單放在這個模組裡（setCardSections 換掉），畫面各處用 sectionMeta(id) 讀
// App 換清單時也會更新自己的 state，畫面跟著重畫，所以讀到的永遠是最新的
import type { IconDef } from './components/Icon';
import { FIELD_COLORS, FIELD_ICONS } from './fieldIcons';
import type { CardSectionId, SectionId } from './model';

export interface SectionDef {
  id: string; // 不會變的識別碼：分頁 id、版面、欄位範本、清單順序都用它記（舊專案沿用 characters、world、commands）
  title: string; // 顯示的名稱
  dir: string; // 專案資料夾裡對應的資料夾名稱
  icon: string; // codicon 名稱
  color?: string; // 圖示顏色的名稱（fieldIcons.ts 的 FIELD_COLORS）；沒有 = 跟文字同色
  newName?: string; // 按 ＋ 時新卡片的預設名稱
}

export const COMMANDS_ID = 'commands';
export const FILES_SECTION: SectionDef = { id: 'files', title: '檔案', dir: '劇本', icon: 'files', color: 'blue' };

// 新專案、或舊專案的 project.json 裡還沒有 sections 時用的區塊
export const DEFAULT_CARD_SECTIONS: SectionDef[] = [
  { id: 'characters', title: '角色', dir: '角色', icon: 'person', color: 'green', newName: '新角色' },
  { id: 'world', title: '世界觀', dir: '世界觀', icon: 'globe', color: 'teal', newName: '新項目' },
  { id: COMMANDS_ID, title: '指令', dir: '指令', icon: 'terminal', color: 'purple', newName: '#新指令' },
];
const COMMANDS_DEF = DEFAULT_CARD_SECTIONS[2];

let cardSections: SectionDef[] = DEFAULT_CARD_SECTIONS;

export function setCardSections(list: SectionDef[]) {
  cardSections = list;
}
export const getCardSections = () => cardSections;

// 所有區塊（檔案在最前面），照活動列的順序
export const sectionOrder = (): SectionId[] => [FILES_SECTION.id, ...cardSections.map((s) => s.id)];
export const cardSectionIds = (): CardSectionId[] => cardSections.map((s) => s.id);
export const sectionDef = (id: SectionId): SectionDef | undefined =>
  id === FILES_SECTION.id ? FILES_SECTION : cardSections.find((s) => s.id === id);

export const colorVar = (color?: string) => (color ? `var(--pal-${color})` : undefined);

// 畫面要用的：標題、圖示（含顏色）、新項目預設名稱、資料夾名稱
// 認不得的 id（例如別的專案才有的區塊）給一個不會出錯的預設值
export function sectionMeta(id: SectionId): { title: string; icon: IconDef; newName?: string; dir: string } {
  const def = sectionDef(id) ?? { id, title: id, dir: id, icon: 'file' };
  return { title: def.title, icon: { name: def.icon, color: colorVar(def.color) }, newName: def.newName, dir: def.dir };
}

const isIcon = (x: unknown): x is string => typeof x === 'string' && FIELD_ICONS.some(([n]) => n === x);
const isColor = (x: unknown): x is string => typeof x === 'string' && FIELD_COLORS.some(([n]) => n === x);
const SECTION_ICONS = new Set(['person', 'globe', 'terminal', 'files']);

// project.json 的 sections 整理成合法的清單：認不得的丟掉、id 或資料夾重複的只留第一個；
// 一定有「指令」（缺了補在最後面，名稱、資料夾固定）；整個沒有就用預設
export function normalizeSections(raw: unknown): SectionDef[] {
  if (!Array.isArray(raw)) return DEFAULT_CARD_SECTIONS;
  const out: SectionDef[] = [];
  const ids = new Set<string>([FILES_SECTION.id]);
  const dirs = new Set<string>([FILES_SECTION.dir.toLowerCase()]);
  for (const s of raw) {
    if (!s || typeof s !== 'object') continue;
    const r = s as Record<string, unknown>;
    const id = typeof r.id === 'string' ? r.id.trim() : '';
    const title = typeof r.title === 'string' ? r.title.trim() : '';
    if (!id || !title || ids.has(id)) continue;
    const def: SectionDef =
      id === COMMANDS_ID
        ? { ...COMMANDS_DEF }
        : { id, title, dir: typeof r.dir === 'string' && r.dir.trim() ? r.dir.trim() : title, icon: 'tag' };
    if (dirs.has(def.dir.toLowerCase())) continue;
    if (isIcon(r.icon) || (typeof r.icon === 'string' && SECTION_ICONS.has(r.icon))) def.icon = r.icon as string;
    def.color = isColor(r.color) ? r.color : r.color === null ? undefined : def.color;
    if (id !== COMMANDS_ID && typeof r.newName === 'string' && r.newName.trim()) def.newName = r.newName.trim();
    ids.add(id);
    dirs.add(def.dir.toLowerCase());
    out.push(def);
  }
  if (!ids.has(COMMANDS_ID)) out.push({ ...COMMANDS_DEF });
  return out;
}
