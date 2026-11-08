// 劇本指令的自動補齊（Notion 式編輯器）：在指令區塊打字時自動跳出清單，Ctrl+Space 也能叫出來
//   上下鍵選、Enter／Tab 接受、Esc 關掉；接受後還有下一個參數就再跳出來
//   候選項目由 scriptLanguage.ts 的 completionsAt 算（跟舊的 Monaco 編輯器同一套）
import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { Editor, Extension } from '@tiptap/core';
import { EditorState, Plugin, PluginKey, Transaction } from '@tiptap/pm/state';
import { ReplaceStep } from '@tiptap/pm/transform';
import { completionsAt, ScriptCompletion } from '../scriptLanguage';

// from～to：要被換掉的字（文件裡的位置）；index：反白的那一項
export type CompletionState = { open: boolean; items: ScriptCompletion[]; index: number; from: number; to: number };
type Meta = { type: 'open' } | { type: 'close' } | { type: 'move'; index: number } | { type: 'accept'; retrigger: boolean };

const CLOSED: CompletionState = { open: false, items: [], index: 0, from: 0, to: 0 };
export const completionKey = new PluginKey<CompletionState>('vnsCompletion');

// 只留標籤含有已打的字的項目（不分大小寫，保持原本順序）；只剩跟打的字一模一樣的就不用跳了
export function filterCompletions(items: ScriptCompletion[], typed: string) {
  const t = typed.toLowerCase();
  const out = items.filter((c) => c.label.toLowerCase().includes(t));
  return out.every((c) => c.label.toLowerCase() === t) ? [] : out;
}

// 游標所在的指令區塊：游標前的文字、區塊內容的起點
function caretContext(state: EditorState) {
  const { empty, $head } = state.selection;
  if (!empty || $head.parent.type.name !== 'vnsCommand') return null;
  return { before: $head.parent.textContent.slice(0, $head.parentOffset), start: $head.start(), caret: $head.pos };
}

// 依游標位置重算；prev 有給就盡量留住原本反白的那一項
function compute(state: EditorState, prev?: CompletionState): CompletionState {
  const ctx = caretContext(state);
  if (!ctx) return CLOSED;
  const { from, items } = completionsAt(ctx.before);
  const list = filterCompletions(items, ctx.before.slice(from));
  if (!list.length) return CLOSED;
  const keep = prev?.open ? list.findIndex((c) => c.label === prev.items[prev.index]?.label) : -1;
  return { open: true, items: list, index: Math.max(keep, 0), from: ctx.start + from, to: ctx.caret };
}

// 這一筆是打字造成的（有插入文字，不是貼上、拖放、外部重新載入）
function typed(tr: Transaction) {
  const root: Transaction = tr.getMeta('appendedTransaction') ?? tr;
  if (root.getMeta(completionKey) || root.getMeta('preventUpdate') || root.getMeta('uiEvent')) return false;
  return root.steps.some((s) => s instanceof ReplaceStep && s.slice.size > 0);
}

export const getCompletion = (state: EditorState) => completionKey.getState(state) ?? null;

// 接受第 index 項：換掉 from～to 的字；還有下一個參數就再跳出來
export function acceptCompletion(editor: Editor, index?: number) {
  const c = getCompletion(editor.state);
  const item = c?.open ? c.items[index ?? c.index] : undefined;
  if (!c || !item) return false;
  const tr = editor.state.tr.insertText(item.insertText, c.from, c.to).scrollIntoView();
  editor.view.dispatch(tr.setMeta(completionKey, { type: 'accept', retrigger: item.retrigger } satisfies Meta));
  return true;
}

export const selectCompletion = (editor: Editor, index: number) =>
  editor.view.dispatch(editor.state.tr.setMeta(completionKey, { type: 'move', index } satisfies Meta));

const send = (editor: Editor, meta: Meta) => (editor.view.dispatch(editor.state.tr.setMeta(completionKey, meta)), true);

