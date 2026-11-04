// 欄位設定裡，每個欄位可以選的圖示和顏色
// 顏色存的是名稱（例如 'blue'），畫的時候換成 styles.css 的 --pal-blue：深色、淺色、高對比各有一組，每個主題都看得清楚
import type { IconDef } from './components/Icon';

// [codicon 名稱, 說明]（codicon 的編號登記在 icons.css）
export const FIELD_ICONS: [string, string][] = [
  ['tag', '標籤'],
  ['person', '人物'],
  ['account', '頭像'],
  ['organization', '團體'],
  ['heart', '喜好'],
  ['star-full', '星星'],
  ['smiley', '個性'],
  ['eye', '外表'],
  ['comment', '對話'],
  ['quote', '台詞'],
  ['calendar', '日期'],
  ['watch', '時間'],
  ['location', '地點'],
  ['home', '住處'],
  ['globe', '世界'],
  ['book', '書'],
  ['note', '筆記'],
  ['bookmark', '書籤'],
  ['mortar-board', '學歷'],
  ['briefcase', '職業'],
  ['law', '規則'],
  ['shield', '能力'],
  ['flame', '火焰'],
  ['zap', '閃電'],
  ['sparkle', '特殊'],
  ['lightbulb', '想法'],
  ['key', '關鍵'],
  ['link', '關係'],
  ['pin', '重點'],
  ['gift', '物品'],
  ['music', '音樂'],
  ['symbol-color', '顏色'],
  ['rocket', '目標'],
  ['beaker', '設定'],
];

export const FIELD_COLORS: [string, string][] = [
  ['red', '紅'],
  ['orange', '橙'],
  ['yellow', '黃'],
  ['green', '綠'],
  ['teal', '青'],
  ['blue', '藍'],
  ['purple', '紫'],
  ['gray', '灰'],
];

const isColor = (c: unknown): c is string => typeof c === 'string' && FIELD_COLORS.some(([id]) => id === c);
const isIcon = (i: unknown): i is string => typeof i === 'string' && FIELD_ICONS.some(([id]) => id === i);

// 讀檔時：認不得的圖示或顏色就當沒設定
export const cleanFieldIcon = (icon: unknown) => (isIcon(icon) ? icon : undefined);
export const cleanFieldColor = (color: unknown) => (isColor(color) ? color : undefined);

// 畫出來用的 IconDef；沒設定圖示回傳 null
export function fieldIconDef(f: { icon?: string; color?: string } | undefined): IconDef | null {
  if (!f?.icon) return null;
  return { name: f.icon, color: f.color ? `var(--pal-${f.color})` : undefined };
}
