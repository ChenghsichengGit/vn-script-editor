// 整個專案的搜尋與取代（純函式，不碰畫面）：劇本全文，以及設定卡的名稱、欄位內容、詳細內容
// 一行一行找（跟 VS Code 一樣，找的字不會跨行）；取代也一行一行做，原本的換行（\r\n 或 \n）保持不變
import { Card, CardSectionId } from './model';

export interface SearchOptions {
  query: string;
  caseSensitive: boolean;
  regex: boolean;
}

// 被搜尋的一段文字在哪裡
export type SearchTarget =
  | { kind: 'file'; fileId: string }
  | { kind: 'card'; section: CardSectionId; cardId: string; part: 'name' | 'detail' | { field: number } };

export interface SearchMatch {
  line: number; // 第幾行（從 1 開始；設定卡的欄位、詳細內容各自從 1 算）
  start: number; // 這一行裡的位置（從 0 開始，以 JS 字串長度計）
  end: number;
  text: string; // 整行內容
}

// 一段文字裡的所有結果
export interface SearchHit {
  target: SearchTarget;
  label: string; // 顯示用：欄位名稱、「詳細內容」等（劇本沒有）
  readonly: boolean; // 卡片名稱只能找、不能取代（改名會連帶改檔名）
  matches: SearchMatch[];
}

// 一個檔案或一張卡的所有結果（面板上的一組）
export interface SearchGroup {
  key: string; // 劇本是檔案 id；設定卡是 card:區塊:id（跟分頁 id 一樣）
  kind: 'file' | 'card';
  section?: CardSectionId;
  name: string;
  folder: string;
  hits: SearchHit[];
  count: number;
}

export const MAX_RESULTS = 5000; // 太多就停，不然畫面會卡住

// 做出搜尋用的正規表示式；寫錯（例如括號沒關）回傳錯誤訊息
export function buildRegex(opts: SearchOptions): RegExp | string | null {
  if (!opts.query) return null;
  const source = opts.regex ? opts.query : opts.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  try {
    return new RegExp(source, opts.caseSensitive ? 'g' : 'gi');
  } catch (e) {
    return `正規表示式有誤：${e instanceof Error ? e.message : String(e)}`;
  }
}

// 把文字拆成行：保留每行後面的 \r，取代完原樣接回去
const splitLines = (text: string) => text.split('\n');
const stripCR = (line: string) => (line.endsWith('\r') ? line.slice(0, -1) : line);

function findInText(text: string, re: RegExp, budget: number): SearchMatch[] {
  const out: SearchMatch[] = [];
  const lines = splitLines(text);
  for (let i = 0; i < lines.length && out.length < budget; i++) {
    const line = stripCR(lines[i]);
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) && out.length < budget) {
      if (m[0].length === 0) {
        re.lastIndex++; // 找到空字串（例如 ^）：跳過，不然會一直停在原地
        continue;
      }
      out.push({ line: i + 1, start: m.index, end: m.index + m[0].length, text: line });
    }
  }
  return out;
}

export interface SearchInput {
  files: Record<string, { name: string; folder: string }>;
  contents: Record<string, string>;
  cards: Record<CardSectionId, Card[]>;
}

// 整個專案搜一遍；truncated = 超過上限，後面的沒有列出
export function searchProject(input: SearchInput, re: RegExp): { groups: SearchGroup[]; total: number; truncated: boolean } {
  const groups: SearchGroup[] = [];
  let total = 0;
  const add = (group: Omit<SearchGroup, 'hits' | 'count'>, parts: { target: SearchTarget; label: string; readonly?: boolean; text: string }[]) => {
    const hits: SearchHit[] = [];
    for (const p of parts) {
      if (total >= MAX_RESULTS) break;
      const matches = findInText(p.text, re, MAX_RESULTS - total);
      if (matches.length === 0) continue;
      total += matches.length;
      hits.push({ target: p.target, label: p.label, readonly: !!p.readonly, matches });
    }
    if (hits.length > 0) groups.push({ ...group, hits, count: hits.reduce((n, h) => n + h.matches.length, 0) });
  };

  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'zh-Hant');
  for (const [fileId, f] of Object.entries(input.files).sort(([, a], [, b]) => byName(a, b))) {
    add({ key: fileId, kind: 'file', name: f.name, folder: f.folder }, [
      { target: { kind: 'file', fileId }, label: '', text: input.contents[fileId] ?? '' },
    ]);
  }
  for (const section of Object.keys(input.cards) as CardSectionId[]) {
    for (const card of [...input.cards[section]].sort(byName)) {
      const t = (part: Extract<SearchTarget, { kind: 'card' }>['part']): SearchTarget => ({ kind: 'card', section, cardId: card.id, part });
      add({ key: `card:${section}:${card.id}`, kind: 'card', section, name: card.name || '（未命名）', folder: card.folder ?? '' }, [
        { target: t('name'), label: '名稱', readonly: true, text: card.name },
        ...card.fields.map((f, i) => ({ target: t({ field: i }), label: f.key, text: f.value })),
        { target: t('detail'), label: '詳細內容', text: card.detail },
      ]);
    }
  }
  return { groups, total, truncated: total >= MAX_RESULTS };
}

// 一個結果要換成什麼：正規表示式模式下 $1、$& 這些照 JS 的規則展開；一般模式下照字面
export function replacementFor(matchText: string, re: RegExp, replacement: string, regexMode: boolean): string {
  if (!regexMode) return replacement;
  const single = new RegExp(re.source, re.flags.replace('g', ''));
  return matchText.replace(single, replacement);
}

// 把一段文字裡所有符合的地方取代掉（一行一行做）；回傳新文字和取代了幾處
export function replaceAllInText(text: string, re: RegExp, replacement: string, regexMode: boolean): { text: string; count: number } {
  let count = 0;
  const lines = splitLines(text).map((raw) => {
    const cr = raw.endsWith('\r') ? '\r' : '';
    const line = stripCR(raw);
    re.lastIndex = 0;
    const next = line.replace(re, (...args) => {
      const m = args[0] as string;
      if (m.length === 0) return m;
      count++;
      return regexMode ? replacementFor(m, re, replacement, true) : replacement;
    });
    return next + cr;
  });
  return { text: lines.join('\n'), count };
}

// 只取代某一行的某一個結果（start/end 是搜尋當時的位置）；內容已經變了、對不上就回傳 null
export function replaceOneInText(text: string, match: SearchMatch, re: RegExp, replacement: string, regexMode: boolean): string | null {
  const lines = splitLines(text);
  const raw = lines[match.line - 1];
  if (raw === undefined) return null;
  const cr = raw.endsWith('\r') ? '\r' : '';
  const line = stripCR(raw);
  if (line !== match.text) return null;
  const found = line.slice(match.start, match.end);
  lines[match.line - 1] = line.slice(0, match.start) + replacementFor(found, re, replacement, regexMode) + line.slice(match.end) + cr;
  return lines.join('\n');
}