export const VnsCompletion = Extension.create({
  name: 'vnsCompletion',
  priority: 1000, // 比 Enter 換行等內建按鍵先處理
  addKeyboardShortcuts() {
    const open = () => !!getCompletion(this.editor.state)?.open;
    const move = (d: number) => {
      const c = getCompletion(this.editor.state);
      if (!c?.open) return false;
      const n = c.items.length;
      return send(this.editor, { type: 'move', index: (c.index + d + n) % n });
    };
    return {
      'Ctrl-Space': () => send(this.editor, { type: 'open' }),
      ArrowUp: () => move(-1),
      ArrowDown: () => move(1),
      Enter: () => acceptCompletion(this.editor),
      Tab: () => acceptCompletion(this.editor),
      Escape: () => open() && send(this.editor, { type: 'close' }),
    };
  },
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin<CompletionState>({
        key: completionKey,
        state: {
          init: () => CLOSED,
          apply(tr, old, _oldState, state) {
            const meta = tr.getMeta(completionKey) as Meta | undefined;
            if (meta?.type === 'close') return CLOSED;
            if (meta?.type === 'open') return compute(state);
            if (meta?.type === 'accept') return meta.retrigger ? compute(state) : CLOSED;
            if (meta?.type === 'move') return old.open ? { ...old, index: Math.min(Math.max(meta.index, 0), old.items.length - 1) } : old;
            if (tr.docChanged && typed(tr)) return compute(state, old);
            // 開著時游標移動、刪字：重算（離開區塊或沒有項目就關掉）
            if (old.open && (tr.docChanged || tr.selectionSet)) return compute(state, old);
            return old;
          },
        },
        props: {
          handleDOMEvents: {
            blur: () => (getCompletion(editor.state)?.open && send(editor, { type: 'close' }), false),
          },
        },
      }),
    ];
  },
});

// 浮在游標下方的清單；反白那一項有說明就排在清單右邊
export function VnsCompletionPopup({ editor }: { editor: Editor | null }) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    if (!editor) return;
    editor.on('transaction', rerender);
    window.addEventListener('scroll', rerender, true);
    window.addEventListener('resize', rerender);
    return () => {
      editor.off('transaction', rerender);
      window.removeEventListener('scroll', rerender, true);
      window.removeEventListener('resize', rerender);
    };
  }, [editor]);
  const c = editor && !editor.isDestroyed ? getCompletion(editor.state) : null;
  const open = !!c?.open;
  // 每次重畫都量一次：放不下就往上翻、左右夾在視窗裡
  useLayoutEffect(() => {
    if (!open || !editor || !ref.current) return setPos(null);
    const at = editor.view.coordsAtPos(c!.to);
    const box = ref.current.getBoundingClientRect();
    const below = at.bottom + 2;
    const top = below + box.height > window.innerHeight && at.top - box.height - 2 >= 0 ? at.top - box.height - 2 : below;
    const next = { left: Math.max(0, Math.min(at.left, window.innerWidth - box.width)), top: Math.max(0, Math.min(top, window.innerHeight - box.height)) };
    setPos((p) => (p && p.left === next.left && p.top === next.top ? p : next));
  });
  useLayoutEffect(() => {
    listRef.current?.querySelector<HTMLElement>('.vns-complete-item.on')?.scrollIntoView({ block: 'nearest' });
  }, [open, c?.index, c?.items]);
  if (!open || !editor || !c) return null;
  const doc = c.items[c.index]?.documentation;
  return (
    <div className="vns-complete" ref={ref} style={pos ?? { left: -9999, top: -9999 }} onMouseDown={(e) => e.preventDefault()}>
      <div className="vns-complete-list" ref={listRef}>
        {c.items.map((item, i) => (
          <div
            key={item.label}
            className={`vns-complete-item${i === c.index ? ' on' : ''}`}
            onMouseEnter={() => i !== c.index && selectCompletion(editor, i)}
            onMouseDown={(e) => (e.preventDefault(), acceptCompletion(editor, i))}
          >
            <span className={`vns-complete-label ${item.kind}`}>{item.label}</span>
            {item.detail && <span className="vns-complete-detail">{item.detail}</span>}
          </div>
        ))}
      </div>
      {doc && <div className="vns-complete-doc">{doc}</div>}
    </div>
  );
}
