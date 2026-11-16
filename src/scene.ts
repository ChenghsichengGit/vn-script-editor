// 「本場」區塊：目前劇本用到的設定卡（指令參數裡出現的卡片名稱、記憶出處是這個劇本的卡）＋手動固定的卡
import type { Card, CardSectionId, Scenes } from './model';
import { COMMANDS_ID, cardSectionIds } from './sections';

export interface SceneItem {
  section: CardSectionId;
  card: Card;
  pinned: boolean;
}

export interface SceneInfo {
  path: string; // 目前劇本（相對於「劇本/」），'' = 還沒打開劇本
  items: SceneItem[];
  isPinned: (name: string) => boolean;
  togglePin: (name: string) => void;
}

const codeOf = (line: string) => {
  const i = line.indexOf('//');
  return i < 0 ? line : line.slice(0, i);
};

export function sceneItems(text: string, path: string, cards: Record<CardSectionId, Card[]>, scenes: Scenes): SceneItem[] {
  if (!path) return [];
  const sections = cardSectionIds();
  const byName = new Map<string, { section: CardSectionId; card: Card }[]>();
  for (const section of sections) {
    if (section === COMMANDS_ID) continue;
    for (const card of cards[section] ?? []) {
      const name = card.name.trim();
      if (name) byName.set(name, [...(byName.get(name) ?? []), { section, card }]);
    }
  }
  const out: SceneItem[] = [];
  const seen = new Set<string>();
  const add = (section: CardSectionId, card: Card, pinned: boolean) => {
    const key = `${section}:${card.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ section, card, pinned });
  };
  for (const name of scenes[path] ?? []) for (const hit of byName.get(name) ?? []) add(hit.section, hit.card, true);
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*#\S+\s+(.*)$/.exec(codeOf(line));
    if (!m) continue;
    for (const word of m[1].split(/\s+/)) for (const hit of byName.get(word) ?? []) add(hit.section, hit.card, false);
  }
  for (const section of sections) {
    if (section === COMMANDS_ID) continue;
    for (const card of cards[section] ?? []) if (card.memories?.some((m) => m.source === path)) add(section, card, false);
  }
  // 照區塊分組（區塊的順序），同一組裡固定的在前、其他照出現的先後
  const rank = (s: CardSectionId) => sections.indexOf(s);
  return out.map((it, i) => ({ it, i })).sort((a, b) => rank(a.it.section) - rank(b.it.section) || Number(b.it.pinned) - Number(a.it.pinned) || a.i - b.i).map((x) => x.it);
}

// 劇本改名或搬走：固定清單的 key 跟著換（isFolder = 整個資料夾搬走）
export function remapScenePaths(scenes: Scenes, from: string, to: string, isFolder: boolean): Scenes {
  let changed = false;
  const out: Scenes = {};
  for (const [path, names] of Object.entries(scenes)) {
    const hit = isFolder ? path.startsWith(from + '/') : path === from;
    const next = hit ? (isFolder ? to + path.slice(from.length) : to) : path;
    if (hit) changed = true;
    out[next] = [...new Set([...(out[next] ?? []), ...names])];
  }
  return changed ? out : scenes;
}

// 卡片改名：固定清單裡的名稱跟著換
export function renameInScenes(scenes: Scenes, from: string, to: string): Scenes {
  let changed = false;
  const out: Scenes = {};
  for (const [path, names] of Object.entries(scenes)) {
    out[path] = names.includes(from) ? ((changed = true), [...new Set(names.map((n) => (n === from ? to : n)))]) : names;
  }
  return changed ? out : scenes;
}
