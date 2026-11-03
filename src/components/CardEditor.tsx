import { useEffect, useRef, useState } from 'react';
import { Card, Field } from '../model';
import RichTextEditor, { useRichEditor } from './RichTextEditor';
import Outline, { Heading } from './Outline';
import ContextMenu, { ContextMenuItem } from './ContextMenu';
import SuggestInput from './SuggestInput';
import Icon from './Icon';
import { FIXED_COMMAND_FIELDS, bracketSuggest, commandSpecialFields } from '../scriptLanguage';

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
  const addField = (key: string) => onChange({ fields: [...card.fields, { key, value: '' }] });

  // 指令卡：有特別用途的欄位名稱（用法、說明、格式裡的參數…）→ 作用說明
  const special = isCommand ? commandSpecialFields(card) : new Map<string, string>();
  const [addMenu, setAddMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);

  // 「＋ 新增欄位」：指令卡先跳選單（已經有的變灰），一般卡直接加一個空白欄位
  // 選單：固定的「用法」「說明」→「自訂參數 ▸」（格式裡用到的參數）→「自訂欄位」（空白）
  const openAddMenu = (e: React.MouseEvent) => {
    if (!isCommand) return addField('');
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const has = new Set(card.fields.map((f) => f.key));
    const item = (n: string) => ({ label: n, disabled: has.has(n), onClick: () => addField(n) });
    const params = [...special.keys()].filter((n) => !FIXED_COMMAND_FIELDS.some((f) => f.name === n));
    setAddMenu({
      x: box.left,
      y: box.bottom + 2,
      items: [
        ...FIXED_COMMAND_FIELDS.map((f) => item(f.name)),
        { label: '自訂參數', disabled: params.length === 0, children: params.map(item) },
        { label: '自訂欄位', onClick: () => addField('') },
      ],
    });
  };

  // 「用法」一行一格：Enter 在下面多開一格並移過去
  const usageRefs = useRef<HTMLDivElement>(null);
  const focusUsage = useRef<number | null>(null);
  useEffect(() => {
    if (focusUsage.current === null) return;
    usageRefs.current?.querySelectorAll('input')[focusUsage.current]?.focus();
    focusUsage.current = null;
  });
  const usageEditor = (i: number, value: string) => {
    const lines = value.split('\n');
    const set = (next: string[]) => setField(i, { value: next.join('\n') });
    return (
      <div className="usage-list" ref={usageRefs}>
        {lines.map((line, j) => (
          <div className="usage-row" key={j}>
            <SuggestInput
              className="cmd-format usage-input"
              value={line}
              placeholder="#指令 參數：說明"
              suggest={bracketSuggest}
              onChange={(v) => set(lines.map((l, k) => (k === j ? v : l)))}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                focusUsage.current = j + 1;
                set([...lines.slice(0, j + 1), '', ...lines.slice(j + 1)]);
              }}
            />
            <button
              className="icon-btn"
              title="刪除這種用法"
              onClick={() => set(lines.length > 1 ? lines.filter((_, k) => k !== j) : [''])}
            >
              ×
            </button>
          </div>
        ))}
        <button
          className="text-btn"
          onClick={() => {
            focusUsage.current = lines.length;
            set([...lines, '']);
          }}
        >
          ＋ 新增用法
        </button>
      </div>
    );
  };

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
    // spellCheck 關掉：瀏覽器的英文拼字檢查會在 time:int 這種字底下畫紅線，跟劇本的錯誤提示搞混
    <div className="card-editor" spellCheck={false}>
      <div className="card-editor-scroll" ref={scrollRef} onScroll={onScroll}>
        <div className="card-editor-inner">
          {isCommand ? (
            // 指令卡的名稱就是指令格式：打 [ 可以選欄位設定裡的指令參數
            <SuggestInput
              className="card-editor-name cmd-format cmd-name"
              value={card.name}
              placeholder="#指令 [參數]"
              suggest={bracketSuggest}
              onChange={(name) => onChange({ name })}
            />
          ) : (
            <input className="card-editor-name" value={card.name} placeholder="名稱" onChange={(e) => onChange({ name: e.target.value })} />
          )}

          <div className="card-editor-fields">
            {card.fields.map((f, i) => {
              const locked = lockedKeys.includes(f.key);
              const use = special.get(f.key.trim());
              // 滑鼠移到這一列時的說明：專用欄位的作用，加上範本欄位不能改名的提醒
              const tip = [use, locked ? '（範本欄位：名稱要到區塊的「欄位設定」裡改）' : ''].filter(Boolean).join('\n\n');
              return (
              <div className="card-editor-row" key={i} title={tip || undefined}>
                {locked ? (
                  // 範本欄位的名稱：純文字標籤，看起來就不能改
                  <div className="field-key-locked">
                    <Icon icon="lock" className="field-lock" /> {f.key}
                    {use && <Icon icon="sparkle" className="field-special" />}
                  </div>
                ) : (
                  <div className="field-key-cell">
                    <input value={f.key} placeholder="欄位名稱" onChange={(e) => setField(i, { key: e.target.value })} />
                    {use && <Icon icon="sparkle" className="field-special" />}
                  </div>
                )}
                {isCommand && f.key.trim() === '用法' ? (
                  usageEditor(i, f.value)
                ) : (
                  <textarea
                    rows={1}
                    value={f.value}
                    placeholder="內容"
                    onChange={(e) => setField(i, { value: e.target.value })}
                  />
                )}
                <button
                  className={`fold-toggle${f.collapsed ? ' on' : ''}`}
                  title="開啟後，側邊欄只顯示欄位名稱，點了才展開"
                  onClick={() => setField(i, { collapsed: !f.collapsed })}
                >
                  <Icon icon={f.collapsed ? 'chevron-right' : 'chevron-down'} /> {f.collapsed ? '收合' : '展開'}
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
            <button className="text-btn" onClick={openAddMenu}>
              ＋ 新增欄位
            </button>
          </div>

          <div className="card-editor-label">詳細內容</div>
          <RichTextEditor editor={editor} />
        </div>
      </div>
      <Outline headings={headings} active={active} onJump={jump} />
      {addMenu && <ContextMenu x={addMenu.x} y={addMenu.y} items={addMenu.items} onClose={() => setAddMenu(null)} />}
    </div>
  );
}
