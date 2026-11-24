// 欄位分類：範本欄位可以設「分類」，卡片上同分類的欄位放在同一個分頁，用切換的看；沒有分類的欄位固定顯示在分頁上面
import { useEffect, useState } from 'react';
import type { Field, SchemaField } from '../model';

// 欄位屬於哪個分類（卡片自己加的欄位、沒設分類的範本欄位 = ''）
export const groupOf = (schemaFields: SchemaField[], key: string) => schemaFields.find((s) => s.key === key)?.group?.trim() ?? '';

// 這張卡用到的分類，照欄位順序第一次出現的先後
export function groupsIn(fields: Field[], schemaFields: SchemaField[]): string[] {
  const out: string[] = [];
  for (const f of fields) {
    const g = groupOf(schemaFields, f.key);
    if (g && !out.includes(g)) out.push(g);
  }
  return out;
}

// 每個地方的每張卡各自記住上次看的分類，互不連動
// key 例如 'editor:<卡片分頁 id>'、'side:<卡片分頁 id>'、'viewer:<卡片分頁 id>'
const lastGroup = new Map<string, string>();
const GROUP_EVENT = 'vn-field-group';
export const groupKey = (place: 'editor' | 'side' | 'viewer', cardTab: string) => `${place}:${cardTab}`;

// 目前看的分類；記住的那個這張卡沒有時，看第一個
export function useFieldGroup(key: string, groups: string[]): [string, (g: string) => void] {
  const [picked, setPicked] = useState(() => lastGroup.get(key) ?? '');
  useEffect(() => setPicked(lastGroup.get(key) ?? ''), [key]);
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ key: string; group: string }>).detail;
      if (d.key === key) setPicked(d.group);
    };
    window.addEventListener(GROUP_EVENT, on);
    return () => window.removeEventListener(GROUP_EVENT, on);
  }, [key]);
  return [groups.includes(picked) ? picked : (groups[0] ?? ''), (g) => showFieldGroup(key, g)];
}

// 從外面切換某個地方的分類（搜尋跳到某個欄位時切卡片編輯頁）
export function showFieldGroup(key: string, group: string) {
  if (!group) return;
  lastGroup.set(key, group);
  window.dispatchEvent(new CustomEvent(GROUP_EVENT, { detail: { key, group } }));
}

// 這個欄位現在看不看得到：沒有分類的一律看得到
export const fieldShown = (schemaFields: SchemaField[], key: string, current: string) => {
  const g = groupOf(schemaFields, key);
  return !g || g === current;
};

export default function FieldGroupTabs({ groups, current, onPick, marked, className = '' }: {
  groups: string[];
  current: string;
  onPick: (g: string) => void;
  marked?: (group: string) => boolean; // 這個分類裡有別人（或 AI）改過的欄位：沒在看的分頁上畫黃點
  className?: string;
}) {
  if (groups.length === 0) return null;
  return (
    <div className={`field-group-tabs ${className}`}>
      {groups.map((g) => (
        <button
          key={g}
          type="button"
          className={g === current ? 'on' : ''}
          onClick={(e) => {
            e.stopPropagation(); // 側邊欄：不要觸發卡片的展開／收起
            onPick(g);
          }}
        >
          {g}
          {g !== current && marked?.(g) && <span className="ext-dot" title="有其他人的修改" />}
        </button>
      ))}
    </div>
  );
}
