// 「被別人（外部）改過的地方」的標記：一起寫的人存檔後，改到的地方用淡黃底標出來，直到按「清除標記」
//   劇本：改到的行（add）、刪掉東西的位置（del）
//   設定卡：改到的欄位（'__name' = 名稱）、詳細內容改到的區塊（最上層的第幾塊）
// 只記在記憶體裡，不存檔；關掉程式或專案就沒了
// 分不出是誰改的：AI 在程式外面改的也一樣會標
import { useSyncExternalStore } from 'react';
import { Editor as CoreEditor } from '@tiptap/core';
import monaco from './monaco';
import { diffLines, Hunk } from './aiPlayback';
import { getSettings } from './settings';
import { richExtensions } from './components/RichTextEditor';
import type { Card } from './model';

export interface LineMark {
  line: number; // 第幾行（從 1 開始）
  kind: 'add' | 'del'; // add = 這行是新加或改過的；del = 這行的前面有東西被刪掉
}
interface Entry {
  lines?: LineMark[];
  fields?: string[];
  blocks?: number[];
}

// key = 分頁 id（劇本 = 檔案 id；設定卡 = card:區塊:id）
const store = new Map<string, Entry>();
let version = 0;
const listeners = new Set<() => void>();
const emit = () => {
  version++;
  listeners.forEach((fn) => fn());
};
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
// 標記一變就重畫（側邊欄的圓點、分頁上方的提示條）
export const useChangeMarks = () => useSyncExternalStore(subscribe, () => version);

const enabled = () => getSettings().markExternal;
const isEmpty = (e?: Entry) => !e || ((e.lines?.length ?? 0) === 0 && (e.fields?.length ?? 0) === 0 && (e.blocks?.length ?? 0) === 0);

function update(key: string, patch: Partial<Entry>) {
  const next = { ...store.get(key), ...patch };
  if (isEmpty(next)) store.delete(key);
  else store.set(key, next);
  emit();
}

export const hasMarks = (key: string) => !isEmpty(store.get(key));
export const fieldMarks = (key: string): string[] => store.get(key)?.fields ?? [];
export const blockMarks = (key: string): number[] => store.get(key)?.blocks ?? [];

// 清除一個分頁的標記（提示條的「清除標記」）
export function clearMarks(key: string) {
  const model = findModel(key);
  if (model) setDecorations(model, []);
  store.delete(key);
  emit();
}

// 關專案：全部清掉
export function clearAllMarks() {
  for (const key of [...store.keys()]) clearMarks(key);
}

// ── 比對 ──────────────────────────────

// 舊的第 i 個（行或區塊，從 0 開始）在新內容裡變成第幾個；它本身被改掉了就回傳 null
function shiftIndex(i: number, hunks: Hunk[]): number | null {
  let delta = 0;
  for (const h of hunks) {
    if (i < h.oldStart) break;
    if (i < h.oldStart + h.oldCount) return null;
    delta += h.newCount - h.oldCount;
  }
  return i + delta;
}

// 新內容裡被改到的是哪幾個（從 0 開始）；純刪除的放在 deleted（刪掉的位置 = 新內容的第幾個前面）
function changedIndexes(hunks: Hunk[], newLength: number) {
  const changed: number[] = [];
  const deleted: number[] = [];
  for (const h of hunks) {
    for (let k = 0; k < h.newCount; k++) changed.push(h.newStart + k);
    if (h.newCount === 0) deleted.push(Math.min(h.newStart, Math.max(0, newLength - 1)));
  }
  return { changed, deleted };
}

const splitLines = (text: string) => text.split(/\r?\n/);

// ── 劇本（Monaco） ──────────────────────────────

