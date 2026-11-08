// 劇本的「所見即所得」顯示和標音、標題的操作（劇本編輯器 ScriptEditor 用）
import monaco from './monaco';
import { HEADING, setHeadingLevel } from './scriptLanguage';
import { findRubies, wrapRuby } from './ruby';
import { openRubyPrompt } from './components/RubyPrompt';

type CodeEditor = monaco.editor.ICodeEditor;

const hide: monaco.editor.IModelDecorationOptions = { inlineClassName: 'vns-hide', inlineClassNameAffectsLetterSpacing: true };
const dim: monaco.editor.IModelDecorationOptions = { inlineClassName: 'vns-ruby-syntax' };
const range = (line: number, from: number, to: number) => new monaco.Range(line, from + 1, line, to + 1);

function lineDecorations(text: string, n: number, editing: boolean): monaco.editor.IModelDeltaDecoration[] {
  const out: monaco.editor.IModelDeltaDecoration[] = [];
  if (!editing) {
    const h = HEADING.exec(text);
    if (h) {
      const markEnd = h[1].length + (h[2]?.length ?? 0) + h[3].length + h[4].length;
      const cls = `vns-title${h[3].length}${h[2] ? ' vns-title-commented' : ''}`;
      out.push({ range: range(n, h[1].length, markEnd), options: hide });
      out.push({ range: range(n, markEnd, text.length), options: { inlineClassName: cls, inlineClassNameAffectsLetterSpacing: true } });
    }
  }
  for (const r of findRubies(text)) {
    const baseEnd = r.start + 1 + r.base.length;
    if (editing) {
      out.push({ range: range(n, r.start, r.start + 1), options: dim });
      out.push({ range: range(n, baseEnd, r.end), options: dim });
    } else {
      out.push({ range: range(n, r.start, r.start + 1), options: hide });
      out.push({ range: range(n, baseEnd, r.end), options: hide });
      out.push({
        range: range(n, r.start + 1, baseEnd),
        options: {
          inlineClassName: 'vns-ruby-base',
          before: { content: r.rt, inlineClassName: 'vns-ruby-rt', cursorStops: monaco.editor.InjectedTextCursorStops.None },
        },
      });
    }
  }
  return out;
}

export function attachPreview(editor: CodeEditor) {
  const decorations = editor.createDecorationsCollection();
  const update = () => {
    const model = editor.getModel();
    if (!model) return;
    const editing = new Set<number>();
    if (editor.hasTextFocus())
      for (const s of editor.getSelections() ?? []) for (let n = s.startLineNumber; n <= s.endLineNumber; n++) editing.add(n);
    decorations.set(model.getLinesContent().flatMap((text, i) => lineDecorations(text, i + 1, editing.has(i + 1))));
  };
  update();
  editor.onDidChangeModelContent(update);
  editor.onDidChangeCursorSelection(update);
  editor.onDidFocusEditorText(update);
  editor.onDidBlurEditorText(update);
}

export function setHeadingLines(editor: CodeEditor, level: number) {
  const model = editor.getModel();
  const selections = editor.getSelections();
  if (!model || !selections) return;
  const lines = new Set<number>();
  for (const s of selections) for (let n = s.startLineNumber; n <= s.endLineNumber; n++) lines.add(n);
  editor.executeEdits(
    'heading',
    [...lines].map((n) => ({ range: new monaco.Range(n, 1, n, model.getLineMaxColumn(n)), text: setHeadingLevel(model.getLineContent(n), level) })),
  );
}

export function promptScriptRuby(editor: CodeEditor) {
  const model = editor.getModel();
  const sel = editor.getSelection();
  if (!model || !sel || sel.startLineNumber !== sel.endLineNumber) return;
  const n = sel.startLineNumber;
  const text = model.getLineContent(n);
  const from = sel.startColumn - 1;
  const to = sel.endColumn - 1;
  const existing = findRubies(text).find((r) => r.start <= from && to <= r.end);
  const target = existing
    ? { start: existing.start, end: existing.end, base: existing.base, rt: existing.rt }
    : { start: from, end: to, base: text.slice(from, to), rt: '' };
  if (!target.base.trim() || /[{}|]/.test(target.base)) return;
  const at = editor.getScrolledVisiblePosition({ lineNumber: n, column: target.start + 1 });
  const box = editor.getDomNode()?.getBoundingClientRect();
  if (!at || !box) return;
  openRubyPrompt({
    x: box.left + at.left,
    y: box.top + at.top + at.height + 4,
    base: target.base,
    rt: target.rt,
    onSubmit: (rt) => editor.executeEdits('ruby', [{ range: range(n, target.start, target.end), text: wrapRuby(target.base, rt) }]),
    onClose: () => editor.focus(),
  });
}

export function addScriptActions(editor: monaco.editor.IStandaloneCodeEditor) {
  editor.addAction({
    id: 'vns.ruby',
    label: '標音…',
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyR],
    contextMenuGroupId: '0_heading',
    contextMenuOrder: -1,
    run: promptScriptRuby,
  });
  const labels = ['取消標題', '設為大標題', '設為中標題', '設為小標題'];
  [1, 2, 3, 0].forEach((level, order) =>
    editor.addAction({
      id: `vns.heading${level}`,
      label: labels[level],
      contextMenuGroupId: '0_heading',
      contextMenuOrder: order,
      run: (ed) => setHeadingLines(ed, level),
    }),
  );
}

export interface BubbleState {
  x: number;
  y: number;
  multiLine: boolean;
}
const BUBBLE_HEIGHT = 34;

export function trackSelectionBubble(editor: CodeEditor, container: () => HTMLElement | null, onChange: (b: BubbleState | null) => void) {
  let mouseDown = false;
  const place = () => {
    const sel = editor.getSelection();
    const main = container()?.getBoundingClientRect();
    const box = editor.getDomNode()?.getBoundingClientRect();
    const at = sel && !sel.isEmpty() && editor.hasTextFocus() ? editor.getScrolledVisiblePosition(sel.getStartPosition()) : null;
    if (mouseDown || !sel || !at || !main || !box || at.top < 0 || at.top > box.height) return onChange(null);
    const top = box.top - main.top + at.top;
    onChange({
      x: box.left - main.left + at.left,
      y: top >= BUBBLE_HEIGHT ? top - BUBBLE_HEIGHT : top + at.height + 4,
      multiLine: sel.startLineNumber !== sel.endLineNumber,
    });
  };
  const down = () => {
    mouseDown = true;
    onChange(null);
  };
  const up = () => {
    if (!mouseDown) return;
    mouseDown = false;
    place();
  };
  editor.getDomNode()?.addEventListener('mousedown', down);
  window.addEventListener('mouseup', up);
  editor.onDidChangeCursorSelection(place);
  editor.onDidScrollChange(place);
  editor.onDidBlurEditorText(() => onChange(null));
  editor.onDidDispose(() => window.removeEventListener('mouseup', up));
}
