import { useEffect } from 'react';
import { Editor, EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';
import { ImageBlock, insertImageFiles } from './ImageNode';
import { imageError, imageFiles, pickImage } from '../images';

// Notion 式的文字編輯器（TipTap）
// 行首打「# 」「## 」「### 」會變成大／中／小標題，「- 」變條列；內容存成 Markdown
// 圖片：貼上、從檔案總管拖進來、或按工具列的「圖片」選檔案（圖檔都會複製到專案的「圖片」資料夾）

const extensions = [StarterKit.configure({ heading: { levels: [1, 2, 3] } }), ImageBlock, Markdown];

const toMarkdown = (editor: Editor): string => editor.storage.markdown.getMarkdown();

// 建立一個可編輯的編輯器；內容一變就把 Markdown 回報出去
export function useRichEditor(markdown: string, onChange: (markdown: string) => void) {
  return useEditor({
    extensions,
    content: markdown,
    onUpdate: ({ editor }) => onChange(toMarkdown(editor)),
    editorProps: {
      // 剪貼簿裡有圖片檔（截圖、複製的圖檔）：存成檔案再插入；沒有就照一般貼上
      handlePaste: (view, event) => {
        const files = imageFiles(event.clipboardData?.files);
        if (files.length === 0) return false;
        void insertImageFiles(view, files);
        return true;
      },
      // 從外面拖進來的圖片檔插在放開的位置；編輯器裡面拖動（moved）交給 TipTap 自己處理
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

// 工具列 + 編輯區
export default function RichTextEditor({ editor }: { editor: Editor | null }) {
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
    { label: '圖片', active: false, run: insertImage },
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
