// 劇本（.vns）的語言功能：指令上色、打指令時自動補齊、選參數、行尾的參數提示色塊、參數類型錯誤的紅色波浪線
import monaco from './monaco';
import { Card, CardSectionId, Schemas } from './model';
import { sectionMeta } from './sections';
import { rubyProblems } from './ruby';

export const LANGUAGE_ID = 'vns';

type ParamType = 'int' | 'float' | 'text';

type Param =
  | { kind: 'ref'; name: string; type?: ParamType; optional: boolean; def?: string } // [名字]、[time:int=0]
  | { kind: 'choice'; options: string[] } // in|out
  | { kind: 'literal'; text: string }; // 固定字
type Choice = { label: string; detail: string };

interface Usage {
  params: Param[];
  format: string; // 原本寫的格式，顯示在補齊清單旁邊
  description: string;
  ownOptions: Map<string, Choice[]>; // 指令卡上和參數同名的欄位列出的選項（參數名稱 → 選項）
}

type Command = { name: string; usages: Usage[]; description: string }; // name 含 #，例如 #name
type ParamValue = { value: string; source: string };

let commands: Command[] = [];
let paramValues = new Map<string, ParamValue[]>(); // 參數名稱 → 可選的值
let paramSources = new Map<string, string[]>(); // 參數名稱 → 在欄位設定裡是哪個區塊的哪個欄位（例如「角色的名稱」）

const fieldOf = (card: Card, key: string) => card.fields.find((f) => f.key === key)?.value.trim() ?? '';
const linesOf = (text: string) => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

function parseParam(token: string): Param {
  const ref = /^\[([^\]:?=]+)(?::(int|float|text))?(\?)?(?:=([^\]]*))?\]$/.exec(token);
  if (ref) return { kind: 'ref', name: ref[1], type: ref[2] as ParamType | undefined, optional: !!ref[3] || ref[4] !== undefined, def: ref[4] };
  if (/[|/]/.test(token)) return { kind: 'choice', options: token.split(/[|/]/).filter(Boolean) };
  return { kind: 'literal', text: token };
}

function paramLabel(p: Param) {
  if (p.kind === 'choice') return p.options.join('/');
  if (p.kind === 'literal') return p.text;
  const core = p.type ? `(${p.type})${p.name}` : p.name;
  return p.optional ? `[${core}]` : core;
}

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

function parseOptions(text: string): Choice[] {
  return text.split(/\r?\n/).flatMap((line) => {
    const m = /^\s*([^：:]+?)\s*(?:[：:]\s*(.*))?$/.exec(line);
    return m && m[1] ? [{ label: m[1], detail: m[2]?.trim() ?? '' }] : [];
  });
}

export function setScriptData(cards: Record<CardSectionId, Card[]>, schemas: Schemas) {
  const byName = new Map<string, Command>();
  for (const card of cards.commands) {
    const lines = linesOf(fieldOf(card, '用法'));
    const title = card.name.trim();
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
        if (field) ownOptions.set(field.key, parseOptions(field.value));
      }
      const cmd = byName.get(name) ?? byName.set(name, { name, usages: [], description }).get(name)!;
      cmd.description ||= description;
      if (!cmd.usages.some((u) => u.format === format)) cmd.usages.push({ params, format, description: desc, ownOptions });
    }
  }
  commands = [...byName.values()];
  paramValues = new Map();
  paramSources = new Map();
  const addSource = (param: string, text: string) => paramSources.set(param, [...(paramSources.get(param) ?? []), text]);
  const collect = (param: string, section: CardSectionId, valueOf: (card: Card) => string) => {
    const list = paramValues.get(param) ?? [];
    for (const card of cards[section] ?? []) {
      const value = valueOf(card);
      if (value && !list.some((v) => v.value === value)) list.push({ value, source: `${sectionMeta(section).title}／${card.name}` });
    }
    paramValues.set(param, list);
  };
  for (const section of Object.keys(schemas) as CardSectionId[]) {
    const { nameParam, fields } = schemas[section];
    const title = sectionMeta(section).title;
    if (nameParam) collect(nameParam, section, (card) => card.name.trim()), addSource(nameParam, `${title}的名稱`);
    for (const field of fields) if (field.param) collect(field.param, section, (card) => fieldOf(card, field.key)), addSource(field.param, `${title}的「${field.key}」`);
  }
  for (const model of monaco.editor.getModels()) refresh(model);
  for (const cb of [...dataListeners]) cb();
}

