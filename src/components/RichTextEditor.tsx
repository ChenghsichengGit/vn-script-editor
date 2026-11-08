import { useLatest } from '../hooks';
import { useEffect, useState } from 'react';
import { BubbleMenu, Editor, EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { ImageBlock, insertImageFiles } from './ImageNode';
import { ChangeHighlight } from './ChangeHighlight';
import { imageError, imageFiles, pickImage } from '../images';
import { RubyNode, promptRuby } from './RubyMark';
import ContextMenu, { ContextMenuItem } from './ContextMenu';

export const richExtensions = [StarterKit.configure({ heading: { levels: [1, 2, 3] } }), ImageBlock, RubyNode, Markdown];
const extensions = richExtensions;

export const toMarkdown = (editor: Editor): string => editor.storage.markdown.getMarkdown();

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
    { label: '• 條列', active: editor.isActive('bulletList'), run: () => editor.chain().focus().toggleBulletList().run() },
    { label: '1. 編號', active: editor.isActive('orderedList'), run: () => editor.chain().focus().toggleOrderedList().run() },
    { label: 'B', active: editor.isActive('bold'), run: () => editor.chain().focus().toggleBold().run() },
    { label: '標音', active: editor.isActive('ruby'), run: () => promptRuby(editor) },
    { label: '圖片', active: false, run: insertImage },
  ];
  const bubble = ['標音', 'B', 'H1', 'H2', 'H3', '• 條列', '1. 編號'].map((label) => buttons.find((x) => x.label === label)!);
  const canRuby = !editor.state.selection.empty || editor.isActive('ruby');
  const menuItems: ContextMenuItem[] = [
    { label: '標音…', disabled: !canRuby, onClick: () => promptRuby(editor) },
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
