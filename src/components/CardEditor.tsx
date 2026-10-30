import { useEffect, useRef, useState } from 'react';
import { Card, Field } from '../model';
import RichTextEditor, { useRichEditor } from './RichTextEditor';
import Outline, { Heading } from './Outline';

// 分頁裡的完整設定卡：左邊是名稱、欄位、詳細內容，右邊是詳細內容的標題目錄
// 側邊欄只是預覽，所有修改都在這裡做
// lockedKeys = 這個區塊欄位範本裡的欄位：名稱不能改、不能刪（要改請到「欄位設定」）
// isCommand = 指令卡：名稱就是指令格式，用等寬字和指令的顏色顯示
export default function CardEditor({
  card,
  isCommand,
  lockedKeys,
  onChange,
}: {
  card: Card;
  isCommand: boolean;
  lockedKeys: string[];
  onChange: (patch: Partial<Card>) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const editor = useRichEditor(card.detail, (detail) => onChange({ detail }));
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [active, setActive] = useState(0);

  const setField = (i: number, patch: Partial<Field>) =>
    onChange({ fields: card.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) });

  // 文件一有變動，就重新收集所有標題
  useEffect(() => {
    if (!editor) return;
    const collect = () => {
      const list: Heading[] = [];
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'heading') list.push({ level: node.attrs.level, text: node.textContent, pos });
      });
      setHeadings(list);
    };
    collect();
    editor.on('update', collect);
    return () => {
      editor.off('update', collect);
    };
  }, [editor]);

  // 某個標題在捲動區裡的位置
  const headingTop = (h: Heading) => {
    const el = editor?.view.nodeDOM(h.pos) as HTMLElement | null;
    const box = scrollRef.current!;
    return el ? el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop : 0;
  };

  // 點目錄後的平滑捲動期間設為 true：這段時間不跟著捲動改反白，不然會一路閃過中間的標題
  const jumping = useRef(false);

  // 捲動時：找出「已經捲過頂端的最後一個標題」，那就是目前所在的段落
  const onScroll = () => {
    if (jumping.current) return;
    const top = scrollRef.current!.scrollTop + 40;
    let current = 0;
    headings.forEach((h, i) => {
      if (headingTop(h) <= top) current = i;
    });
    setActive(current);
  };

  // 點目錄：先把反白定在那個標題，再平滑捲過去；捲完才恢復「跟著捲動改反白」
  // （不讓編輯器取得焦點，因為取得焦點時瀏覽器會自己捲一下，畫面會跳）
  const jump = (i: number) => {
    const box = scrollRef.current!;
    setActive(i);
    jumping.current = true;
    const done = () => {
      jumping.current = false;
      box.removeEventListener('scrollend', done);
    };
    box.addEventListener('scrollend', done);
    setTimeout(done, 1000); // 保險：已經在目標位置（不會捲動）或瀏覽器不支援 scrollend 時
    box.scrollTo({ top: headingTop(headings[i]) - 12, behavior: 'smooth' });
  };

  return (
    <div className="card-editor">
      <div className="card-editor-scroll" ref={scrollRef} onScroll={onScroll}>
        <div className="card-editor-inner">
          <input
            className={`card-editor-name${isCommand ? ' cmd-format cmd-name' : ''}`}
            value={card.name}
            placeholder={isCommand ? '#指令 [參數]' : '名稱'}
            onChange={(e) => onChange({ name: e.target.value })}
          />

          <div className="card-editor-fields">
            {card.fields.map((f, i) => {
              const locked = lockedKeys.includes(f.key);
              return (
              <div className="card-editor-row" key={i}>
                <input
                  value={f.key}
                  placeholder="欄位名稱"
                  readOnly={locked}
                  className={locked ? 'locked' : undefined}
                  title={locked ? '範本欄位：名稱要到區塊的「欄位設定」裡改' : undefined}
                  onChange={(e) => setField(i, { key: e.target.value })}
                />
                <textarea
                  rows={1}
                  value={f.value}
                  placeholder="內容"
                  onChange={(e) => setField(i, { value: e.target.value })}
                />
                <button
                  className={`fold-toggle${f.collapsed ? ' on' : ''}`}
                  title="開啟後，側邊欄只顯示欄位名稱，點了才展開"
                  onClick={() => setField(i, { collapsed: !f.collapsed })}
                >
                  {f.collapsed ? '▸ 收合' : '▾ 展開'}
                </button>
                <button
                  className="icon-btn"
                  title={locked ? '範本欄位不能刪除' : '刪除欄位'}
                  disabled={locked}
                  style={locked ? { visibility: 'hidden' } : undefined}
                  onClick={() => onChange({ fields: card.fields.filter((_, j) => j !== i) })}
                >
                  ×
                </button>
              </div>
              );
            })}
            <button className="text-btn" onClick={() => onChange({ fields: [...card.fields, { key: '', value: '' }] })}>
              ＋ 新增欄位
            </button>
          </div>

          <div className="card-editor-label">詳細內容</div>
          <RichTextEditor editor={editor} />
        </div>
      </div>
      <Outline headings={headings} active={active} onJump={jump} />
    </div>
  );
}
