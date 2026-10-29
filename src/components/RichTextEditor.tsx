import { useEffect } from 'react';
import { Editor, EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';

// Notion 式的文字編輯器（TipTap）
// 行首打「# 」「## 」「### 」會變成大／中／小標題，「- 」變條列；內容存成 Markdown

const extensions = [StarterKit.configure({ heading: { levels: [1, 2, 3] } }), Markdown];

const toMarkdown = (editor: Editor): string => editor.storage.markdown.getMarkdown();

// 建立一個可編輯的編輯器；內容一變就把 Markdown 回報出去
export function useRichEditor(markdown: string, onChange: (markdown: string) => void) {
  return useEditor({
    extensions,
    content: markdown,
    onUpdate: ({ editor }) => onChange(toMarkdown(editor)),
  });
}

// 工具列 + 編輯區
export default function RichTextEditor({ editor }: { editor: Editor | null }) {
  if (!editor) return null;

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
  ];

  return (
    <div className="rich-editor">
      <div className="rich-toolbar">
        {buttons.map((b) => (
          <button key={b.label} className={b.active ? 'on' : ''} onMouseDown={(e) => e.preventDefault()} onClick={b.run}>
            {b.label}
          </button>
        ))}
      </div>
      <EditorContent editor={editor} className="rich-content" />
    </div>
  );
}

// 唯讀顯示（側邊欄預覽用）：內容變了就跟著重畫
export function RichTextView({ markdown }: { markdown: string }) {
  const editor = useEditor({ extensions, content: markdown, editable: false });
  useEffect(() => {
    if (editor && toMarkdown(editor) !== markdown) editor.commands.setContent(markdown);
  }, [editor, markdown]);
  return <EditorContent editor={editor} className="rich-view" />;
}
