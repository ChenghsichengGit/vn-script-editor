// Notion 式的劇本編輯器（.vns）：一行一個區塊，永遠顯示處理過的樣子
//   標題是真的大字、標音的讀音排在字的上方、註解照原文（看得到 //）、指令照原文但上色
//   打字時自動換區塊：行首打 # → 指令；打 // → 註解；打「= 」「== 」「=== 」→ 標題；註解裡打「//= 」→ 被註解掉的標題
//   標題看不到的 = 不會被退格／Delete 刪掉，要改回一般文字用工具列或右鍵
// 存回去的文字由 vnsDoc.ts 轉換，跟原本的 .vns 格式完全一樣
import { useEffect, useRef, useState } from 'react';
import { BubbleMenu, Editor, EditorContent, useEditor } from '@tiptap/react';
import { Extension, Node } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { EditorState, Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Fragment, Slice } from '@tiptap/pm/model';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { RubyNode, promptRuby } from './RubyMark';
import { blockOf, docToVns, isCommandText, isCommentText, lineOf, vnsToDoc } from '../vnsDoc';
import { registerScriptView } from '../scriptLanguage';
import { DEFAULT_FONT_FAMILY, getSettings, updateSettings, useSettings } from '../settings';
import { useLatest } from '../hooks';
import Outline, { Heading } from './Outline';
import ChangeBar from './ChangeBar';
import ContextMenu, { ContextMenuItem } from './ContextMenu';
import { VnsDiagnostics } from './VnsDiagnostics';
import { VnsCompletion, VnsCompletionPopup, completionKey } from './VnsCompletion';
import { VNS_EXTERNAL_META, VnsChangeMarks } from './VnsChangeMarks';
import { createVnsPlayer, registerVnsPlayer } from './VnsPlayback';

const HeadingAttrs = Extension.create({
  name: 'vnsHeadingAttrs',
  addGlobalAttributes: () => [
    {
      types: ['heading'],
      attributes: {
        indent: { default: '', rendered: false },
        sep: { default: ' ', rendered: false },
        // 被註解掉的標題：h1/h2/h3 加 data-comment，CSS 在前面畫出 //
        comment: { default: false, parseHTML: (el) => el.hasAttribute('data-comment'), renderHTML: (a) => (a.comment ? { 'data-comment': '' } : {}) },
      },
    },
  ],
});
// 註解：整行原文（縮排、// 都是文字），// 被刪掉就變回一般文字
const VnsComment = Node.create({
  name: 'vnsComment',
  group: 'block',
  content: 'text*',
  marks: '',
  priority: 1000,
  parseHTML: () => [{ tag: 'p.vns-comment' }],
  renderHTML: () => ['p', { class: 'vns-comment' }, 0],
});
const VnsCommand = Node.create({
  name: 'vnsCommand',
  group: 'block',
  content: 'text*',
  marks: '',
  priority: 1000,
  parseHTML: () => [{ tag: 'p.vns-command' }],
  renderHTML: () => ['p', { class: 'vns-command' }, 0],
});

// 所選範圍裡的每一行（最上層的區塊）
const selectedBlocks = (editor: Editor) => {
  const { doc, selection } = editor.state;
  const out: { node: import('@tiptap/pm/model').Node; pos: number }[] = [];
  doc.nodesBetween(selection.from, selection.to, (node, pos, parent) => (parent === doc && out.push({ node, pos }), false));
  return out;
};

type PMNode = import('@tiptap/pm/model').Node;
const isCommented = (node: PMNode) => node.type.name === 'vnsComment' || (node.type.name === 'heading' && !!node.attrs.comment);
// 去掉一個 //（和後面的一格空白），縮排留著
const stripComment = (line: string) => line.replace(/^(\s*)\/\/ ?/, '$1');

