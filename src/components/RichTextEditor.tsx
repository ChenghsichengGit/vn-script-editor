import { useLatest } from '../hooks';
import { useEffect, useState } from 'react';
import { BubbleMenu, Editor, EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TextSelection } from '@tiptap/pm/state';
import { Markdown } from 'tiptap-markdown';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import Link from '@tiptap/extension-link';
import Highlight from '@tiptap/extension-highlight';
import { Extension, markInputRule, markPasteRule } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import type MarkdownIt from 'markdown-it';
import { CardLinkNode } from './CardLinkNode';
import { openRubyPrompt } from './RubyPrompt';
import { ImageBlock, insertImageFiles } from './ImageNode';
import { ChangeHighlight } from './ChangeHighlight';
import { imageError, imageFiles, pickImage } from '../images';
import { RubyNode, promptRuby } from './RubyMark';
import ContextMenu, { ContextMenuItem } from './ContextMenu';

// 表格：Markdown 的 | 欄 | 欄 | 寫法（第一列當標題列）
const tableExtensions = [Table.configure({ resizable: false }), TableRow, TableHeader, TableCell];

// 螢光標記：存成 ==文字==（不是 <mark>）
function markPlugin(md: MarkdownIt) {
  md.inline.ruler.before('emphasis', 'mark', (state, silent) => {
    const start = state.pos;
    if (state.src.charCodeAt(start) !== 0x3d || state.src.charCodeAt(start + 1) !== 0x3d) return false; // ==
    const end = state.src.indexOf('==', start + 2);
    if (end < 0 || end > state.posMax - 2 || end === start + 2 || state.src.slice(start + 2, end).includes('\n')) return false;
    if (!silent) {
      state.push('mark_open', 'mark', 1);
      const max = state.posMax;
      state.pos = start + 2;
      state.posMax = end;
      state.md.inline.tokenize(state);
      state.posMax = max;
      state.push('mark_close', 'mark', -1);
    }
    state.pos = end + 2;
    return true;
  });
}
const RichHighlight = Highlight.extend({
  // 內建的規則要求 == 前面是空白，中文字之間沒有空白，所以改成前面不是 = 就好
  addInputRules() {
    return [markInputRule({ find: /(?<!=)==([^=\n]+)==$/, type: this.type })];
  },
  addPasteRules() {
    return [markPasteRule({ find: /(?<!=)==([^=\n]+)==/g, type: this.type })];
  },
  addStorage: () => ({
    markdown: {
      serialize: { open: '==', close: '==', mixable: true, expelEnclosingWhitespace: true },
      parse: { setup: (markdownit: MarkdownIt) => markdownit.use(markPlugin) },
    },
  }),
});

