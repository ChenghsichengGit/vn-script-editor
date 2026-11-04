// 劇本（.vns）的語言功能：指令上色、打指令時自動補齊、選參數、行尾的參數提示色塊、參數類型錯誤的紅色波浪線
//
// 指令定義來自「指令」區塊的卡。卡片名稱就是指令格式，例如 #name [名字]
// 同一個指令有好幾種寫法時，在「用法」欄位一行寫一種（冒號後面是說明）：
//   #fade in [time:int=0]：淡入
//   #fade default [color] [time:int=0]：淡到指定顏色
// 打劇本時會依前面已經填的值，篩出還符合的寫法，再列出下一個位置可以填什麼（層數不限）
//
// 每一段的意思：
//   #xxx                  = 指令名稱（每行的第一段）
//   [名字]                = 參數。可以選的值依序找：
//                             1. 同一張指令卡上有沒有叫「名字」的欄位：一行一個選項，「in：淡入」冒號後面是說明
//                             2. 欄位範本裡「指令參數」設成「名字」的欄位（或卡片名稱）的內容
//   [time:int]            = 限定類型的參數：int 整數、float 小數、text 文字
//   [time:int=0]、[note?] = 可以不填的參數（= 後面是不填時的預設值）
//   in/out 或 in|out      = 固定選項，只能選其中一個
//   其他文字              = 照抄的固定字
// 指令要寫在一行的開頭（前面可以有空白），參數之間用空白分開
// // 到行尾是註解：綠色，指令會忽略它（Ctrl+/ 可以整行加上或拿掉）
// //# 大標題、//## 中標題、//### 小標題：也是註解（不會輸出），用來分段；劇本右邊的大綱會列出來
import monaco from './monaco';
import { Card, CardSectionId, Schemas } from './model';
import { sectionMeta } from './sampleData';

export const LANGUAGE_ID = 'vns';

type ParamType = 'int' | 'float' | 'text';

type Param =
  | { kind: 'ref'; name: string; type?: ParamType; optional: boolean; def?: string } // [名字]、[time:int=0]
  | { kind: 'choice'; options: string[] } // in|out
  | { kind: 'literal'; text: string }; // 固定字

// 補齊清單裡的一個選項
interface Choice {
  label: string;
  detail: string;
}

// 指令的一種寫法（卡片名稱或「用法」欄位裡的一行）
interface Usage {
  params: Param[];
  format: string; // 原本寫的格式，顯示在補齊清單旁邊
  description: string;
  ownOptions: Map<string, Choice[]>; // 指令卡上和參數同名的欄位列出的選項（參數名稱 → 選項）
}

interface Command {
  name: string; // 含 #，例如 #name
  usages: Usage[];
  description: string;
}

// 一個可以填進參數的值：從哪張卡、哪個區塊來的
interface ParamValue {
  value: string;
  source: string;
}

// App 每次卡片或範本改變時呼叫 setScriptData 更新這兩份資料；補齊和提示每次都讀最新的
let commands: Command[] = [];
let paramValues = new Map<string, ParamValue[]>(); // 參數名稱 → 可選的值
let paramSources = new Map<string, string[]>(); // 參數名稱 → 在欄位設定裡是哪個區塊的哪個欄位（例如「角色的名稱」）

const fieldOf = (card: Card, key: string) => card.fields.find((f) => f.key === key)?.value.trim() ?? '';
const linesOf = (text: string) => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

function parseParam(token: string): Param {
  const ref = /^\[([^\]:?=]+)(?::(int|float|text))?(\?)?(?:=([^\]]*))?\]$/.exec(token);
  if (ref) {
    return { kind: 'ref', name: ref[1], type: ref[2] as ParamType | undefined, optional: !!ref[3] || ref[4] !== undefined, def: ref[4] };
  }
  if (/[|/]/.test(token)) return { kind: 'choice', options: token.split(/[|/]/).filter(Boolean) };
  return { kind: 'literal', text: token };
}

// 參數顯示在提示色塊裡的文字：有類型的寫成 (int)time，可以不填的加上方括號（不顯示預設值）
function paramLabel(p: Param) {
  if (p.kind === 'choice') return p.options.join('/');
  if (p.kind === 'literal') return p.text;
  const core = p.type ? `(${p.type})${p.name}` : p.name;
  return p.optional ? `[${core}]` : core;
}

