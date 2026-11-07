// 資料的「形狀」定義在這裡：之後存讀檔也照這個格式

// 左側的區塊：'files'（劇本）固定，其他是設定卡區塊（角色、世界觀、指令、自己加的…），清單在 sections.ts
export type SectionId = string;
// 除了「檔案」以外，其他區塊裝的都是設定卡
export type CardSectionId = string;

// 設定卡的一個欄位，例如 年齡：不詳
// collapsed = true 時，側邊欄只顯示欄位名稱，點了才展開內容
export interface Field {
  key: string;
  value: string;
  collapsed?: boolean;
  type?: 'image'; // 卡片自己加的欄位的類型：沒有 = 文字；image = 圖片（範本欄位的類型看範本，不看這裡）
}

// 一張設定卡 = 名稱 + 條列欄位 + 一大段詳細內容（Markdown：# 大標題、## 中標題、### 小標題）
export interface Card {
  id: string;
  name: string;
  fields: Field[];
  detail: string;
  folder?: string; // 所在子資料夾（相對於該區塊，用 "/" 分隔；沒有或空字串 = 區塊根目錄）。由檔案位置決定，不存進 YAML
}

// 欄位範本的一個欄位：這個區塊的每張卡都一定有這個欄位
// param 有填時，這個欄位的內容可以拿來當指令參數，例如 param = "名字" → 指令裡的 [名字] 可以選所有卡的這個欄位
export interface SchemaField {
  key: string;
  param?: string;
  icon?: string; // 欄位名稱前面的圖示（codicon 名稱，可選的列在 fieldIcons.ts）；沒有 = 不畫
  color?: string; // 圖示顏色的名稱（red、blue…）；沒有 = 跟文字同色
  type?: 'image'; // 欄位類型：沒有 = 文字；image = 圖片（內容存圖片的相對路徑，例如 圖片/立繪.png）
}
// 一個區塊的範本：nameParam = 卡片「名稱」本身也可以當指令參數（例如角色名稱 → [名字]）；fields = 一定要有的欄位
export interface SectionSchema {
  nameParam?: string;
  fields: SchemaField[];
}
export type Schemas = Record<CardSectionId, SectionSchema>;
// 欄位設定視窗交回來的結果：from = 這個欄位原本的名稱（新加的沒有），用來把舊卡片上的欄位跟著改名
export type SchemaEdit = SchemaField & { from?: string };
// 從範本刪掉欄位時，卡片上的這個欄位要怎麼處理：empty = 刪掉沒填內容的、all = 全部刪掉（只從範本移除就不用列）
export interface FieldRemoval {
  key: string; // 卡片上目前的欄位名稱
  mode: 'empty' | 'all';
}

// 某個區塊還沒有範本時的預設：指令卡固定有「用法」（多種寫法時一行一種）和「說明」，其他區塊沒有規定欄位
export const defaultSchema = (section: CardSectionId): SectionSchema =>
  section === 'commands' ? { fields: [{ key: '用法' }, { key: '說明' }] } : { fields: [] };
// 每個區塊都有一份範本（ids = 目前所有的設定卡區塊）
export const defaultSchemas = (ids: CardSectionId[]): Schemas => Object.fromEntries(ids.map((id) => [id, defaultSchema(id)]));
// 每個區塊一份空的東西（卡片清單、資料夾清單…）
export const perSection = <T>(ids: string[], make: () => T): Record<string, T> => Object.fromEntries(ids.map((id) => [id, make()]));

// 讓一張卡符合範本：範本欄位依範本順序排在最前面（已有的保留內容，缺的補空白），其他欄位接在後面
export function applySchema(fields: Field[], schema: SchemaField[]): Field[] {
  const head = schema.map((s) => fields.find((f) => f.key === s.key) ?? { key: s.key, value: '' });
  const rest = fields.filter((f) => !schema.some((s) => s.key === f.key));
  return [...head, ...rest];
}

// 左側清單的自訂順序：區塊 → 資料夾（'' = 根目錄）→ 項目名稱（劇本是檔名、設定卡是卡片名稱）依序排列
// 沒列在裡面的項目排在後面、照名稱排。存在 project.json
export type ItemOrder = Partial<Record<SectionId, Record<string, string[]>>>;

// 照自訂順序排：有在 list 裡的照 list 的順序，其他的接在後面照名稱排
export function sortByOrder<T>(items: T[], nameOf: (item: T) => string, list: string[] | undefined): T[] {
  const rank = (item: T) => {
    const i = list ? list.indexOf(nameOf(item)) : -1;
    return i < 0 ? Infinity : i;
  };
  return [...items].sort((a, b) => rank(a) - rank(b) || nameOf(a).localeCompare(nameOf(b), 'zh-Hant'));
}

// 資料夾和項目混在一起排：資料夾在順序清單裡記成「名稱/」（項目名稱不會以 / 結尾，所以不會撞名）
export const folderOrderKey = (folderPath: string) => folderPath.slice(folderPath.lastIndexOf('/') + 1) + '/';

export type TreeEntry<T> = { kind: 'folder'; folder: string } | { kind: 'item'; item: T };

// 某個資料夾裡要畫出來的東西（子資料夾 + 項目），照自訂順序混排
// 還沒排過的：資料夾放最前面、項目放最後面，各自照名稱排（舊專案的清單只有項目，畫出來會跟以前一樣「資料夾在上」）
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

// 檔案樹的一個節點。有 children 的可以摺疊；有 fileId 的點了會開分頁
export interface TreeNode {
  label: string;
  children?: TreeNode[];
  fileId?: string;
}

// 對設定卡能做的操作，由 App 實作、往下傳給需要的元件
export interface CardOps {
  open: (section: CardSectionId, id: string) => void;
  // 在 folder 底下新增名為 name 的卡；名稱不能用就回傳錯誤訊息，成功回傳 null
  add: (section: CardSectionId, folder: string, name: string) => string | null;
  // 改卡片名稱（同資料夾內不可重複），同樣以回傳值表示錯誤
  rename: (section: CardSectionId, id: string, name: string) => string | null;
  update: (section: CardSectionId, id: string, patch: Partial<Card>) => void;
  remove: (section: CardSectionId, id: string) => void;
}

// 劇本編輯器裡按 Ctrl+K S 時送到 window 的事件名稱：App 收到就全部存檔
export const SAVE_ALL_EVENT = 'vn-save-all';

// 分頁 id：劇本直接用檔案 id；設定卡用 "card:區塊:卡片id"
export const cardTabId = (section: CardSectionId, id: string) => `card:${section}:${id}`;
export const parseCardTab = (tabId: string) => {
  if (!tabId.startsWith('card:')) return null;
  const [, section, id] = tabId.split(':');
  return { section: section as CardSectionId, id };
};
