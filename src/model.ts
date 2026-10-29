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
  add: (section: CardSectionId) => void;
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