// 指令資料變動的通知（Notion 式編輯器重算提示和紅線）
const dataListeners = new Set<() => void>();
export function onScriptDataChange(cb: () => void): () => void {
  dataListeners.add(cb);
  return () => void dataListeners.delete(cb);
}

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

const allowedValues = (u: Usage, name: string) => u.ownOptions.get(name)?.map((c) => c.label) ?? (paramValues.get(name) ?? []).map((v) => v.value);

function accepts(u: Usage, p: Param, word: string) {
  if (p.kind === 'literal') return word === p.text;
  if (p.kind === 'choice') return p.options.includes(word);
  if (p.type === 'int' && !/^-?\d+$/.test(word)) return false;
  if (p.type === 'float' && !/^-?\d+(\.\d+)?$/.test(word)) return false;
  const list = allowedValues(u, p.name);
  return list.length === 0 || list.includes(word);
}

const matchUsages = (cmd: Command, words: string[]) =>
  cmd.usages.filter((u) => words.every((w, i) => u.params[i] && accepts(u, u.params[i], w)));
function paramChoices(u: Usage, p: Param): Choice[] {
  if (p.kind === 'choice') return p.options.map((o) => ({ label: o, detail: '' }));
  if (p.kind === 'literal') return [{ label: p.text, detail: u.description || u.format }];
  const values = u.ownOptions.get(p.name) ?? (paramValues.get(p.name) ?? []).map((v) => ({ label: v.value, detail: v.source }));
  return values.length > 0 || p.def === undefined ? values : [{ label: p.def, detail: '預設值' }];
}

export type ScriptProblem = { line: number; startColumn: number; endColumn: number; message: string };

export function checkScript(lines: string[]): ScriptProblem[] {
  const problems: ScriptProblem[] = [];
  lines.forEach((raw, index) => {
    if (HEADING.test(raw)) return;
    const text = codeOf(raw);
    const mark = (message: string, start: number, end: number) => problems.push({ line: index + 1, startColumn: start + 1, endColumn: end + 1, message });
    for (const p of rubyProblems(text)) mark(p.message, p.start, p.end);
    const line = parseLine(text);
    const cmd = line && findCommand(line.name);
    if (!line || !cmd) return;
    const re = /\S+/g;
    re.lastIndex = line.indent + line.name.length;
    const parts: { word: string; start: number }[] = [];
    for (let m = re.exec(text); m; m = re.exec(text)) parts.push({ word: m[0], start: m.index });
    // 第一個對不上任何寫法的段落標「參數錯誤」（後面的不再檢查）；都對但還缺必填的參數，指令名稱標「缺少參數」
    const bad = parts.find((part, i) => !matchUsages(cmd, parts.slice(0, i).map((p) => p.word)).some((u) => u.params[i] && accepts(u, u.params[i], part.word)));
    if (bad) return mark('參數錯誤', bad.start, bad.start + bad.word.length);
    const words = parts.map((p) => p.word);
    if (!matchUsages(cmd, words).some((u) => u.params.slice(words.length).every((p) => p.kind === 'ref' && p.optional)))
      mark('缺少參數', line.indent, line.indent + line.name.length);
  });
  return problems;
}

function validate(model: monaco.editor.ITextModel) {
  const problems = model.getLanguageId() === LANGUAGE_ID ? checkScript(model.getLinesContent()) : [];
  const markers = problems.map(({ line, ...p }) => ({ ...p, severity: monaco.MarkerSeverity.Error, startLineNumber: line, endLineNumber: line }));
  monaco.editor.setModelMarkers(model, LANGUAGE_ID, markers);
}

type ScriptView = { el: () => HTMLElement; reveal: (line: number, column: number, endColumn?: number) => void };
const scriptViews = new Map<string, Set<ScriptView>>();
// Notion 式劇本編輯器登記自己（回傳取消登記的函式）
export function registerScriptView(fileId: string, view: ScriptView) {
  const set = scriptViews.get(fileId) ?? scriptViews.set(fileId, new Set()).get(fileId)!;
  set.add(view);
  return () => void set.delete(view);
}

