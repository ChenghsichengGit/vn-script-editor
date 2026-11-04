// 把整個專案組成一份 Markdown 文字：給網頁版 AI（ChatGPT、Claude 網頁版等）一次貼上或上傳
// 內容：AI說明（語法和指令規格）→ 角色／世界觀／指令的每張設定卡 → 所有劇本（照左側清單的資料夾和順序）
import { buildAiGuide } from './aiGuide';
import { Card, CardSectionId, ItemOrder, Schemas, SectionId, sortByOrder } from './model';
import { parentFolder, folderBase } from './projectFiles';
import { sectionMeta } from './sampleData';

export interface ExportInput {
  name: string;
  files: Record<string, { name: string; folder: string }>;
  contents: Record<string, string>;
  cards: Record<CardSectionId, Card[]>;
  folders: Record<SectionId, string[]>;
  order: ItemOrder;
  schemas: Schemas;
}

const byName = (a: string, b: string) => a.localeCompare(b, 'zh-Hant');

// 用 ``` 把內容包起來；內容裡本身有 ``` 時，外框用更長的反引號，才不會被提早結束
function fence(text: string, lang = ''): string {
  const longest = Math.max(2, ...(text.match(/`{3,}/g) ?? []).map((s) => s.length));
  const bar = '`'.repeat(longest + 1);
  return `${bar}${lang}\n${text.replace(/\s+$/, '')}\n${bar}`;
}

// 跟左側清單一樣的順序走過一個區塊：先子資料夾（依名稱）遞迴，再這一層的項目（依自訂順序）
function walk<T>(
  section: SectionId,
  input: ExportInput,
  itemsIn: (folder: string) => T[],
  nameOf: (item: T) => string,
  visit: (item: T, folder: string) => void,
  folder = '',
) {
  const subs = input.folders[section].filter((f) => parentFolder(f) === folder).sort((a, b) => byName(folderBase(a), folderBase(b)));
  for (const sub of subs) walk(section, input, itemsIn, nameOf, visit, sub);
  for (const item of sortByOrder(itemsIn(folder), nameOf, input.order[section]?.[folder])) visit(item, folder);
}

const SECTIONS: CardSectionId[] = ['characters', 'world', 'commands'];

export function buildProjectExport(input: ExportInput): string {
  const out: string[] = [];
  const push = (...lines: string[]) => out.push(...lines);

  push(`# 專案「${input.name}」完整內容`, '');
  push('> 這份文字由 VN Script Editor 匯出，包含整個專案：先是寫作規則（劇本語法、目前的指令），再來是所有設定卡和劇本。');
  push('> 引用時請用「劇本：路徑」或「角色：名稱」指出是哪一份。', '');

  // 1. 規則：直接用 AI說明.md 的內容，標題降一級放進來
  push('## 寫作規則', '');
  // 拿掉它自己的大標題和開頭那段「這個檔案自動產生、不要手動改」的說明（那是寫給檔案用的）
  const lines = buildAiGuide(input.name, input.cards, input.schemas).split('\n');
  const guide = lines.slice(lines.findIndex((l, i) => i > 0 && l.startsWith('## ')));
  push(...guide.map((l) => (/^#{1,5} /.test(l) ? `#${l}` : l)), '');

  // 2. 設定卡
  for (const section of SECTIONS) {
    const title = sectionMeta[section].title;
    push(`## ${title}`, '');
    const before = out.length;
    walk(
      section,
      input,
      (folder) => input.cards[section].filter((c) => (c.folder ?? '') === folder),
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
        const detail = card.detail.trim();
        // 詳細內容裡的標題降三級，才不會跟外面的章節搞混
        if (detail) push(...detail.split(/\r?\n/).map((l) => (/^#{1,3} /.test(l) ? `###${l}` : l)), '');
      },
    );
    if (out.length === before) push('（沒有）', '');
  }

  // 3. 劇本
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

// 存檔視窗的預設檔名
export const exportFileName = (projectName: string) => `${projectName}_完整內容.md`;