// 一行用法拆成「格式」和「說明」：在方括號外面的第一個冒號（：或 :）切開
function splitDescription(line: string): [string, string] {
  let depth = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '[') depth++;
    else if (ch === ']') depth--;
    else if (depth === 0 && (ch === '：' || ch === ':')) return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
  }
  return [line.trim(), ''];
}

// 欄位內容裡一行一個選項，「in：淡入」或「in: 淡入」冒號後面是說明
function parseOptions(text: string): Choice[] {
  return text.split(/\r?\n/).flatMap((line) => {
    const m = /^\s*([^：:]+?)\s*(?:[：:]\s*(.*))?$/.exec(line);
    return m && m[1] ? [{ label: m[1], detail: m[2]?.trim() ?? '' }] : [];
  });
}

export function setScriptData(cards: Record<CardSectionId, Card[]>, schemas: Schemas) {
  // 指令清單：收集每張指令卡的所有寫法，同名的指令（就算在不同卡）合在一起
  const byName = new Map<string, Command>();
  for (const card of cards.commands) {
    const lines = linesOf(fieldOf(card, '用法'));
    const title = card.name.trim();
    // 卡片名稱：沒另外寫用法時就是唯一的寫法；有寫用法時，名稱只有帶參數（例如 #name [名字]）才算一種寫法
    if (lines.length === 0 || /\s/.test(title)) lines.unshift(title);
    const description = fieldOf(card, '說明');
    for (const line of lines) {
      const [format, desc] = splitDescription(line);
      const [name, ...rest] = format.split(/\s+/);
      if (!name?.startsWith('#') || name.length < 2) continue;
      const params = rest.map(parseParam);
      const ownOptions = new Map<string, Choice[]>();
      for (const p of params) {
        const field = p.kind === 'ref' && card.fields.find((f) => f.key === p.name && f.value.trim());
        if (p.kind === 'ref' && field) ownOptions.set(p.name, parseOptions(field.value));
      }
      let cmd = byName.get(name);
      if (!cmd) {
        cmd = { name, usages: [], description };
        byName.set(name, cmd);
      }
      if (!cmd.description) cmd.description = description;
      if (!cmd.usages.some((u) => u.format === format)) cmd.usages.push({ params, format, description: desc, ownOptions });
    }
  }
  commands = [...byName.values()];

  // 參數的可選值：每個區塊範本裡有設「指令參數」的欄位（含卡片名稱），收集所有卡的那個內容（空白的跳過、重複的只留一個）
  paramValues = new Map();
  paramSources = new Map();
  const addSource = (param: string, text: string) => paramSources.set(param, [...(paramSources.get(param) ?? []), text]);
  const collect = (param: string, section: CardSectionId, valueOf: (card: Card) => string) => {
    const list = paramValues.get(param) ?? [];
    for (const card of cards[section]) {
      const value = valueOf(card);
      if (value && !list.some((v) => v.value === value)) {
        list.push({ value, source: `${sectionMeta[section].title}／${card.name}` });
      }
    }
    paramValues.set(param, list);
  };
  for (const section of Object.keys(schemas) as CardSectionId[]) {
    const { nameParam, fields } = schemas[section];
    const title = sectionMeta[section].title;
    if (nameParam) {
      collect(nameParam, section, (card) => card.name.trim());
      addSource(nameParam, `${title}的名稱`);
    }
    for (const field of fields) {
      if (!field.param) continue;
      collect(field.param, section, (card) => fieldOf(card, field.key));
      addSource(field.param, `${title}的「${field.key}」`);
    }
  }
  for (const model of monaco.editor.getModels()) refresh(model);
}

// 拆開一行指令：沒有寫指令就回傳 null
// words = 指令名稱後面已經寫的每一段；endsWithSpace = 最後一段後面是不是已經打了空白（正在等下一個參數）
// 一行裡 // 前面的部分（// 到行尾是註解，指令不看它）
const codeOf = (text: string) => {
  const i = text.indexOf('//');
  return i < 0 ? text : text.slice(0, i);
};

