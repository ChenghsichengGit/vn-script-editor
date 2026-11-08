// 角色記憶的共用小工具：出處（劇本路徑）、「看到哪裡」的切點、關係表、改名時跟著改
import type { Card, CardSectionId, Memory } from './model';
import type { IconDef } from './components/Icon';
import { sectionMeta } from './sections';

export const scriptPath = (f: { name: string; folder: string }) => (f.folder ? `${f.folder}/${f.name}` : f.name);
export const sourceLabel = (source: string) => source.slice(source.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');

export function cutOptions(list: Memory[]): string[] {
  const out: string[] = [];
  for (const m of list) if (m.source && !out.includes(m.source)) out.push(m.source);
  return out;
}

export function memoriesUntil(list: Memory[], cut: string): Memory[] {
  if (!cut) return list;
  let last = -1;
  list.forEach((m, i) => {
    if (m.source === cut) last = i;
  });
  return last < 0 ? list : list.slice(0, last + 1);
}

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

export const memoryMarkKey = (m: Memory) => '__mem:' + JSON.stringify([m.time, m.target, m.kind, m.text, m.source]);

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

export function targetIcon(cards: Record<CardSectionId, Card[]>, name: string, prefer: CardSectionId): IconDef | undefined {
  const hit = findTargetCard(cards, name, prefer);
  return hit ? sectionMeta(hit.section).icon : undefined;
}

export const relationSummary = (r: Relation) => r.name?.text || r.impression?.text || r.first.text;

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
