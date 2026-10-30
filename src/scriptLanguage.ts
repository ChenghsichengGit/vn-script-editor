// 劇本（.vns）的語言功能：指令上色、打 # 自動補齊、選參數、參數提示的灰色小色塊
//
// 指令定義來自「指令」區塊的卡：「格式」欄位寫成 #name [名字]、#fade in|out 這樣
//   第一段 #xxx           = 指令名稱
//   [名字]                = 參數。可以選的值依序找：
//                             1. 同一張指令卡上有沒有叫「名字」的欄位：一行一個選項，「in：淡入」冒號後面是說明
//                             2. 欄位範本裡「指令參數」設成「名字」的欄位（或卡片名稱）的內容
//   in/out 或 in|out      = 固定選項，只能選其中一個（選項少的時候直接寫在格式裡）
//   其他文字              = 照抄的固定字
// 指令要寫在一行的開頭（前面可以有空白），參數之間用空白分開
import * as monaco from 'monaco-editor';
import { Card, CardSectionId, Schemas } from './model';
import { sectionMeta } from './sampleData';

export const LANGUAGE_ID = 'vns';

type Param =
  | { kind: 'ref'; name: string } // [名字]
  | { kind: 'choice'; options: string[] } // in|out
  | { kind: 'literal'; text: string }; // 固定字

// 補齊清單裡的一個選項
interface Choice {
  label: string;
  detail: string;
}

interface Command {
  name: string; // 含 #，例如 #name
  params: Param[];
  ownOptions: Map<string, Choice[]>; // 指令卡上和參數同名的欄位列出的選項（參數名稱 → 選項）
  format: string; // 原本寫的格式，顯示在補齊清單旁邊
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

const hintsChanged = new monaco.Emitter<void>();

const fieldOf = (card: Card, key: string) => card.fields.find((f) => f.key === key)?.value.trim() ?? '';

function parseParam(token: string): Param {
  const ref = /^\[(.+)\]$/.exec(token);
  if (ref) return { kind: 'ref', name: ref[1] };
  if (/[|/]/.test(token)) return { kind: 'choice', options: token.split(/[|/]/).filter(Boolean) };
  return { kind: 'literal', text: token };
}

// 參數顯示在提示色塊裡的文字
const paramLabel = (p: Param) => (p.kind === 'ref' ? p.name : p.kind === 'choice' ? p.options.join('/') : p.text);

// 欄位內容裡一行一個選項，「in：淡入」或「in: 淡入」冒號後面是說明
function parseOptions(text: string): Choice[] {
  return text.split(/\r?\n/).flatMap((line) => {
    const m = /^\s*([^：:]+?)\s*(?:[：:]\s*(.*))?$/.exec(line);
    return m && m[1] ? [{ label: m[1], detail: m[2]?.trim() || '選項' }] : [];
  });
}

export function setScriptData(cards: Record<CardSectionId, Card[]>, schemas: Schemas) {
  // 指令清單：「格式」沒寫就用卡片名稱；不是 # 開頭的不算指令。同名指令只取第一個
  const seen = new Set<string>();
  commands = cards.commands.flatMap((card): Command[] => {
    const format = fieldOf(card, '格式') || card.name.trim();
    const [name, ...rest] = format.split(/\s+/);
    if (!name?.startsWith('#') || name.length < 2 || seen.has(name)) return [];
    seen.add(name);
    const params = rest.map(parseParam);
    const ownOptions = new Map<string, Choice[]>();
    for (const p of params) {
      const field = p.kind === 'ref' && card.fields.find((f) => f.key === p.name && f.value.trim());
      if (p.kind === 'ref' && field) ownOptions.set(p.name, parseOptions(field.value));
    }
    return [{ name, params, ownOptions, format, description: fieldOf(card, '說明') }];
  });

  // 參數的可選值：每個區塊範本裡有設「指令參數」的欄位（含卡片名稱），收集所有卡的那個內容（空白的跳過、重複的只留一個）
  paramValues = new Map();
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
    if (nameParam) collect(nameParam, section, (card) => card.name.trim());
    for (const field of fields) {
      if (field.param) collect(field.param, section, (card) => fieldOf(card, field.key));
    }
  }
  hintsChanged.fire();
}

