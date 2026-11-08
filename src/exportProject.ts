// 把整個專案組成一份 Markdown 文字：給網頁版 AI（ChatGPT、Claude 網頁版等）一次貼上或上傳
import { buildAiGuide } from './aiGuide';
import { Card, CardSectionId, ItemOrder, Schemas, SectionId, orderEntries } from './model';
import { parentFolder } from './projectFiles';
import { cardSectionIds, sectionMeta } from './sections';
import { sourceLabel } from './memories';

export interface ExportInput {
  name: string;
  files: Record<string, { name: string; folder: string }>;
  contents: Record<string, string>;
  cards: Record<CardSectionId, Card[]>;
  folders: Record<SectionId, string[]>;
  order: ItemOrder;
  schemas: Schemas;
}

function fence(text: string, lang = ''): string {
  const longest = Math.max(2, ...(text.match(/`{3,}/g) ?? []).map((s) => s.length));
  const bar = '`'.repeat(longest + 1);
  return `${bar}${lang}\n${text.replace(/\s+$/, '')}\n${bar}`;
}

function walk<T>(
  section: SectionId,
  input: ExportInput,
  itemsIn: (folder: string) => T[],
  nameOf: (item: T) => string,
  visit: (item: T, folder: string) => void,
  folder = '',
) {
  const subs = input.folders[section].filter((f) => parentFolder(f) === folder);
  for (const e of orderEntries(subs, itemsIn(folder), nameOf, input.order[section]?.[folder])) {
    if (e.kind === 'folder') walk(section, input, itemsIn, nameOf, visit, e.folder);
    else visit(e.item, folder);
  }
}

export function buildProjectExport(input: ExportInput): string {
  const out: string[] = [];
  const push = (...lines: string[]) => out.push(...lines);
  push(`# 專案「${input.name}」完整內容`, '');
  push('> 這份文字由 VN Script Editor 匯出，包含整個專案：先是寫作規則（劇本語法、目前的指令），再來是所有設定卡和劇本。');
  push('> 引用時請用「劇本：路徑」或「角色：名稱」指出是哪一份。', '');
  push('## 寫作規則', '');
  const lines = buildAiGuide(input.name, input.cards, input.schemas).split('\n');
  const guide = lines.slice(lines.findIndex((l, i) => i > 0 && l.startsWith('## ')));
  push(...guide.map((l) => (/^#{1,5} /.test(l) ? `#${l}` : l)), '');
  for (const section of cardSectionIds()) {
    const title = sectionMeta(section).title;
    push(`## ${title}`, '');
    const before = out.length;
    walk(
      section,
      input,
      (folder) => (input.cards[section] ?? []).filter((c) => (c.folder ?? '') === folder),
      (c) => c.name,
      (card, folder) => {
        push(`### ${folder ? `${folder}/` : ''}${card.name || '（未命名）'}`, '');
        for (const f of card.fields) {
          const value = f.value.trim();
          if (!value) push(`- **${f.key}**：`);
          else if (!value.includes('\n')) push(`- **${f.key}**：${value}`);
          else push(`- **${f.key}**：`, ...value.split(/\r?\n/).map((l) => `  ${l}`));
        }
        if (card.fields.length > 0) push('');
        if (card.memories?.length) {
          push('記憶（由先到後）：');
          for (const m of card.memories) {
            const head = [m.time, m.target && `對${m.target}`, m.kind].filter(Boolean).join('・');
            push(`- ${head}：${m.text}${m.source ? `（${sourceLabel(m.source)}）` : ''}`);
          }
          push('');
        }
        const detail = card.detail.trim();
        if (detail) push(...detail.split(/\r?\n/).map((l) => (/^#{1,3} /.test(l) ? `###${l}` : l)), '');
      },
    );
    if (out.length === before) push('（沒有）', '');
  }
  push('## 劇本', '');
  const before = out.length;
  walk(
    'files',
    input,
    (folder) => Object.entries(input.files).filter(([, f]) => f.folder === folder),
    ([, f]) => f.name,
    ([id, f], folder) => {
      const ext = f.name.slice(f.name.lastIndexOf('.') + 1).toLowerCase();
      push(`### 劇本：${folder ? `${folder}/` : ''}${f.name}`, '');
      push(fence(input.contents[id] ?? '', ext === 'md' ? 'markdown' : ext === 'vns' ? 'vns' : ''), '');
    },
  );
  if (out.length === before) push('（沒有）', '');
  return out.join('\n');
}

export const exportFileName = (projectName: string) => `${projectName}_完整內容.md`;
