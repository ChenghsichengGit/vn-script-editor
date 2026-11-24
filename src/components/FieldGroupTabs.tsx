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

const lastGroup = new Map<string, string>(); // 區塊 → 上次看的分類（卡片編輯頁、放大檢視、側邊欄共用）
const GROUP_EVENT = 'vn-field-group';

// 目前看的分類；記住的那個這張卡沒有時，看第一個
export function useFieldGroup(section: string, groups: string[]): [string, (g: string) => void] {
  const [picked, setPicked] = useState(() => lastGroup.get(section) ?? '');
  useEffect(() => setPicked(lastGroup.get(section) ?? ''), [section]);
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ section: string; group: string }>).detail;
      if (d.section === section) setPicked(d.group);
    };
    window.addEventListener(GROUP_EVENT, on);
    return () => window.removeEventListener(GROUP_EVENT, on);
  }, [section]);
  return [groups.includes(picked) ? picked : (groups[0] ?? ''), (g) => showFieldGroup(section, g)]; // 同一個區塊開著的卡一起切換
}

// 從外面切換分類（搜尋跳到某個欄位、AI 改了某個欄位時）
export function showFieldGroup(section: string, group: string) {
  if (!group) return;
  lastGroup.set(section, group);
  window.dispatchEvent(new CustomEvent(GROUP_EVENT, { detail: { section, group } }));
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