// 拆開一行指令：沒有寫指令就回傳 null
// words = 指令名稱後面已經寫的每一段；endsWithSpace = 最後一段後面是不是已經打了空白（正在等下一個參數）
function parseLine(text: string) {
  const m = /^(\s*)(#\S*)(.*)$/.exec(text);
  if (!m) return null;
  const rest = m[3];
  const words = rest.split(/\s+/).filter(Boolean);
  return { indent: m[1].length, name: m[2], rest, words, endsWithSpace: /\s$/.test(rest) };
}

const findCommand = (name: string) => commands.find((c) => c.name === name);

// 某個參數可以選的項目：先看指令卡自己的同名欄位，沒有才用範本裡的參數值
function paramChoices(cmd: Command, p: Param): Choice[] {
  if (p.kind === 'choice') return p.options.map((o) => ({ label: o, detail: '選項' }));
  if (p.kind === 'literal') return [{ label: p.text, detail: '固定字' }];
  const own = cmd.ownOptions.get(p.name);
  if (own) return own;
  return (paramValues.get(p.name) ?? []).map((v) => ({ label: v.value, detail: v.source }));
}

let registered = false;

// 註冊語言和各種功能；只會做一次（所有劇本編輯器共用）
export function registerScriptLanguage() {
  if (registered) return;
  registered = true;

  monaco.languages.register({ id: LANGUAGE_ID, extensions: ['.vns'] });

  // 上色：行首的 #指令 一個顏色，後面的參數另一個顏色
  // （這套上色規則是從每行開頭比對：開頭是 #xxx 就整行拆成「空白／指令／參數」三段，否則整行是一般文字）
  monaco.languages.setMonarchTokensProvider(LANGUAGE_ID, {
    tokenizer: {
      root: [
        [/(\s*)(#\S*)(.*)/, ['', 'command', 'argument']],
        [/.+/, ''],
      ],
    },
  });
  monaco.editor.defineTheme('vn-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'command', foreground: 'C586C0', fontStyle: 'bold' },
      { token: 'argument', foreground: '9CDCFE' },
    ],
    colors: {},
  });

  // 自動補齊：打 # 列出指令；指令後面打空白，列出這個位置的參數可以選什麼
  monaco.languages.registerCompletionItemProvider(LANGUAGE_ID, {
    triggerCharacters: ['#', ' '],
    provideCompletionItems(model, position) {
      const before = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
      const line = parseLine(before);
      if (!line) return { suggestions: [] };

      // 還在打指令名稱：補齊範圍是從 # 到游標
      if (line.rest === '') {
        const range = new monaco.Range(position.lineNumber, line.indent + 1, position.lineNumber, position.column);
        return {
          suggestions: commands.map((c, i) => ({
            label: c.name,
            kind: monaco.languages.CompletionItemKind.Keyword,
            detail: c.format,
            documentation: c.description || undefined,
            // 有參數的指令：補完自動空一格，並立刻再打開清單讓你選第一個參數
            insertText: c.params.length > 0 ? `${c.name} ` : c.name,
            command: c.params.length > 0 ? { id: 'editor.action.triggerSuggest', title: '' } : undefined,
            range,
            sortText: String(i).padStart(4, '0'),
          })),
        };
      }

      // 在參數的位置：算出現在是第幾個參數，正在打的那段就是補齊範圍
      const cmd = findCommand(line.name);
      if (!cmd) return { suggestions: [] };
      const typing = line.endsWithSpace ? '' : line.words[line.words.length - 1] ?? '';
      const index = line.endsWithSpace ? line.words.length : line.words.length - 1;
      const param = cmd.params[index];
      if (!param) return { suggestions: [] };
      const hasMore = index < cmd.params.length - 1;
      const range = new monaco.Range(position.lineNumber, position.column - typing.length, position.lineNumber, position.column);
      return {
        suggestions: paramChoices(cmd, param).map((c, i) => ({
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

  // 參數提示：指令還缺哪些參數，就在那一行最後面顯示灰色小色塊（填完就消失）
  monaco.languages.registerInlayHintsProvider(LANGUAGE_ID, {
    onDidChangeInlayHints: hintsChanged.event,
    provideInlayHints(model, range) {
      const hints: monaco.languages.InlayHint[] = [];
      for (let n = range.startLineNumber; n <= range.endLineNumber; n++) {
        const text = model.getLineContent(n);
        const line = parseLine(text);
        const cmd = line && findCommand(line.name);
        if (!line || !cmd) continue;
        // 正在打的最後一段（後面沒有空白）也算已經填了
        const missing = cmd.params.slice(line.words.length);
        if (missing.length === 0) continue;
        hints.push({
          position: { lineNumber: n, column: text.length + 1 },
          label: missing.map(paramLabel).join('  '),
          paddingLeft: !line.endsWithSpace,
        });
      }
      return { hints, dispose: () => {} };
    },
  });
}
