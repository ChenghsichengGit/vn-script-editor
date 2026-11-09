// 資料的「形狀」定義在這裡：之後存讀檔也照這個格式

export type SectionId = string;
export type CardSectionId = string;

export interface Field {
  key: string;
  value: string;
  collapsed?: boolean;
  type?: 'image'; // 卡片自己加的欄位的類型：沒有 = 文字；image = 圖片（範本欄位的類型看範本，不看這裡）
}

export const MEMORY_KINDS = ['事件', '稱呼', '印象'] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];
export interface Memory {
  time: string; // 故事裡的日期，格式隨意（例如 4/12）；只是顯示用，不拿來排序
  target: string; // 對象：另一張卡的名稱（空字串 = 沒有特定對象）
  kind: MemoryKind;
  text: string;
  source: string; // 出處：劇本的路徑，相對於「劇本」資料夾（例如 第一章/序章.vns）；空字串 = 沒填
}

export interface Card {
  id: string;
  name: string;
  fields: Field[];
  detail: string;
  memories?: Memory[]; // 記憶（區塊設定裡勾了「記憶」的區塊才顯示；沒有 = 空）
  folder?: string; // 所在子資料夾（相對於該區塊，用 "/" 分隔；沒有或空字串 = 區塊根目錄）。由檔案位置決定，不存進 YAML
}

export interface SchemaField {
  key: string;
  param?: string;
  icon?: string; // 欄位名稱前面的圖示（codicon 名稱，可選的列在 fieldIcons.ts）；沒有 = 不畫
  color?: string; // 圖示顏色的名稱（red、blue…）；沒有 = 跟文字同色
  type?: 'image'; // 欄位類型：沒有 = 文字；image = 圖片（內容存圖片的相對路徑，例如 圖片/立繪.png）
  collapsed?: boolean; // 新卡片（或新補上的欄位）預設摺疊；不影響已有的欄位
}
export interface SectionSchema {
  nameParam?: string;
  fields: SchemaField[];
}
export type Schemas = Record<CardSectionId, SectionSchema>;
export type SchemaEdit = SchemaField & { from?: string };
export interface FieldRemoval {
  key: string; // 卡片上目前的欄位名稱
  mode: 'empty' | 'all';
}

export const defaultSchema = (section: CardSectionId): SectionSchema =>
  section === 'commands' ? { fields: [{ key: '用法' }, { key: '說明' }] } : { fields: [] };
export const defaultSchemas = (ids: CardSectionId[]): Schemas => Object.fromEntries(ids.map((id) => [id, defaultSchema(id)]));
export const perSection = <T>(ids: string[], make: () => T): Record<string, T> => Object.fromEntries(ids.map((id) => [id, make()]));

export function applySchema(fields: Field[], schema: SchemaField[]): Field[] {
  const head = schema.map((s) => fields.find((f) => f.key === s.key) ?? { key: s.key, value: '', ...(s.collapsed && { collapsed: true }) });
  const rest = fields.filter((f) => !schema.some((s) => s.key === f.key));
  return [...head, ...rest];
}

export type ItemOrder = Partial<Record<SectionId, Record<string, string[]>>>;

export const folderOrderKey = (folderPath: string) => folderPath.slice(folderPath.lastIndexOf('/') + 1) + '/';

export type TreeEntry<T> = { kind: 'folder'; folder: string } | { kind: 'item'; item: T };

export function orderEntries<T>(subFolders: string[], items: T[], nameOf: (item: T) => string, list: string[] | undefined): TreeEntry<T>[] {
  const byName = (a: string, b: string) => a.localeCompare(b, 'zh-Hant');
  const entries: { entry: TreeEntry<T>; key: string; isFolder: boolean }[] = [
    ...subFolders.map((folder) => ({ entry: { kind: 'folder' as const, folder }, key: folderOrderKey(folder), isFolder: true })),
    ...items.map((item) => ({ entry: { kind: 'item' as const, item }, key: nameOf(item), isFolder: false })),
  ];
  const rank = (e: (typeof entries)[number]) => {
    const i = list ? list.indexOf(e.key) : -1;
    if (i >= 0) return i;
    return e.isFolder ? -Infinity : Infinity;
  };
  return entries.sort((a, b) => rank(a) - rank(b) || byName(a.key, b.key)).map((e) => e.entry);
}

export interface CardOps {
  open: (section: CardSectionId, id: string) => void;
  add: (section: CardSectionId, folder: string, name: string) => string | null;
  rename: (section: CardSectionId, id: string, name: string) => string | null;
  update: (section: CardSectionId, id: string, patch: Partial<Card>) => void;
  remove: (section: CardSectionId, id: string) => void;
}

export const SAVE_ALL_EVENT = 'vn-save-all';

export const cardTabId = (section: CardSectionId, id: string) => `card:${section}:${id}`;
export const parseCardTab = (tabId: string) => {
  if (!tabId.startsWith('card:')) return null;
  const [, section, id] = tabId.split(':');
  return { section: section as CardSectionId, id };
};
