import { useEffect, useRef, useState } from 'react';
import { Card, Field, SchemaField } from '../model';
import { fieldIconDef } from '../fieldIcons';
import RichTextEditor, { toMarkdown, useRichEditor } from './RichTextEditor';
import ChangeBar from './ChangeBar';
import { changeKey, changedBlocks, externalReplaceMeta, setChangedBlocksMeta } from './ChangeHighlight';
import { blockMarks, clearFieldMark, fieldMarks, setBlockMarks, useChangeMarks } from '../changeMarks';
import Outline, { Heading } from './Outline';
import ContextMenu, { ContextMenuItem } from './ContextMenu';
import SuggestInput from './SuggestInput';
import Icon from './Icon';
import FieldValueInput from './FieldValueInput';
import ImageFieldInput from './ImageFieldInput';
import MemoryPanel, { MemoryLinks } from './MemoryPanel';
import { FIXED_COMMAND_FIELDS, bracketSuggest, commandSpecialFields } from '../scriptLanguage';

// 每張卡上次看的是「詳細內容」還是「記憶」（key = 分頁 id；關掉程式就不記了）
const lastPane = new Map<string, 'detail' | 'memory'>();
const PANE_EVENT = 'vn-card-pane';

// 讓某張卡（分頁 id）切到「記憶」：還沒打開的下次打開就是記憶，已經開著的馬上切過去（記憶放大視窗的「編輯」用）
export function showCardMemory(tabId: string) {
  lastPane.set(tabId, 'memory');
  window.dispatchEvent(new CustomEvent<string>(PANE_EVENT, { detail: tabId }));
}