// 註解切換（Ctrl+/）：全部都已註解 → 取消註解；否則把還沒註解的行註解掉
//   標題：只切換 comment（//= 標題）；其他行：縮排後面加「// 」，取消時去掉 // 和後面的一格空白
export function toggleComment(editor: Editor) {
  const blocks = selectedBlocks(editor);
  const uncomment = blocks.every((b) => isCommented(b.node));
  const { schema } = editor.state;
  const tr = editor.state.tr;
  for (const { node, pos } of blocks.reverse()) {
    if (!uncomment && isCommented(node)) continue;
    if (node.type.name === 'heading') {
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, comment: !uncomment });
      continue;
    }
    const line = lineOf(node);
    const next = uncomment
      ? schema.nodeFromJSON(blockOf(stripComment(line)))
      : schema.text(line.replace(/^(\s*)(.*)$/, (_, s: string, rest: string) => `${s}//${rest ? ' ' : ''}${rest}`));
    if (uncomment) tr.replaceWith(pos, pos + node.nodeSize, next);
    else tr.replaceWith(pos, pos + node.nodeSize, schema.nodes.vnsComment.create(null, next));
  }
  editor.view.dispatch(tr);
}

// 設成標題／一般文字之前：所選的註解行先去掉 //（「// 文字」「//= 標題」都變成乾淨的內容），游標留在同一行
function uncommentBlocks(editor: Editor) {
  const { schema } = editor.state;
  const tr = editor.state.tr;
  for (const { node, pos } of selectedBlocks(editor).reverse()) {
    if (node.type.name === 'heading' && node.attrs.comment) tr.setNodeMarkup(pos, undefined, { ...node.attrs, comment: false });
    if (node.type.name !== 'vnsComment') continue;
    const json = blockOf(stripComment(node.textContent));
    const next = schema.nodeFromJSON(json.type === 'heading' ? { type: 'paragraph', content: json.content } : json);
    tr.setNodeMarkup(pos, next.type, next.attrs).replaceWith(pos + 1, pos + 1 + node.content.size, next.content);
  }
  if (tr.docChanged) editor.view.dispatch(tr);
}

const VnsBehavior = Extension.create({
  name: 'vnsBehavior',
  addKeyboardShortcuts() {
    return {
      'Mod-/': () => (toggleComment(this.editor), true),
      // 標題看不到的 = 不能用鍵盤刪掉：標題開頭按退格只會刪掉上面的空行（空的標題才變回一般文字）
      Backspace: () => {
        const { state, view } = this.editor;
        const { $from, empty } = state.selection;
        if (!empty || $from.depth !== 1 || $from.parentOffset !== 0 || $from.parent.type.name !== 'heading') return false;
        if ($from.parent.content.size === 0) return this.editor.commands.setNode('paragraph');
        const i = $from.index(0);
        const prev = i > 0 ? state.doc.child(i - 1) : null;
        if (prev && prev.content.size === 0) view.dispatch(state.tr.delete($from.before() - prev.nodeSize, $from.before()));
        return true;
      },
      // 標題上一行的行尾按 Delete：空行就刪掉，否則不併進標題
      Delete: () => {
        const { state, view } = this.editor;
        const { $from, empty } = state.selection;
        if (!empty || $from.depth !== 1 || $from.parentOffset !== $from.parent.content.size) return false;
        const i = $from.index(0);
        if (i + 1 >= state.doc.childCount || state.doc.child(i + 1).type.name !== 'heading') return false;
        if ($from.parent.content.size === 0) {
          const tr = state.tr.delete($from.before(), $from.after());
          view.dispatch(tr.setSelection(TextSelection.create(tr.doc, $from.before() + 1)));
        }
        return true;
      },
    };
  },
  addProseMirrorPlugins() {
    return [
      // 打字時依那一行開頭的寫法換區塊種類；輸入法選字中先不換（換了會重複輸入，例如 # 變 ##），選完再換
      new Plugin({
        appendTransaction(trs, _old, state) {
          if (!trs.some((t) => t.docChanged) || trs.some((t) => t.getMeta('composition'))) return null;
          return retype(state);
        },
        props: {
          handleDOMEvents: {
            compositionend: (view) => {
              setTimeout(() => {
                const tr = view.isDestroyed || view.composing ? null : retype(view.state);
                // 換成指令行時順便打開自動補齊（不是指令行會自己關掉）
                if (tr) view.dispatch(tr.setMeta(completionKey, { type: 'open' }));
              }, 30);
              return false;
            },
          },
        },
      }),
      // 指令上色：#指令名稱、參數、行尾的 // 註解
      new Plugin({
        key: new PluginKey('vnsCommandColors'),
        state: {
          init: (_, state) => commandDecorations(state.doc),
          apply: (tr, old) => (tr.docChanged ? commandDecorations(tr.doc) : old),
        },
        props: { decorations(state) { return this.getState(state); } },
      }),
    ];
  },
});