// 網址連結：不能讓 WebView 自己跳過去（整個編輯器會被換掉），改用系統瀏覽器開；編輯中要 Ctrl＋點
const openHref = (href: string | null) => {
  if (href && /^https?:\/\//i.test(href)) window.api.openUrl(href).catch(() => undefined);
};
const LinkClick = Extension.create({
  name: 'linkClick',
  addProseMirrorPlugins: () => [
    new Plugin({
      props: {
        handleDOMEvents: {
          click: (view, event) => {
            const a = (event.target as HTMLElement | null)?.closest?.('a[href]');
            if (!a) return false;
            event.preventDefault();
            if (!view.editable || event.ctrlKey || event.metaKey) openHref(a.getAttribute('href'));
            return !view.editable;
          },
        },
      },
    }),
  ],
});
const RichLink = Link.configure({
  openOnClick: false,
  autolink: true,
  linkOnPaste: true,
  protocols: [],
  HTMLAttributes: { target: null, rel: null, class: 'rich-link' },
});

// 「連結」：選取的文字加上網址；游標在連結上就改網址，清空 = 拿掉
export function promptLink(editor: Editor) {
  const inLink = editor.isActive('link');
  if (!inLink && editor.state.selection.empty) return;
  if (inLink) editor.chain().extendMarkRange('link').run();
  const { from, to } = editor.state.selection;
  const at = editor.view.coordsAtPos(from);
  openRubyPrompt({
    x: at.left,
    y: at.bottom + 6,
    base: '網址',
    rt: editor.getAttributes('link').href ?? '',
    placeholder: 'https://…',
    submitLabel: '確定',
    onSubmit: (value) => {
      const chain = editor.chain().setTextSelection({ from, to });
      if (!value) return void chain.unsetLink().run();
      const href = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
      chain.setLink({ href }).run();
    },
    onClose: () => editor.commands.focus(),
  });
}

export const richExtensions = [
  StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
  ImageBlock,
  RubyNode,
  CardLinkNode,
  RichLink,
  LinkClick,
  RichHighlight,
  ...tableExtensions,
  Markdown,
];
const extensions = richExtensions;

export const toMarkdown = (editor: Editor): string => editor.storage.markdown.getMarkdown();

// 條列／編號：先把選到段落裡的斷行（Shift+Enter）拆成各自一段，每行才會變成一項
const toggleList = (editor: Editor, kind: 'bulletList' | 'orderedList') => {
  const chain = editor.chain().focus().command(({ tr }) => {
    if (editor.isActive(kind)) return true;
    const { $from, $to } = tr.selection;
    const start = $from.start(), end = $to.end();
    const breaks: number[] = [];
    tr.doc.nodesBetween(start, end, (n, pos) => void (n.type.name === 'hardBreak' && breaks.push(pos)));
    if (breaks.length === 0) return true;
    for (const pos of breaks.reverse()) tr.delete(pos, pos + 1).split(pos);
    tr.setSelection(TextSelection.create(tr.doc, start, tr.mapping.map(end)));
    return true;
  });
  (kind === 'bulletList' ? chain.toggleBulletList() : chain.toggleOrderedList()).run();
};

export function useRichEditor(markdown: string, onChange: (markdown: string) => void, onBlocks?: (blocks: number[]) => void) {
  const onBlocksRef = useLatest(onBlocks);
  return useEditor({
    extensions: [...extensions, ChangeHighlight.configure({ onChange: (blocks) => onBlocksRef.current?.(blocks) })],
    content: markdown,
    onUpdate: ({ editor }) => onChange(toMarkdown(editor)),
    editorProps: {
      handlePaste: (view, event) => {
        const files = imageFiles(event.clipboardData?.files);
        if (files.length === 0) return false;
        void insertImageFiles(view, files);
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false;
        const files = imageFiles(event.dataTransfer?.files);
        if (files.length === 0) return false;
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        void insertImageFiles(view, files, at);
        return true;
      },
    },
  });
}

export default function RichTextEditor({ editor }: { editor: Editor | null }) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  if (!editor) return null;
  const insertImage = () =>
    pickImage().then((src) => {
      if (src) editor.chain().focus().setImage({ src }).run();
    }, imageError);
  const buttons = [
    { label: '內文', active: editor.isActive('paragraph'), run: () => editor.chain().focus().setParagraph().run() },
    ...([1, 2, 3] as const).map((level) => ({
      label: `H${level}`,
      active: editor.isActive('heading', { level }),
      run: () => editor.chain().focus().toggleHeading({ level }).run(),
    })),
    { label: '• 條列', active: editor.isActive('bulletList'), run: () => toggleList(editor, 'bulletList') },
    { label: '1. 編號', active: editor.isActive('orderedList'), run: () => toggleList(editor, 'orderedList') },
    { label: 'B', active: editor.isActive('bold'), run: () => editor.chain().focus().toggleBold().run() },
    { label: '螢光', active: editor.isActive('highlight'), run: () => editor.chain().focus().toggleHighlight().run() },
    { label: '連結', active: editor.isActive('link'), run: () => promptLink(editor) },
    { label: '標音', active: editor.isActive('ruby'), run: () => promptRuby(editor) },
    { label: '圖片', active: false, run: insertImage },
  ];
  const bubble = ['標音', 'B', '螢光', '連結', 'H1', 'H2', 'H3', '• 條列', '1. 編號'].map((label) => buttons.find((x) => x.label === label)!);
  const canRuby = !editor.state.selection.empty || editor.isActive('ruby');
  const canLink = !editor.state.selection.empty || editor.isActive('link');
  const menuItems: ContextMenuItem[] = [
    { label: '標音…', disabled: !canRuby, onClick: () => promptRuby(editor) },
    { label: '連結…', disabled: !canLink, onClick: () => promptLink(editor) },
    { label: '剪下', disabled: editor.state.selection.empty, onClick: () => (editor.commands.focus(), document.execCommand('cut')) },
    { label: '複製', disabled: editor.state.selection.empty, onClick: () => (editor.commands.focus(), document.execCommand('copy')) },
    {
      label: '貼上',
      onClick: () => {
        editor.commands.focus();
        navigator.clipboard.readText().then((text) => text && editor.view.pasteText(text), () => undefined);
      },
    },
    { label: '全選', onClick: () => editor.chain().focus().selectAll().run() },
  ];
  return (
    <div className="rich-editor">
      <div className="rich-toolbar">
        {buttons.map((b) => (
          <button key={b.label} className={b.active ? 'on' : ''} onMouseDown={(e) => e.preventDefault()} onClick={b.run}>{b.label}</button>
        ))}
      </div>
      <BubbleMenu editor={editor} tippyOptions={{ duration: 100, placement: 'top-start' }} className="bubble-toolbar">
        {bubble.map((b) => (
          <button key={b.label} className={b.active ? 'on' : ''} onMouseDown={(e) => e.preventDefault()} onClick={b.run}>{b.label}</button>
        ))}
      </BubbleMenu>
      <EditorContent
        editor={editor}
        className="rich-content"
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      />
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
    </div>
  );
}

export function RichTextView({ markdown }: { markdown: string }) {
  const editor = useEditor({ extensions, content: markdown, editable: false });
  useEffect(() => {
    if (editor && toMarkdown(editor) !== markdown) editor.commands.setContent(markdown);
  }, [editor, markdown]);
  return <EditorContent editor={editor} className="rich-view" />;
}