function parseLine(text: string) {
  const m = /^(\s*)(#\S*)(.*)$/.exec(codeOf(text));
  if (!m) return null;
  const rest = m[3];
  const words = rest.split(/\s+/).filter(Boolean);
  return { indent: m[1].length, name: m[2], rest, words, endsWithSpace: /\s$/.test(rest) };
}

const findCommand = (name: string) => commands.find((c) => c.name === name);

// [參數] 可以填的值清單：指令卡上的同名欄位，沒有就用欄位設定裡的參數值（都沒有 = 沒有清單，填什麼都可以）
function allowedValues(u: Usage, name: string): string[] {
  const own = u.ownOptions.get(name);
  if (own) return own.map((c) => c.label);
  return (paramValues.get(name) ?? []).map((v) => v.value);
}

// 這一段文字能不能填在這個參數的位置：固定字要一樣、選項要是其中之一、
// [參數] 有類型就檢查類型，有值清單就要是清單裡的值
function accepts(u: Usage, p: Param, word: string) {
  if (p.kind === 'literal') return word === p.text;
  if (p.kind === 'choice') return p.options.includes(word);
  if (p.type === 'int' && !/^-?\d+$/.test(word)) return false;
  if (p.type === 'float' && !/^-?\d+(\.\d+)?$/.test(word)) return false;
  const list = allowedValues(u, p.name);
  return list.length === 0 || list.includes(word);
}

// 依已經填的每一段，篩出還符合的寫法
const matchUsages = (cmd: Command, words: string[]) =>
  cmd.usages.filter((u) => words.every((w, i) => u.params[i] && accepts(u, u.params[i], w)));

// 某個參數可以選的項目：先看指令卡自己的同名欄位，沒有才用範本裡的參數值，再沒有就給預設值
function paramChoices(u: Usage, p: Param): Choice[] {
  if (p.kind === 'choice') return p.options.map((o) => ({ label: o, detail: '' }));
  if (p.kind === 'literal') return [{ label: p.text, detail: u.description || u.format }];
  const own = u.ownOptions.get(p.name);
  if (own) return own;
  const values = (paramValues.get(p.name) ?? []).map((v) => ({ label: v.value, detail: v.source }));
  if (values.length > 0) return values;
  return p.def !== undefined ? [{ label: p.def, detail: '預設值' }] : [];
}

// 檢查參數，有問題就畫紅色波浪線：
//   某一段對不上任何寫法（固定字、選項填錯、類型不對、多填）→ 那一段標「參數錯誤」
//   全部填對了但還缺必填的參數 → 指令名稱標「缺少參數」
// 一個問題（紅色波浪線）：第幾行（從 1 開始）、從第幾欄到第幾欄
export interface ScriptProblem {
  line: number;
  startColumn: number;
  endColumn: number;
  message: string;
}

// 檢查一份劇本的每一行；編輯器的紅線和問題面板都用這個（問題面板連沒打開的劇本也檢查）
export function checkScript(lines: string[]): ScriptProblem[] {
  const problems: ScriptProblem[] = [];
  lines.forEach((raw, index) => {
    const n = index + 1;
    {
      const text = codeOf(raw);
      const line = parseLine(text);
      const cmd = line && findCommand(line.name);
      if (!line || !cmd) return;
      // 找出每一段的位置（指令名稱後面開始）
      const re = /\S+/g;
      re.lastIndex = line.indent + line.name.length;
      const parts: { word: string; start: number }[] = [];
      for (let m = re.exec(text); m; m = re.exec(text)) parts.push({ word: m[0], start: m.index });
      const mark = (message: string, start: number, length: number) =>
        problems.push({ line: n, startColumn: start + 1, endColumn: start + length + 1, message });
      let wrong = false;
      for (let i = 0; i < parts.length; i++) {
        const prefix = parts.slice(0, i).map((p) => p.word);
        if (matchUsages(cmd, prefix).some((u) => u.params[i] && accepts(u, u.params[i], parts[i].word))) continue;
        mark('參數錯誤', parts[i].start, parts[i].word.length);
        wrong = true;
        break; // 後面的段落已經對不上任何寫法，不再檢查
      }
      if (wrong) return;
      // 有沒有一種寫法，剩下沒填的參數都是可以不填的
      const words = parts.map((p) => p.word);
      const complete = matchUsages(cmd, words).some((u) =>
        u.params.slice(words.length).every((p) => p.kind === 'ref' && p.optional),
      );
      if (!complete) mark('缺少參數', line.indent, line.name.length);
    }
  });
  return problems;
}

function validate(model: monaco.editor.ITextModel) {
  const problems = model.getLanguageId() === LANGUAGE_ID ? checkScript(model.getLinesContent()) : [];
  monaco.editor.setModelMarkers(
    model,
    LANGUAGE_ID,
    problems.map((p) => ({
      severity: monaco.MarkerSeverity.Error,
      message: p.message,
      startLineNumber: p.line,
      endLineNumber: p.line,
      startColumn: p.startColumn,
      endColumn: p.endColumn,
    })),
  );
}

// 跳到某個劇本的某一行：找到顯示這個檔案的編輯器（剛開分頁時編輯器還沒建好，就等一下再找）
// 有給 endColumn 就把 column～endColumn 選起來（搜尋結果用）
export function revealInEditor(fileId: string, line: number, column: number, endColumn?: number, tries = 30) {
  const editor = monaco.editor
    .getEditors()
    .find((e) => e.getModel()?.uri.path.replace(/^\//, '') === fileId && e.getContainerDomNode().offsetParent !== null);
  if (!editor) {
    if (tries > 0) setTimeout(() => revealInEditor(fileId, line, column, endColumn, tries - 1), 50);
    return;
  }
  if (endColumn) editor.setSelection({ startLineNumber: line, startColumn: column, endLineNumber: line, endColumn });
  else editor.setPosition({ lineNumber: line, column });
  editor.revealLineInCenterIfOutsideViewport(line);
  editor.focus();
}

// 參數提示：指令還缺哪些參數，就在那一行最後面畫灰色小色塊（填完就消失）
// 還有好幾種寫法符合時：顯示第一種寫法剩下的參數，旁邊一個淡淡的「+N」表示另外還有 N 種
// 只要有一種寫法剛好寫完整，就不顯示
function missingLabel(text: string): { label: string; more: number } | null {
  const line = parseLine(text);
  const cmd = line && findCommand(line.name);
  if (!line || !cmd) return null;
  // 正在打的最後一段（後面沒有空白）也算已經填了；它還沒打完而對不上時，只用前面的段落篩
  let start = line.words.length;
  let usages = matchUsages(cmd, line.words);
  if (usages.length === 0 && !line.endsWithSpace) {
    start--;
    usages = matchUsages(cmd, line.words.slice(0, -1));
  }
  if (usages.length === 0 || usages.some((u) => u.params.length <= start)) return null;
  const rests = [...new Set(usages.map((u) => u.params.slice(start).map(paramLabel).join('  ')))];
  return { label: rests[0], more: rests.length - 1 };
}

// ── 標題（//# 大標題、//## 中標題、//### 小標題） ──────────────────────────────

const HEADING = /^\s*\/\/(#{1,3})(?!#)\s*(.*)$/;

// 這一行是第幾級標題（1～3），不是標題回傳 0
export function headingLevel(line: string): number {
  return HEADING.exec(line)?.[1].length ?? 0;
}

// 一份劇本裡所有的標題：pos = 第幾行（從 1 開始）
export function scriptHeadings(lines: string[]): { level: number; text: string; pos: number }[] {
  return lines.flatMap((line, i) => {
    const m = HEADING.exec(line);
    return m ? [{ level: m[1].length, text: m[2].trim(), pos: i + 1 }] : [];
  });
}

// 把一行改成第 level 級標題（0 = 取消標題，變回一般文字）；本來是標題的先拿掉原本的符號
export function setHeadingLevel(line: string, level: number): string {
  const m = HEADING.exec(line);
  const indent = /^\s*/.exec(line)![0];
  const text = m ? m[2] : line.trim();
  return level === 0 ? indent + text : `${indent}//${'#'.repeat(level)} ${text}`;
}

// 每個劇本目前畫上去的提示色塊（下次重算時要先拿掉舊的）
const hintIds = new WeakMap<monaco.editor.ITextModel, string[]>();

// 提示色塊是用 CSS 的 ::before／::after 畫出來的，不是插進那一行的文字：游標位置才不會被它推到後面
// 每種提示文字對應一個 class（vns-h0、vns-h1…），第一次用到時加 CSS 規則：::before = 參數提示，::after = 「+N」
const hintClasses = new Map<string, string>();
let hintSheet: CSSStyleSheet | null = null;
function hintClass(label: string, more: number) {
  const key = `${label}\u0000${more}`;
  let cls = hintClasses.get(key);
  if (!cls) {
    if (!hintSheet) {
      const style = document.createElement('style');
      document.head.appendChild(style);
      hintSheet = style.sheet!;
    }
    cls = `vns-h${hintClasses.size}`;
    hintClasses.set(key, cls);
    hintSheet.insertRule(`.monaco-editor .${cls}::before { content: ${JSON.stringify(label)}; }`);
    if (more > 0) hintSheet.insertRule(`.monaco-editor .${cls}::after { content: "+${more}"; }`);
  }
  return cls;
}

function showHints(model: monaco.editor.ITextModel) {
  const decorations: monaco.editor.IModelDeltaDecoration[] = [];
  if (model.getLanguageId() === LANGUAGE_ID) {
    for (let n = 1; n <= model.getLineCount(); n++) {
      const full = model.getLineContent(n);
      // 標題那一行整行加一點底色
      const level = headingLevel(full);
      if (level) {
        decorations.push({ range: new monaco.Range(n, 1, n, 1), options: { isWholeLine: true, className: `vns-h${level}-line` } });
        continue;
      }
      const text = codeOf(full); // 有註解時，提示畫在註解前面
      const hint = missingLabel(text);
      if (!hint) continue;
      const end = text.length + 1;
      const cls = ['vns-hint', hintClass(hint.label, hint.more), text !== full ? 'vns-hint-before-comment' : ''].filter(Boolean).join(' ');
      decorations.push({
        range: new monaco.Range(n, end, n, end),
        options: { showIfCollapsed: true, afterContentClassName: cls },
      });
    }
  }
  hintIds.set(model, model.deltaDecorations(hintIds.get(model) ?? [], decorations));
}

function refresh(model: monaco.editor.ITextModel) {
  if (model.isDisposed()) return;
  showHints(model);
  validate(model);
}

let registered = false;

// 註冊語言和各種功能；只會做一次（所有劇本編輯器共用）
export function registerScriptLanguage() {
  if (registered) return;
  registered = true;

  monaco.languages.register({ id: LANGUAGE_ID, extensions: ['.vns'] });

  // 上色：行首的 #指令 一個顏色，後面的參數另一個顏色
  // （這套上色規則是從每行開頭比對：開頭是 #xxx 就整行拆成「空白／指令／參數」三段，否則整行是一般文字）
  // Ctrl+/ 加上或拿掉每行開頭的 //
  monaco.languages.setLanguageConfiguration(LANGUAGE_ID, { comments: { lineComment: '//' } });

  monaco.languages.setMonarchTokensProvider(LANGUAGE_ID, {
    tokenizer: {
      root: [
        // 每行從開頭比對：// 到行尾是註解；開頭是 #xxx 就拆成「空白／指令／參數」（參數到 // 為止）；其他是一般文字（也是到 // 為止）
        [/\s*\/\/###(?!#).*/, 'heading3'],
        [/\s*\/\/##(?!#).*/, 'heading2'],
        [/\s*\/\/#(?!#).*/, 'heading1'],
        [/\/\/.*/, 'comment'],
        [/(\s*)(#(?:[^\s/]|\/(?!\/))*)((?:[^/]|\/(?!\/))*)/, ['', 'command', 'argument']],
        [/(?:[^/]|\/(?!\/))+/, ''],
      ],
    },
  });
  // 劇本編輯器的配色：深色、淺色、高對比各一套（跟著設定裡的「顏色主題」，見 ScriptEditor）
  const tokens = (c: { command: string; argument: string; comment: string; h1: string; h2: string; h3: string }) => [
    { token: 'command', foreground: c.command, fontStyle: 'bold' },
    { token: 'argument', foreground: c.argument },
    { token: 'comment', foreground: c.comment },
    { token: 'heading1', foreground: c.h1, fontStyle: 'bold' },
    { token: 'heading2', foreground: c.h2, fontStyle: 'bold' },
    { token: 'heading3', foreground: c.h3, fontStyle: 'bold' },
  ];
  monaco.editor.defineTheme('vn-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: tokens({ command: 'C586C0', argument: '9CDCFE', comment: '6A9955', h1: 'E2C08D', h2: '7FB4E0', h3: 'C8C8C8' }),
    colors: {},
  });
  monaco.editor.defineTheme('vn-light', {
    base: 'vs',
    inherit: true,
    rules: tokens({ command: 'AF00DB', argument: '0451A5', comment: '008000', h1: '9A6700', h2: '0451A5', h3: '444444' }),
    colors: {},
  });
  monaco.editor.defineTheme('vn-hc', {
    base: 'hc-black',
    inherit: true,
    rules: tokens({ command: 'E4A0FF', argument: '9CDCFE', comment: '7CA668', h1: 'FFD700', h2: '9CDCFE', h3: 'FFFFFF' }),
    colors: {},
  });

  // 自動補齊：打指令名稱時列出指令；指令後面打空白或打字，列出這個位置的參數可以選什麼
  monaco.languages.registerCompletionItemProvider(LANGUAGE_ID, {
    triggerCharacters: ['#', ' '],
    provideCompletionItems(model, position) {
      const before = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
      if (before.includes('//')) return { suggestions: [] }; // 在註解裡
      const line = parseLine(before);
      if (!line) return { suggestions: [] };

      // 還在打指令名稱：補齊範圍是從 # 到游標
      if (line.rest === '') {
        const range = new monaco.Range(position.lineNumber, line.indent + 1, position.lineNumber, position.column);
        return {
          suggestions: commands.map((c, i) => {
            const hasParams = c.usages.some((u) => u.params.length > 0);
            return {
              label: c.name,
              kind: monaco.languages.CompletionItemKind.Keyword,
              detail: c.usages.length > 1 ? `${c.usages[0].format}（共 ${c.usages.length} 種寫法）` : c.usages[0].format,
              documentation: [c.description, ...c.usages.map((u) => (u.description ? `${u.format}：${u.description}` : u.format))]
                .filter(Boolean)
                .join('\n'),
              // 有參數的指令：補完自動空一格，並立刻再打開清單讓你選第一個參數
              insertText: hasParams ? `${c.name} ` : c.name,
              command: hasParams ? { id: 'editor.action.triggerSuggest', title: '' } : undefined,
              range,
              sortText: String(i).padStart(4, '0'),
            };
          }),
        };
      }

      // 在參數的位置：用前面已經填完的段落篩出符合的寫法，再合併它們在這個位置的選項
      const cmd = findCommand(line.name);
      if (!cmd) return { suggestions: [] };
      const typing = line.endsWithSpace ? '' : line.words[line.words.length - 1] ?? '';
      const done = line.endsWithSpace ? line.words : line.words.slice(0, -1);
      const index = done.length;
      const merged = new Map<string, { choice: Choice; hasMore: boolean }>();
      for (const u of matchUsages(cmd, done)) {
        const p = u.params[index];
        if (!p) continue;
        const hasMore = u.params.length > index + 1;
        for (const c of paramChoices(u, p)) {
          const seen = merged.get(c.label);
          if (seen) seen.hasMore ||= hasMore;
          else merged.set(c.label, { choice: c, hasMore });
        }
      }
      const range = new monaco.Range(position.lineNumber, position.column - typing.length, position.lineNumber, position.column);
      return {
        suggestions: [...merged.values()].map(({ choice: c, hasMore }, i) => ({
          label: c.label,
          kind: monaco.languages.CompletionItemKind.Value,
          detail: c.detail,
          insertText: hasMore ? `${c.label} ` : c.label,
          command: hasMore ? { id: 'editor.action.triggerSuggest', title: '' } : undefined,
          range,
          sortText: String(i).padStart(4, '0'), // 照欄位裡寫的順序排，不要被改成字母順序
        })),
      };
    },
  });

  // 參數提示和類型檢查：劇本一打開、內容一改就立刻重算（在畫面更新之前，所以不會慢一步或跟著游標跑）
  const watch = (model: monaco.editor.ITextModel) => {
    refresh(model);
    model.onDidChangeContent(() => refresh(model));
    model.onDidChangeLanguage(() => refresh(model));
  };
  monaco.editor.getModels().forEach(watch);
  monaco.editor.onDidCreateModel(watch);
}

// ── 指令卡上的專用欄位名稱 ──────────────────────────────
// 名稱 → 作用說明。固定的有「用法」「說明」，另外格式裡的 [參數] 同名欄位 = 那個參數的選項清單
export const FIXED_COMMAND_FIELDS: { name: string; description: string }[] = [
  { name: '用法', description: '這個指令的各種寫法：一行寫一種，冒號後面是說明，例如\n#fade in [time:int=0]：淡入' },
  { name: '說明', description: '這個指令是做什麼的：會顯示在劇本的補齊清單裡' },
];

// 一張指令卡上，哪些欄位名稱有特別用途（含它格式裡用到的參數）
export function commandSpecialFields(card: Card): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of FIXED_COMMAND_FIELDS) out.set(f.name, f.description);
  const lines = [card.name, ...linesOf(fieldOf(card, '用法'))];
  for (const line of lines) {
    const [format] = splitDescription(line);
    for (const token of format.split(/\s+/).slice(1)) {
      const p = parseParam(token);
      if (p.kind === 'ref' && !out.has(p.name)) {
        out.set(p.name, `參數 [${p.name}] 可以選的值：一行一個，冒號後面是說明，例如\nblack：黑色`);
      }
    }
  }
  return out;
}

// ── 欄位設定的「指令參數」和指令格式的 [參數] 互相補齊 ──────────────────────────────

// 所有指令格式裡用到的 [參數] → 用到它的指令
export function usedParams(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const cmd of commands) {
    for (const u of cmd.usages) {
      for (const p of u.params) {
        if (p.kind !== 'ref') continue;
        const list = out.get(p.name) ?? [];
        if (!list.includes(cmd.name)) list.push(cmd.name);
        out.set(p.name, list);
      }
    }
  }
  return out;
}

// 欄位設定裡已經設好的指令參數 → 來源說明
export const definedParams = () => paramSources;

// 寫指令格式時：游標前面有還沒關起來的 [，就列出欄位設定裡的指令參數，選了補成 [名字]
export function bracketSuggest(value: string, caret: number) {
  const open = value.lastIndexOf('[', caret - 1);
  if (open < 0 || value.slice(open, caret).includes(']')) return null;
  const typing = value.slice(open + 1, caret);
  if (/[\s:=?]/.test(typing)) return null; // 已經在打類型或預設值了
  const to = value[caret] === ']' ? caret + 1 : caret;
  const items = [...paramSources]
    .filter(([name]) => name.includes(typing))
    .map(([name, from]) => ({ label: name, detail: from.join('、'), insert: `${name}]` }));
  return { items, from: open + 1, to };
}

// ── 舊專案的「格式」欄位併進「用法」──────────────────────────────
// 「格式」的每一行搬到「用法」最前面，然後刪掉「格式」欄位；
// 只有指令名稱、沒有參數的行（例如 #fade），在「用法」已經有其他寫法時直接丟掉（不然 #fade 單獨也會變成合法寫法）
// 回傳整理後的卡；沒有「格式」欄位的卡回傳 null（不用改）
export function migrateFormatField(card: Card): Card | null {
  const format = card.fields.find((f) => f.key === '格式');
  if (!format) return null;
  const usage = linesOf(fieldOf(card, '用法'));
  const moved = linesOf(format.value).filter((l) => usage.length === 0 || /\s/.test(splitDescription(l)[0]));
  const merged = [...moved, ...usage.filter((l) => !moved.includes(l))].join('\n');
  const rest = card.fields.filter((f) => f.key !== '格式');
  const fields = rest.some((f) => f.key === '用法')
    ? rest.map((f) => (f.key === '用法' ? { ...f, value: merged } : f))
    : [{ key: '用法', value: merged }, ...rest];
  return { ...card, fields };
}