// 依游標那一行開頭的寫法換區塊種類（沒有要換就回傳 null）
function retype(state: EditorState) {
  const $h = state.selection.$head;
  if ($h.depth < 1) return null;
  const block = $h.node(1);
  const pos = $h.before(1);
  // 只看第一段純文字（後面可能有標音）
  const t = block.firstChild?.isText ? block.firstChild.text! : '';
  const plain = block.childCount === 0 || block.content.content.every((n) => n.isText);
  const { nodes } = state.schema;
  const to = (type: typeof nodes.paragraph, attrs: Record<string, unknown> | null, strip: number) => {
    const tr = state.tr.setNodeMarkup(pos, type, attrs);
    return strip ? tr.delete(pos + 1, pos + 1 + strip) : tr;
  };
  // 「= 」「//= 」：標記去掉，變成標題（記住縮排和空白）
  const heading = (re: RegExp, comment: boolean) => {
    const h = re.exec(t);
    return h && to(nodes.heading, { level: h[2].length, indent: h[1], sep: h[3], comment }, h[0].length);
  };
  if (block.type.name === 'paragraph') {
    const h = heading(/^(\s*)(={1,3})(?!=)(\s+)/, false);
    if (h) return h;
    if (plain && isCommentText(t)) return to(nodes.vnsComment, null, 0);
    if (plain && isCommandText(t)) return to(nodes.vnsCommand, null, 0);
  }
  if (block.type.name === 'vnsComment') return heading(/^(\s*)\/\/(={1,3})(?!=)(\s+)/, true) || (isCommentText(t) ? null : to(nodes.paragraph, null, 0));
  if (block.type.name === 'vnsCommand' && !isCommandText(t)) return to(nodes.paragraph, null, 0);
  return null;
}

function commandDecorations(doc: import('@tiptap/pm/model').Node) {
  const decos: Decoration[] = [];
  doc.forEach((node, offset) => {
    if (node.type.name !== 'vnsCommand') return;
    const t = node.textContent;
    const m = /^(\s*)(#\S*)/.exec(t);
    if (!m) return;
    const at = offset + 1;
    const comment = t.indexOf('//');
    const codeEnd = comment < 0 ? t.length : comment;
    decos.push(Decoration.inline(at + m[1].length, at + m[0].length, { class: 'vns-cmd-name' }));
    if (codeEnd > m[0].length) decos.push(Decoration.inline(at + m[0].length, at + codeEnd, { class: 'vns-cmd-arg' }));
    if (comment >= 0) decos.push(Decoration.inline(at + comment, at + t.length, { class: 'vns-cmd-comment' }));
  });
  return DecorationSet.create(doc, decos);
}

export const vnsExtensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    bold: false,
    italic: false,
    strike: false,
    code: false,
    codeBlock: false,
    blockquote: false,
    bulletList: false,
    orderedList: false,
    listItem: false,
    horizontalRule: false,
    hardBreak: false,
  }),
  HeadingAttrs,
  VnsComment,
  VnsCommand,
  RubyNode,
  VnsBehavior,
  VnsDiagnostics,
  VnsCompletion,
];
// 內建的 Markdown 輸入規則（「# 」變標題等）會跟 .vns 的 # 指令衝突，只留標音的
export const vnsInputRules = ['ruby'];

// 貼上的文字一行一個區塊（{本文|讀音} 也會變成標音）；第一行、最後一行接進游標所在的那一行
const parseSlice = (editor: Editor, text: string) => {
  const nodes = text.split(/\r?\n/).map((line) => editor.state.schema.nodeFromJSON(blockOf(line)));
  return new Slice(Fragment.fromArray(nodes), 1, 1);
};