const findModel = (fileId: string) => monaco.editor.getModels().find((m) => m.uri.path.replace(/^\//, '') === fileId && !m.isDisposed());

const decoIds = new WeakMap<monaco.editor.ITextModel, string[]>();
const attached = new WeakSet<monaco.editor.ITextModel>();
// 播放打字效果中：編輯器的改動先不管（最後整份替換會把標記全弄亂）；播完的位置要從記錄重新算（stale）
const suspended = new WeakSet<monaco.editor.ITextModel>();
const stale = new WeakSet<monaco.editor.ITextModel>();

// 播放打字效果前呼叫；播完呼叫回傳的函式，接著由 markFileChange 從記錄重新算出標記的位置
export function suspendMarks(fileId: string): () => void {
  const model = findModel(fileId);
  if (!model) return () => {};
  suspended.add(model);
  return () => {
    suspended.delete(model);
    stale.add(model);
  };
}

const decoOptions = (kind: LineMark['kind']): monaco.editor.IModelDecorationOptions =>
  kind === 'add'
    ? {
        isWholeLine: true,
        className: 'ext-change-line',
        linesDecorationsClassName: 'ext-change-gutter',
        overviewRuler: { color: 'rgba(230, 190, 60, 0.9)', position: monaco.editor.OverviewRulerLane.Left },
        stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
      }
    : {
        isWholeLine: true,
        linesDecorationsClassName: 'ext-change-del',
        overviewRuler: { color: 'rgba(230, 90, 90, 0.9)', position: monaco.editor.OverviewRulerLane.Left },
        stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
      };

function setDecorations(model: monaco.editor.ITextModel, marks: LineMark[]) {
  const max = model.getLineCount();
  const ids = model.deltaDecorations(
    decoIds.get(model) ?? [],
    marks
      .filter((m) => m.line >= 1 && m.line <= max)
      .map((m) => ({ range: new monaco.Range(m.line, 1, m.line, 1), options: decoOptions(m.kind) })),
  );
  decoIds.set(model, ids);
}

// 編輯器上目前的標記（跟著內容移動過的位置）
function modelMarks(model: monaco.editor.ITextModel): LineMark[] {
  const out: LineMark[] = [];
  for (const id of decoIds.get(model) ?? []) {
    const range = model.getDecorationRange(id);
    const opts = model.getDecorationOptions(id);
    if (range && opts) out.push({ line: range.startLineNumber, kind: opts.linesDecorationsClassName === 'ext-change-del' ? 'del' : 'add' });
  }
  return out;
}

// 劇本編輯器建立時呼叫：把記著的標記畫上去；之後內容一改，被改到的那幾行標記就拿掉
export function attachModel(fileId: string, model: monaco.editor.ITextModel) {
  if (attached.has(model)) return;
  attached.add(model);
  setDecorations(model, store.get(fileId)?.lines ?? []);
  model.onDidChangeContent((e) => {
    if (suspended.has(model)) return;
    const ids = decoIds.get(model) ?? [];
    if (ids.length === 0) return;
    const hit = new Set<string>();
    for (const c of e.changes) {
      const start = c.range.startLineNumber;
      const end = start + c.text.split(/\r\n|\r|\n/).length - 1;
      for (const id of ids) {
        const r = model.getDecorationRange(id);
        if (r && r.startLineNumber >= start && r.startLineNumber <= end) hit.add(id);
      }
    }
    if (hit.size > 0) {
      model.deltaDecorations([...hit], []);
      decoIds.set(model, ids.filter((id) => !hit.has(id)));
    }
    syncFromModel(fileId, model);
  });
}

// 把編輯器上的標記位置寫回記錄（分頁關掉、編輯器被釋放後，重新打開還找得到）
function syncFromModel(fileId: string, model: monaco.editor.ITextModel) {
  const lines = modelMarks(model);
  const before = store.get(fileId)?.lines ?? [];
  if (lines.length === before.length && lines.every((m, i) => m.line === before[i].line && m.kind === before[i].kind)) return;
  update(fileId, { lines });
}

// 外部改了一個劇本：標出改到的行。內容要先換好（編輯器開著的話，用 applyTextMinimal 只改有變的行）
export function markFileChange(fileId: string, oldText: string, newText: string) {
  const model = findModel(fileId);
  const isStale = !!model && stale.has(model);
  if (model) stale.delete(model);
  if (oldText === newText || (!enabled() && !isStale)) return;
  const newLines = splitLines(newText);
  const hunks = diffLines(splitLines(oldText), newLines);
  const { changed, deleted } = changedIndexes(hunks, newLines.length);
  const fresh: LineMark[] = !enabled() ? [] : [...changed.map((i) => ({ line: i + 1, kind: 'add' as const })), ...deleted.map((i) => ({ line: i + 1, kind: 'del' as const }))];
  let lines: LineMark[];
  if (model && attached.has(model) && !isStale) {
    lines = modelMarks(model); // 編輯器的標記已經跟著內容移動好了
  } else {
    lines = (store.get(fileId)?.lines ?? []).flatMap((m) => {
      const i = shiftIndex(m.line - 1, hunks);
      return i === null ? [] : [{ ...m, line: i + 1 }];
    });
  }
  const seen = new Set(lines.map((m) => `${m.line}:${m.kind}`));
  for (const m of fresh) if (!seen.has(`${m.line}:${m.kind}`)) lines.push(m);
  lines.sort((a, b) => a.line - b.line);
  if (model && attached.has(model)) setDecorations(model, lines);
  update(fileId, { lines });
}

// 把編輯器的內容換成 newText，但只改有變的那幾行（沒變的行上的標記和游標都留著）；可以用 Ctrl+Z 復原
export function applyTextMinimal(model: monaco.editor.ITextModel, newText: string) {
  const LF = monaco.editor.EndOfLinePreference.LF;
  if (model.getValue(LF) === newText) return;
  const oldLines = model.getLinesContent();
  const newLines = splitLines(newText);
  const L = oldLines.length;
  const maxCol = (n: number) => model.getLineMaxColumn(n);
  const edits = diffLines(oldLines, newLines).map((h): monaco.editor.IIdentifiedSingleEditOperation => {
    const text = newLines.slice(h.newStart, h.newStart + h.newCount).join('\n');
    const first = h.oldStart + 1;
    const last = h.oldStart + h.oldCount;
    if (h.oldCount > 0 && h.newCount > 0) return { range: new monaco.Range(first, 1, last, maxCol(last)), text };
    if (h.oldCount > 0) {
      if (last < L) return { range: new monaco.Range(first, 1, last + 1, 1), text: '' };
      if (first > 1) return { range: new monaco.Range(first - 1, maxCol(first - 1), L, maxCol(L)), text: '' };
      return { range: new monaco.Range(1, 1, L, maxCol(L)), text: '' };
    }
    if (first <= L) return { range: new monaco.Range(first, 1, first, 1), text: `${text}\n` };
    return { range: new monaco.Range(L, maxCol(L), L, maxCol(L)), text: `\n${text}` };
  });
  model.pushEditOperations([], edits, () => null);
  // 保險：算錯的話整份換掉
  if (model.getValue(LF) !== newText) model.pushEditOperations([], [{ range: model.getFullModelRange(), text: newText }], () => null);
  model.pushStackElement();
}

// ── 設定卡 ──────────────────────────────

// 在背景把詳細內容讀成文件，列出最上層每一塊的內容（拿來比對改了哪幾塊）
let parser: CoreEditor | null = null;
function blockSignatures(markdown: string): string[] {
  parser ??= new CoreEditor({ extensions: richExtensions });
  parser.commands.setContent(markdown, false);
  const out: string[] = [];
  parser.state.doc.forEach((node) => out.push(JSON.stringify(node.toJSON())));
  return out;
}

// 外部改了（或新增了）一張設定卡：標出改到的欄位、名稱、詳細內容的區塊
export function markCardChange(key: string, before: Card | undefined, after: Card) {
  if (!enabled()) return;
  const entry = store.get(key) ?? {};
  const fields = new Set(entry.fields ?? []);
  for (const f of after.fields) {
    if (before?.fields.find((b) => b.key === f.key)?.value !== f.value || !before) fields.add(f.key);
  }
  if (!before || before.name !== after.name) fields.add('__name');
  let blocks = entry.blocks ?? [];
  const oldDetail = before?.detail ?? '';
  if (oldDetail !== after.detail) {
    const newSigs = blockSignatures(after.detail);
    const hunks = diffLines(blockSignatures(oldDetail), newSigs);
    const { changed } = changedIndexes(hunks, newSigs.length);
    const kept = blocks.flatMap((i) => {
      const j = shiftIndex(i, hunks);
      return j === null ? [] : [j];
    });
    blocks = [...new Set([...kept, ...changed])].filter((i) => i < newSigs.length).sort((a, b) => a - b);
  }
  update(key, { fields: [...fields], blocks });
}

// 你自己改了某個欄位：那個欄位的標記拿掉
export function clearFieldMark(key: string, field: string) {
  const fields = store.get(key)?.fields;
  if (!fields?.includes(field)) return;
  update(key, { fields: fields.filter((f) => f !== field) });
}

// 詳細內容的編輯器回報：標記現在在第幾塊（被你打字蓋掉的已經拿掉了）
export function setBlockMarks(key: string, blocks: number[]) {
  const before = store.get(key)?.blocks ?? [];
  if (before.length === blocks.length && before.every((b, i) => b === blocks[i])) return;
  update(key, { blocks });
}
