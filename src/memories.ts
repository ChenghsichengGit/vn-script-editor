// 角色記憶的共用小工具：出處（劇本路徑）、「看到哪裡」的切點、關係表、改名時跟著改
import type { Card, CardSectionId, Memory } from './model';
import type { IconDef } from './components/Icon';
import { sectionMeta } from './sections';

// 劇本在「劇本」資料夾裡的路徑（記憶的出處用這個記）
export const scriptPath = (f: { name: string; folder: string }) => (f.folder ? `${f.folder}/${f.name}` : f.name);
// 出處顯示的名稱：檔名去掉副檔名
export const sourceLabel = (source: string) => source.slice(source.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');

// 「看到」可以選的切點：出處依第一次出現的順序排（清單順序就是時間順序）
export function cutOptions(list: Memory[]): string[] {
  const out: string[] = [];
  for (const m of list) if (m.source && !out.includes(m.source)) out.push(m.source);
  return out;
}

// 看到 cut（某個出處）時的記憶：從頭算到最後一筆出處是 cut 的為止；cut 是空的 = 全部
export function memoriesUntil(list: Memory[], cut: string): Memory[] {
  if (!cut) return list;
  let last = -1;
  list.forEach((m, i) => {
    if (m.source === cut) last = i;
  });
  return last < 0 ? list : list.slice(0, last + 1);
}

// 關係表：每個對象一列（照第一次出現的順序），稱呼、印象取最後一筆，「認識於」取第一筆
export interface Relation {
  target: string;
  name?: Memory;
  impression?: Memory;
  first: Memory;
}
export function relations(list: Memory[]): Relation[] {
  const map = new Map<string, Relation>();
  for (const m of list) {
    if (!m.target.trim()) continue;
    const r = map.get(m.target) ?? { target: m.target, first: m };
    if (m.kind === '稱呼') r.name = m;
    if (m.kind === '印象') r.impression = m;
    map.set(m.target, r);
  }
  return [...map.values()];
}

// 「外部修改」標記用：一筆記憶的內容當作它的名字
export const memoryMarkKey = (m: Memory) => '__mem:' + JSON.stringify([m.time, m.target, m.kind, m.text, m.source]);

// 對象名稱 → 那張卡（先找同一個區塊，再找其他區塊）
export function findTargetCard(
  cards: Record<CardSectionId, Card[]>,
  name: string,
  prefer: CardSectionId,
): { section: CardSectionId; card: Card } | null {
  const key = name.trim();
  if (!key) return null;
  const order = [prefer, ...Object.keys(cards).filter((s) => s !== prefer)];
  for (const section of order) {
    const card = cards[section]?.find((c) => c.name === key);
    if (card) return { section, card };
  }
  return null;
}

// 對象前面的圖示：對得上卡片就用那張卡所在區塊的圖示（人物、地點、物品…），對不上回傳 undefined
export function targetIcon(cards: Record<CardSectionId, Card[]>, name: string, prefer: CardSectionId): IconDef | undefined {
  const hit = findTargetCard(cards, name, prefer);
  return hit ? sectionMeta(hit.section).icon : undefined;
}

// 關係表／側邊欄摘要一個對象只寫一句：最後的稱呼，沒有就最後的印象，再沒有就第一筆的內容
export const relationSummary = (r: Relation) => r.name?.text || r.impression?.text || r.first.text;

// 所有卡片的記憶套用 change；回傳有改到的卡（區塊 + id），沒改到的保持原本的物件
export function remapMemories(
  cards: Record<CardSectionId, Card[]>,
  change: (m: Memory) => Memory,
): { cards: Record<CardSectionId, Card[]>; changed: { section: CardSectionId; id: string }[] } {
  const changed: { section: CardSectionId; id: string }[] = [];
  const next = Object.fromEntries(
    Object.entries(cards).map(([section, list]) => [
      section,
      list.map((c) => {
        if (!c.memories?.length) return c;
        let hit = false;
        const memories = c.memories.map((m) => {
          const n = change(m);
          if (n.target !== m.target || n.source !== m.source) hit = true;
          return n;
        });
        if (!hit) return c;
        changed.push({ section, id: c.id });
        return { ...c, memories };
      }),
    ]),
  );
  return { cards: next, changed };
}
