// 詳細內容裡的卡片連結 [[名稱]]：記住目前有哪些卡片，讓連結知道要畫成哪個區塊的圖示、點了要開哪張卡
import { Card, CardSectionId } from './model';
import { findTargetCard } from './memories';
import { sectionMeta } from './sections';
import type { IconDef } from './components/Icon';

let cards: Record<CardSectionId, Card[]> = {} as Record<CardSectionId, Card[]>;
const listeners = new Set<() => void>();

export function setLinkCards(next: Record<CardSectionId, Card[]>) {
  cards = next;
  listeners.forEach((f) => f());
}

export function onLinkCardsChange(f: () => void) {
  listeners.add(f);
  return () => void listeners.delete(f);
}

export function resolveCardLink(name: string): { section: CardSectionId; id: string; icon: IconDef } | null {
  const first = Object.keys(cards)[0] as CardSectionId | undefined;
  if (!first) return null;
  const hit = findTargetCard(cards, name, first);
  return hit ? { section: hit.section, id: hit.card.id, icon: sectionMeta(hit.section).icon } : null;
}

// 點連結時打開那張卡（App 設定成放大檢視）
let opener: (section: CardSectionId, id: string) => void = () => undefined;
export const setLinkOpener = (f: typeof opener) => void (opener = f);
export function openLinkedCard(name: string) {
  const hit = resolveCardLink(name);
  if (hit) opener(hit.section, hit.id);
}

// 卡片改名：詳細內容裡的 [[舊名]] 換成 [[新名]]
export function renameCardLinks(markdown: string, from: string, to: string): string {
  if (!markdown.includes('[[')) return markdown;
  return markdown.split(`[[${from}]]`).join(`[[${to}]]`);
}