export default function VnsEditor(props: {
  fileId: string;
  text: string;
  onChange: (text: string) => void;
  onCursor: (pos: { line: number; column: number }) => void;
  active: boolean;
}) {
  const settings = useSettings();
  const eol = useRef(props.text.includes('\r\n') ? '\r\n' : '\n');
  const emitted = useRef<string[]>([props.text]); // 自己最近回報出去的內容：App 傳回來的是其中之一就不用重設
  const onChangeRef = useLatest(props.onChange);
  const onCursorRef = useLatest(props.onCursor);
  const activeRef = useLatest(props.active);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [activeHeading, setActiveHeading] = useState(0);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const report = (ed: Editor) => {
    const $h = ed.state.selection.$head;
    if (activeRef.current) onCursorRef.current({ line: $h.index(0) + 1, column: $h.parentOffset + 1 });
  };
  const collect = (ed: Editor) => {
    const list: Heading[] = [];
    // 被註解掉的標題前面加 //（Outline 沒有另外的欄位可以標）
    ed.state.doc.forEach((node, offset) => node.type.name === 'heading' && list.push({ level: node.attrs.level, text: (node.attrs.comment ? '// ' : '') + node.textContent, pos: offset }));
    setHeadings(list);
  };
  const editor = useEditor({
    extensions: [...vnsExtensions, VnsChangeMarks.configure({ fileId: props.fileId })],
    enableInputRules: vnsInputRules,
    content: vnsToDoc(props.text),
    onCreate: ({ editor }) => collect(editor),
    onUpdate: ({ editor }) => {
      const text = docToVns(editor.state.doc, eol.current);
      emitted.current = [...emitted.current.slice(-30), text];
      onChangeRef.current(text);
      collect(editor);
    },
    onSelectionUpdate: ({ editor }) => report(editor),
    editorProps: {
      attributes: { class: 'vns-doc', spellcheck: 'false' },
      handlePaste: (view, event) => {
        const text = event.clipboardData?.getData('text/plain');
        if (text == null || !editorRef.current) return false;
        view.dispatch(view.state.tr.replaceSelection(parseSlice(editorRef.current, text)).scrollIntoView());
        return true;
      },
      clipboardTextSerializer: (slice) => {
        const lines: string[] = [];
        slice.content.forEach((node) => lines.push(node.isTextblock ? lineOf(node) : node.textContent));
        return lines.join('\n');
      },
    },
  });
  const editorRef = useLatest(editor);
  // 外面改了內容（外部修改、搜尋取代…）：重新載入，游標盡量留在原地
  useEffect(() => {
    if (!editor || editor.isDestroyed || emitted.current.includes(props.text) || docToVns(editor.state.doc, eol.current) === props.text) return;
    emitted.current = [props.text];
    const { from } = editor.state.selection;
    // 標記為外部修改：外部修改的淡黃底標記不會因此被清掉
    editor.chain().command(({ tr }) => (tr.setMeta(VNS_EXTERNAL_META, true), true)).setContent(vnsToDoc(props.text), false).run();
    editor.commands.setTextSelection(Math.min(from, editor.state.doc.content.size - 1));
    collect(editor);
  }, [editor, props.text]);
  // AI 改了檔案時的打字效果（App 的 applyFile 會找這個）
  useEffect(() => (editor ? registerVnsPlayer(props.fileId, createVnsPlayer(editor, () => eol.current)) : undefined), [editor, props.fileId]);
  useEffect(() => {
    if (props.active && editor) report(editor);
  }, [props.active, editor]);
  // 搜尋、問題面板跳到某一行：第 line 行第 column 個字（有 endColumn 就選起來）
  useEffect(() => {
    if (!editor) return;
    return registerScriptView(props.fileId, {
      el: () => editor.view.dom,
      reveal: (line, column, endColumn) => {
        const { doc } = editor.state;
        const index = Math.min(Math.max(line - 1, 0), doc.childCount - 1);
        let start = 0;
        for (let i = 0; i < index; i++) start += doc.child(i).nodeSize;
        const size = doc.child(index).content.size;
        const at = (col: number) => start + 1 + Math.min(Math.max(col - 1, 0), size);
        editor.chain().focus().setTextSelection({ from: at(column), to: at(endColumn ?? column) }).scrollIntoView().run();
      },
    });
  }, [editor, props.fileId]);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      updateSettings({ scriptFontSize: getSettings().scriptFontSize + (e.deltaY < 0 ? 1 : -1) });
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [editor]);
  const headingTop = (h: Heading) => {
    const el = editor?.view.nodeDOM(h.pos) as HTMLElement | null;
    const box = scrollRef.current!;
    return el ? el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop : 0;
  };
  const onScroll = () => {
    const top = scrollRef.current!.scrollTop + 40;
    let current = 0;
    headings.forEach((h, i) => headingTop(h) <= top && (current = i));
    setActiveHeading(current);
  };
  const jump = (i: number) => scrollRef.current?.scrollTo({ top: headingTop(headings[i]) - 12, behavior: 'smooth' });
  if (!editor) return null;
  const setLevel = (level: number) => (uncommentBlocks(editor), level ? editor.chain().focus().setNode('heading', { level }).run() : editor.chain().focus().setNode('paragraph').run());
  const isHeading = (level: number) => editor.isActive('heading', { level });
  const bubble = [
    { label: '標音', on: editor.isActive('ruby'), run: () => promptRuby(editor) },
    ...[1, 2, 3].map((level) => ({ label: ['大標題', '中標題', '小標題'][level - 1], on: isHeading(level), run: () => setLevel(isHeading(level) ? 0 : level) })),
    { label: '註解', on: editor.isActive('vnsComment') || editor.isActive('heading', { comment: true }), run: () => toggleComment(editor) },
  ];
  const menuItems: ContextMenuItem[] = [
    { label: '標音…', onClick: () => promptRuby(editor) },
    { label: '設為大標題', onClick: () => setLevel(1) },
    { label: '設為中標題', onClick: () => setLevel(2) },
    { label: '設為小標題', onClick: () => setLevel(3) },
    { label: '一般文字', onClick: () => setLevel(0) },
    { label: '註解（Ctrl+/）', onClick: () => toggleComment(editor) },
    { label: '剪下', disabled: editor.state.selection.empty, onClick: () => (editor.commands.focus(), document.execCommand('cut')) },
    { label: '複製', disabled: editor.state.selection.empty, onClick: () => (editor.commands.focus(), document.execCommand('copy')) },
    {
      label: '貼上',
      onClick: () =>
        navigator.clipboard.readText().then((text) => text && editor.chain().focus().command(({ tr }) => (tr.replaceSelection(parseSlice(editor, text)), true)).run(), () => undefined),
    },
    { label: '全選', onClick: () => editor.chain().focus().selectAll().run() },
  ];
  const font = settings.scriptFontFamily.trim() ? `${settings.scriptFontFamily}, ${DEFAULT_FONT_FAMILY}` : DEFAULT_FONT_FAMILY;
  return (
    <div className="script-editor vns-editor">
      <div className="script-editor-main">
        <ChangeBar markKey={props.fileId} />
        <div
          className="vns-scroll"
          ref={scrollRef}
          onScroll={onScroll}
          style={{ fontFamily: font, fontSize: settings.scriptFontSize }}
          onContextMenu={(e) => (e.preventDefault(), setMenu({ x: e.clientX, y: e.clientY }))}
          onMouseDown={(e) => e.target === e.currentTarget && (e.preventDefault(), editor.commands.focus('end'))}
        >
          <EditorContent editor={editor} />
        </div>
        <BubbleMenu editor={editor} tippyOptions={{ duration: 100, placement: 'top-start' }} className="bubble-toolbar">
          {bubble.map((b) => (
            <button key={b.label} className={b.on ? 'on' : ''} onMouseDown={(e) => e.preventDefault()} onClick={b.run}>{b.label}</button>
          ))}
        </BubbleMenu>
        <VnsCompletionPopup editor={editor} />
      </div>
      {headings.length > 0 && <Outline headings={headings} active={activeHeading} onJump={jump} />}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
    </div>
  );
}
