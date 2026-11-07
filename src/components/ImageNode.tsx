import { useRef, useState } from 'react';
import Image from '@tiptap/extension-image';
import { NodeViewProps, NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import type { EditorView } from '@tiptap/pm/view';
import { TextSelection } from '@tiptap/pm/state';
import { imageError, imageSrc, saveImageFile } from '../images';

// 詳細內容裡的圖片（像 Notion）：自己佔一個區塊；點一下選取（Delete 刪掉），拖右下角調整寬度，按住圖片可以拖到別的位置
// src 記相對路徑（圖片/x.png），顯示時才轉成 vnimg 網址
// Markdown：沒調過寬度 → ![](圖片/x.png)；調過 → <img src="圖片/x.png" width="400">（Markdown 本身沒有寬度的寫法）

const MIN_WIDTH = 60;

function ImageView({ node, updateAttributes, selected, editor }: NodeViewProps) {
  const { src, alt, width } = node.attrs as { src: string; alt?: string; width?: number | null };
  const imgRef = useRef<HTMLImageElement>(null);
  const [dragWidth, setDragWidth] = useState<number | null>(null); // 拖曳中的寬度（放開才寫回文件，復原只會記一步）
  const [broken, setBroken] = useState(false);
  const shown = dragWidth ?? width ?? undefined;

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const img = imgRef.current;
    if (!img) return;
    const startX = e.clientX;
    const startW = img.getBoundingClientRect().width;
    const maxW = img.parentElement?.parentElement?.getBoundingClientRect().width ?? Infinity; // 不超過編輯區的寬度
    let w = startW;
    const move = (ev: MouseEvent) => {
      w = Math.round(Math.min(maxW, Math.max(MIN_WIDTH, startW + ev.clientX - startX)));
      setDragWidth(w);
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      document.body.classList.remove('image-resizing');
      setDragWidth(null);
      if (w !== startW) updateAttributes({ width: w });
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    document.body.classList.add('image-resizing');
  };

  return (
    <NodeViewWrapper className={`rich-image${selected && editor.isEditable ? ' selected' : ''}`} data-drag-handle="">
      {broken ? (
        <div className="rich-image-missing">找不到圖片：{src}</div>
      ) : (
        <span className="rich-image-box" style={shown ? { width: shown } : undefined}>
          <img ref={imgRef} src={imageSrc(src)} alt={alt ?? ''} title={src} draggable={false} onError={() => setBroken(true)} />
          {editor.isEditable && <span className="rich-image-handle" title="拖曳調整寬度" onMouseDown={startResize} />}
        </span>
      )}
    </NodeViewWrapper>
  );
}

// 路徑裡有空白或括號時，Markdown 要用 <...> 包起來
const mdPath = (src: string) => (/[\s()<>]/.test(src) ? `<${src}>` : src);
const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

export const ImageBlock = Image.extend({
  draggable: true,
  addAttributes() {
    return {
      ...this.parent?.(),
      // Markdown 讀進來時，![](圖片/小圖.png) 的路徑會被編碼成 %E5%9C%96…，這裡解回原本的字（存回去才會是中文路徑）
      src: {
        default: null,
        parseHTML: (el) => {
          const raw = el.getAttribute('src') ?? '';
          if (/^(https?:|data:|blob:)/i.test(raw)) return raw;
          try {
            return decodeURI(raw);
          } catch {
            return raw;
          }
        },
      },
      width: {
        default: null,
        parseHTML: (el) => {
          const w = parseInt(el.getAttribute('width') ?? '', 10);
          return Number.isFinite(w) && w > 0 ? w : null;
        },
        renderHTML: (attrs) => (attrs.width ? { width: attrs.width } : {}),
      },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: { write: (s: string) => void; esc: (s: string) => string; closeBlock: (n: unknown) => void }, node: { attrs: Record<string, unknown> }) {
          const src = String(node.attrs.src ?? '');
          const alt = String(node.attrs.alt ?? '');
          if (node.attrs.width) state.write(`<img src="${attr(src)}"${alt ? ` alt="${attr(alt)}"` : ''} width="${node.attrs.width}">`);
          else state.write(`![${state.esc(alt)}](${mdPath(src)})`);
          state.closeBlock(node);
        },
        parse: {},
      },
    };
  },
}).configure({ inline: false, allowBase64: false });

// 貼上或拖進來的圖片檔：先存進「圖片」資料夾，再插在游標（拖放時是放開的位置）
// 存檔要等一下，所以位置在存好後才算；有好幾張就依序接在後面
export async function insertImageFiles(view: EditorView, files: File[], at?: number) {
  let pos = at;
  for (const file of files) {
    let src: string;
    try {
      src = await saveImageFile(file);
    } catch (e) {
      imageError(e);
      return;
    }
    if (view.isDestroyed) return;
    const node = view.state.schema.nodes.image.create({ src });
    let tr = view.state.tr;
    if (pos !== undefined) tr = tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(pos, tr.doc.content.size))));
    tr = tr.replaceSelectionWith(node);
    view.dispatch(tr.scrollIntoView());
    pos = undefined;
  }
}