// 分頁裡的完整設定卡：左邊是名稱、欄位、詳細內容，右邊是詳細內容的標題目錄
// 側邊欄只是預覽，所有修改都在這裡做
// schemaFields = 這個區塊的欄位範本：裡面的欄位名稱不能改、不能刪（要改請到「欄位設定」），名稱前面畫範本設定的圖示（沒設就畫鎖頭）
// isCommand = 指令卡：名稱就是指令格式，用等寬字和指令的顏色顯示
export default function CardEditor({
  card,
  isCommand,
  schemaFields,
  flashKeys,
  markKey,
  memory,
  onChange,
}: {
  card: Card;
  markKey: string; // 這張卡的分頁 id：「外部修改」標記記在這個名字底下
  isCommand: boolean;
  schemaFields: SchemaField[];
  flashKeys?: string[]; // 剛被外部（AI）改過的欄位，亮一下；'__name' = 名稱、'__detail' = 詳細內容
  memory?: MemoryLinks; // 這個區塊有「記憶」時才有（區塊設定裡勾選）
  onChange: (patch: Partial<Card>) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // 編輯器自己最近回報出去的內容：App 傳回來的 card.detail 是其中之一就是自己打的，不是外部改的
  const emitted = useRef<string[]>([]);
  const editor = useRichEditor(
    card.detail,
    (detail) => {
      emitted.current = [...emitted.current.slice(-30), detail];
      onChange({ detail });
    },
    (blocks) => setBlockMarks(markKey, blocks),
  );
  const marksVersion = useChangeMarks();
  const changedFields = fieldMarks(markKey);

  // 有記憶的區塊：「詳細內容」和「記憶」切換顯示（詳細內容的編輯器一直留著，切回來游標和復原記錄都還在）
  const [pane, setPaneState] = useState<'detail' | 'memory'>(() => lastPane.get(markKey) ?? 'detail');
  const setPane = (p: 'detail' | 'memory') => {
    lastPane.set(markKey, p);
    setPaneState(p);
  };
  const showMemory = !!memory && pane === 'memory';
  useEffect(() => {
    const on = (e: Event) => {
      if ((e as CustomEvent<string>).detail === markKey) setPaneState('memory');
    };
    window.addEventListener(PANE_EVENT, on);
    return () => window.removeEventListener(PANE_EVENT, on);
  }, [markKey]);
  // 外部改了哪一邊，就切過去讓你看到（亮一下的時候）
  useEffect(() => {
    if (!memory || !flashKeys) return;
    if (flashKeys.includes('__detail')) setPane('detail');
    else if (flashKeys.includes('__memories')) setPane('memory');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flashKeys]);
  const detailMarked = blockMarks(markKey).length > 0;
  const memoryMarked = changedFields.some((k) => k.startsWith('__mem:'));

  // 詳細內容被外部改了（一起寫的人存檔、AI、全專案取代）：編輯器換成新內容（不算你的修改，也不會再回報出去）
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (emitted.current.includes(card.detail) || toMarkdown(editor) === card.detail) return;
    emitted.current = [];
    editor
      .chain()
      .command(({ tr }) => {
        externalReplaceMeta(tr);
        return true;
      })
      .setContent(card.detail, false)
      .run();
  }, [editor, card.detail]);

  // 詳細內容的「外部修改」標記：跟記錄不一樣就重新畫（剛打開、外部改了、按了清除標記）
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const want = blockMarks(markKey);
    const state = changeKey.getState(editor.state);
    const cur = state ? changedBlocks(editor.state.doc, state.set) : [];
    if (cur.length === want.length && cur.every((b, i) => b === want[i])) return;
    editor.view.dispatch(setChangedBlocksMeta(editor.state.tr, want));
  }, [editor, marksVersion, card.detail]);
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [active, setActive] = useState(0);

  const setField = (i: number, patch: Partial<Field>) => {
    clearFieldMark(markKey, card.fields[i].key); // 你自己改了這個欄位：「外部修改」的標記拿掉
    onChange({ fields: card.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  };
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
    <div className={`card-editor${flashKeys?.includes('__name') ? ' ai-flash-name' : ''}${flashKeys?.includes('__detail') ? ' ai-flash-detail' : ''}`} spellCheck={false}>
      <div className="card-editor-scroll" ref={scrollRef} onScroll={onScroll}>
        <ChangeBar markKey={markKey} />
        <div className="card-editor-inner">
          {isCommand ? (
            // 指令卡的名稱就是指令格式：打 [ 可以選欄位設定裡的指令參數
            <SuggestInput
              className={`card-editor-name cmd-format cmd-name${changedFields.includes('__name') ? ' ext-changed' : ''}`}
              value={card.name}
              placeholder="#指令 [參數]"
              suggest={bracketSuggest}
              onChange={(name) => {
                clearFieldMark(markKey, '__name');
                onChange({ name });
              }}
            />
          ) : (
            <input
              className={`card-editor-name${changedFields.includes('__name') ? ' ext-changed' : ''}`}
              value={card.name}
              placeholder="名稱"
              onChange={(e) => {
                clearFieldMark(markKey, '__name');
                onChange({ name: e.target.value });
              }}
            />
          )}

          <div className="card-editor-fields">
            {card.fields.map((f, i) => {
              const schemaField = schemaFields.find((s) => s.key === f.key);
              const locked = !!schemaField;
              const iconDef = fieldIconDef(schemaField);
              const use = special.get(f.key.trim());
              // 滑鼠移到這一列時的說明：專用欄位的作用，加上範本欄位不能改名的提醒
              const tip = [use, locked ? '（範本欄位：名稱要到區塊的「欄位設定」裡改）' : ''].filter(Boolean).join('\n\n');
              return (
              <div className={`card-editor-row${flashKeys?.includes(f.key) ? ' ai-flash' : ''}${changedFields.includes(f.key) ? ' ext-changed' : ''}`} key={i} title={tip || undefined}>
                {locked ? (
                  // 範本欄位的名稱：純文字標籤，看起來就不能改
                  <div className="field-key-locked">
                    {iconDef ? <Icon icon={iconDef} className="field-icon" /> : <Icon icon="lock" className="field-lock" />} {f.key}
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
                ) : (schemaField ? schemaField.type : f.type) === 'image' ? (
                  <ImageFieldInput value={f.value} onChange={(value) => setField(i, { value })} />
                ) : (
                  <FieldValueInput value={f.value} onChange={(value) => setField(i, { value })} />
                )}
                <div className="card-editor-btns">
                  {/* 卡片自己加的欄位：切換文字／圖片；範本欄位的類型要到「欄位設定」改，按鈕藏起來但留位置，各列才對得齊 */}
                  <button
                    className={`fold-toggle${f.type === 'image' && !locked ? ' on' : ''}`}
                    title="切換這個欄位是文字還是圖片"
                    disabled={locked}
                    style={locked ? { visibility: 'hidden' } : undefined}
                    onClick={() => setField(i, { type: f.type === 'image' ? undefined : 'image' })}
                  >
                    {f.type === 'image' ? '圖片' : '文字'}
                  </button>
                  <button
                    className={`fold-toggle${f.collapsed ? ' on' : ''}`}
                    title="開啟後，側邊欄只顯示欄位名稱，點了才展開"
                    onClick={() => setField(i, { collapsed: !f.collapsed })}
                  >
                    <Icon icon={f.collapsed ? 'chevron-right' : 'chevron-down'} /> {f.collapsed ? '收合' : '展開'}
                  </button>
                </div>
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

          {memory ? (
            <div className="card-editor-label card-pane-tabs">
              <button type="button" className={pane === 'detail' ? 'on' : ''} onClick={() => setPane('detail')}>
                詳細內容{detailMarked && pane !== 'detail' && <span className="ext-dot" title="有其他人的修改" />}
              </button>
              <button type="button" className={pane === 'memory' ? 'on' : ''} onClick={() => setPane('memory')}>
                記憶{card.memories?.length ? ` (${card.memories.length})` : ''}
                {memoryMarked && pane !== 'memory' && <span className="ext-dot" title="有其他人的修改" />}
              </button>
            </div>
          ) : (
            <div className="card-editor-label">詳細內容</div>
          )}
          {showMemory && (
            <MemoryPanel
              memories={card.memories ?? []}
              markKey={markKey}
              changed={changedFields}
              onChange={(memories) => onChange({ memories })}
              {...memory}
            />
          )}
          <div style={showMemory ? { display: 'none' } : undefined}>
            <RichTextEditor editor={editor} />
          </div>
        </div>
      </div>
      {!showMemory && <Outline headings={headings} active={active} onJump={jump} />}
      {addMenu && <ContextMenu x={addMenu.x} y={addMenu.y} items={addMenu.items} onClose={() => setAddMenu(null)} />}
    </div>
  );
}
