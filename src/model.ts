// 資料的「形狀」定義在這裡：之後存讀檔也照這個格式

// 左側的四個區塊
export type SectionId = 'files' | 'characters' | 'world' | 'commands';
// 除了「檔案」以外，其他區塊裝的都是設定卡
export type CardSectionId = Exclude<SectionId, 'files'>;

// 設定卡的一個欄位，例如 年齡：不詳
// collapsed = true 時，側邊欄只顯示欄位名稱，點了才展開內容
export interface Field {
  key: string;
  value: string;
  collapsed?: boolean;
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
}
// 一個區塊的範本：nameParam = 卡片「名稱」本身也可以當指令參數（例如角色名稱 → [名字]）；fields = 一定要有的欄位
export interface SectionSchema {
  nameParam?: string;
  fields: SchemaField[];
}
export type Schemas = Record<CardSectionId, SectionSchema>;
// 欄位設定視窗交回來的結果：from = 這個欄位原本的名稱（新加的沒有），用來把舊卡片上的欄位跟著改名
export type SchemaEdit = SchemaField & { from?: string };

// 新專案（或舊專案沒有範本時）的預設範本：指令卡的名稱就是指令格式，另外固定有「用法」（多種寫法時一行一種）和「說明」
export const defaultSchemas = (): Schemas => ({
  characters: { fields: [] },
  world: { fields: [] },
  commands: { fields: [{ key: '用法' }, { key: '說明' }] },
});

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

// 分頁 id：劇本直接用檔案 id；設定卡用 "card:區塊:卡片id"
export const cardTabId = (section: CardSectionId, id: string) => `card:${section}:${id}`;
export const parseCardTab = (tabId: string) => {
  if (!tabId.startsWith('card:')) return null;
  const [, section, id] = tabId.split(':');
  return { section: section as CardSectionId, id };
};