export function revealInEditor(fileId: string, line: number, column: number, endColumn?: number, tries = 30) {
  const view = [...(scriptViews.get(fileId) ?? [])].find((v) => v.el().offsetParent !== null);
  if (view) return view.reveal(line, column, endColumn);
  const editor = monaco.editor.getEditors().find((e) => e.getModel()?.uri.path.replace(/^\//, '') === fileId && e.getContainerDomNode().offsetParent !== null);
  if (!editor) return void (tries > 0 && setTimeout(() => revealInEditor(fileId, line, column, endColumn, tries - 1), 50));
  if (endColumn) editor.setSelection({ startLineNumber: line, startColumn: column, endLineNumber: line, endColumn });
  else editor.setPosition({ lineNumber: line, column });
  editor.revealLineInCenterIfOutsideViewport(line);
  editor.focus();
}

function missingLabel(text: string): { label: string; more: number } | null {
  const line = parseLine(text);
  const cmd = line && findCommand(line.name);
  if (!line || !cmd) return null;
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

// 標題：「= 大」「== 中」「=== 小」（=後面要有空白），前面加 // 是被註解掉的標題（大綱仍會列出）。群組：縮排、//、=們、空白、文字
export const HEADING = /^(\s*)(\/\/)?(={1,3})(?!=)(\s+)(.*)$/;

const headingLevel = (line: string) => HEADING.exec(line)?.[3].length ?? 0;
export const scriptHeadings = (lines: string[]) =>
  lines.flatMap((line, i) => {
    const m = HEADING.exec(line);
    return m ? [{ level: m[3].length, text: m[5].trim(), pos: i + 1 }] : [];
  });

export function setHeadingLevel(line: string, level: number): string {
  const m = HEADING.exec(line);
  const indent = /^\s*/.exec(line)![0];
  const text = m ? m[5] : line.trim();
  const comment = m?.[2] ?? '';
  if (level === 0) return comment ? `${indent}// ${text}` : indent + text;
  return `${indent}${comment}${'='.repeat(level)} ${text}`;
}

// 補齊：before = 這一行游標前面的文字；from = 要被取代的那一段從第幾個字開始（0 起算）
// 行首打指令名稱時列出指令；指令後面列出這個位置的參數可以選什麼（retrigger = 選完還有下一個參數，要接著再開清單）
export type ScriptCompletion = { kind: 'command' | 'value'; label: string; detail: string; documentation?: string; insertText: string; retrigger: boolean };
export function completionsAt(before: string): { from: number; items: ScriptCompletion[] } {
  const none = { from: before.length, items: [] };
  if (before.includes('//') || HEADING.test(before)) return none; // 在註解或標題裡
  const line = parseLine(before);
  if (!line) return none;
  if (line.rest === '') {
    const items = commands.map((c): ScriptCompletion => {
      const hasParams = c.usages.some((u) => u.params.length > 0);
      return {
        kind: 'command',
        label: c.name,
        detail: c.usages.length > 1 ? `${c.usages[0].format}（共 ${c.usages.length} 種寫法）` : c.usages[0].format,
        documentation: [c.description, ...c.usages.map((u) => (u.description ? `${u.format}：${u.description}` : u.format))].filter(Boolean).join('\n'),
        insertText: hasParams ? `${c.name} ` : c.name,
        retrigger: hasParams,
      };
    });
    return { from: line.indent, items };
  }
  const cmd = findCommand(line.name);
  if (!cmd) return none;
  const typing = line.endsWithSpace ? '' : (line.words[line.words.length - 1] ?? '');
  const done = line.endsWithSpace ? line.words : line.words.slice(0, -1);
  const merged = new Map<string, { choice: Choice; hasMore: boolean }>();
  for (const u of matchUsages(cmd, done)) {
    const p = u.params[done.length];
    if (!p) continue;
    const hasMore = u.params.length > done.length + 1;
    for (const c of paramChoices(u, p)) {
      const seen = merged.get(c.label);
      if (seen) seen.hasMore ||= hasMore;
      else merged.set(c.label, { choice: c, hasMore });
    }
  }
  const items = [...merged.values()].map(({ choice: c, hasMore }): ScriptCompletion => ({ kind: 'value', label: c.label, detail: c.detail, insertText: hasMore ? `${c.label} ` : c.label, retrigger: hasMore }));
  return { from: before.length - typing.length, items };
}

// 行尾的參數提示：這一行（不含 // 註解）還缺哪些參數；more = 另外還有幾種寫法
export const missingHint = (line: string) => missingLabel(codeOf(line));

const hintIds = new WeakMap<monaco.editor.ITextModel, string[]>();

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
      decorations.push({ range: new monaco.Range(n, end, n, end), options: { showIfCollapsed: true, afterContentClassName: cls } });
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

export function registerScriptLanguage() {
  if (registered) return;
  registered = true;
  monaco.languages.register({ id: LANGUAGE_ID, extensions: ['.vns'] });
  monaco.languages.setLanguageConfiguration(LANGUAGE_ID, { comments: { lineComment: '//' } });
  monaco.languages.setMonarchTokensProvider(LANGUAGE_ID, {
    tokenizer: {
      root: [
        [/^\s*===(?!=)\s.*/, 'heading3'],
        [/^\s*==(?!=)\s.*/, 'heading2'],
        [/^\s*=(?!=)\s.*/, 'heading1'],
        [/\/\/.*/, 'comment'],
        [/(\s*)(#(?:[^\s/]|\/(?!\/))*)((?:[^/]|\/(?!\/))*)/, ['', 'command', 'argument']],
        [/(?:[^/]|\/(?!\/))+/, ''],
      ],
    },
  });
  // 配色：指令、參數、註解、大中小標題（深色、淺色、高對比各一套）
  const themes = [
    ['vn-dark', 'vs-dark', 'C586C0 9CDCFE 6A9955 E2C08D 7FB4E0 C8C8C8'],
    ['vn-light', 'vs', 'AF00DB 0451A5 008000 9A6700 0451A5 444444'],
    ['vn-hc', 'hc-black', 'E4A0FF 9CDCFE 7CA668 FFD700 9CDCFE FFFFFF'],
  ] as const;
  for (const [name, base, colors] of themes) {
    const rules = ['command', 'argument', 'comment', 'heading1', 'heading2', 'heading3'].map((token, i) => ({
      token,
      foreground: colors.split(' ')[i],
      ...(i !== 1 && i !== 2 && { fontStyle: 'bold' }),
    }));
    monaco.editor.defineTheme(name, { base, inherit: true, rules, colors: {} });
  }
  monaco.languages.registerCompletionItemProvider(LANGUAGE_ID, {
    triggerCharacters: ['#', ' '],
    provideCompletionItems(model, position) {
      const { from, items } = completionsAt(model.getLineContent(position.lineNumber).slice(0, position.column - 1));
      const range = new monaco.Range(position.lineNumber, from + 1, position.lineNumber, position.column);
      const { Keyword, Value } = monaco.languages.CompletionItemKind;
      return {
        suggestions: items.map((c, i) => ({
          ...c,
          kind: c.kind === 'command' ? Keyword : Value,
          command: c.retrigger ? { id: 'editor.action.triggerSuggest', title: '' } : undefined,
          range,
          sortText: String(i).padStart(4, '0'), // 照欄位裡寫的順序排，不要被改成字母順序
        })),
      };
    },
  });
  const watch = (model: monaco.editor.ITextModel) => {
    refresh(model);
    model.onDidChangeContent(() => refresh(model));
    model.onDidChangeLanguage(() => refresh(model));
  };
  monaco.editor.getModels().forEach(watch);
  monaco.editor.onDidCreateModel(watch);
}

export const FIXED_COMMAND_FIELDS: { name: string; description: string }[] = [
  { name: '用法', description: '這個指令的各種寫法：一行寫一種，冒號後面是說明，例如\n#fade in [time:int=0]：淡入' },
  { name: '說明', description: '這個指令是做什麼的：會顯示在劇本的補齊清單裡' },
];

export function commandSpecialFields(card: Card): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of FIXED_COMMAND_FIELDS) out.set(f.name, f.description);
  const lines = [card.name, ...linesOf(fieldOf(card, '用法'))];
  for (const line of lines) {
    for (const token of splitDescription(line)[0].split(/\s+/).slice(1)) {
      const p = parseParam(token);
      if (p.kind === 'ref' && !out.has(p.name)) out.set(p.name, `參數 [${p.name}] 可以選的值：一行一個，冒號後面是說明，例如\nblack：黑色`);
    }
  }
  return out;
}

export function usedParams(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const cmd of commands)
    for (const p of cmd.usages.flatMap((u) => u.params)) {
      if (p.kind !== 'ref') continue;
      const list = out.get(p.name) ?? out.set(p.name, []).get(p.name)!;
      if (!list.includes(cmd.name)) list.push(cmd.name);
    }
  return out;
}

export const definedParams = () => paramSources;

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
