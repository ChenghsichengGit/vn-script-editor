import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Card, CardOps, CardSectionId, SchemaField } from '../model';
import { fieldIconDef } from '../fieldIcons';
import { sectionMeta } from '../sections';
import { RichTextView } from './RichTextEditor';
import NameInput from './NameInput';
import Icon from './Icon';
import FieldText from './FieldText';

interface Props {
  section: CardSectionId;
  card: Card;
  ops: CardOps;
  bulk: { show: boolean; tick: number };
  selected: boolean;
  depth: number; // 所在資料夾的深度（0 = 區塊根目錄），決定縮排
  onMenu: (e: React.MouseEvent) => void; // 右鍵：由側邊欄顯示選單
  renaming: boolean; // 正在改名：名稱換成輸入框
  onRename: (name: string) => string | null; // 回傳錯誤訊息（重名等）或 null
  onRenameClose: () => void;
  rowProps?: React.HTMLAttributes<HTMLDivElement>; // 標題列額外的屬性：拖曳搬移用（draggable、dragstart、dragover…）
  rowClass?: string; // 標題列額外的 class：拖曳排序時畫上／下方的藍線
  schemaFields: SchemaField[]; // 這個區塊的欄位範本：欄位名稱前面畫它設定的圖示
}

// 卡片名稱；指令卡的名稱是指令格式：第一段 #指令 和後面的參數分別上色
function CardName({ section, name }: { section: CardSectionId; name: string }) {
  if (!name) return <span className="tree-label">（未命名）</span>;
  if (section !== 'commands') return <span className="tree-label">{name}</span>;
  const [head, ...rest] = name.split(' ');
  return (
    <span className="tree-label cmd-format" title={name}>
      <span className="cmd-name">{head}</span>
      {rest.length > 0 && <span className="cmd-arg"> {rest.join(' ')}</span>}
    </span>
  );
}

// 欄位名稱：不換行，太長被切掉時才加上 overflow（右邊淡出，見 styles.css），滑鼠停著顯示完整名稱
// 側邊欄拉寬拉窄時重新判斷有沒有被切掉
function FieldKey({ name, children }: { name: string; children: React.ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [cut, setCut] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setCut(el.scrollWidth > el.clientWidth + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [name]);
  return (
    <span ref={ref} className={`card-key${cut ? ' overflow' : ''}`} title={cut ? name : undefined}>
      {children}
    </span>
  );
}

// 側邊欄裡的一張設定卡（只能看，不能改）
// 點整列：展開／收起（欄位和詳細內容）；鉛筆圖示：在分頁開啟編輯；右鍵：選單（重新命名／刪除）
export default function CardItem({ section, card, ops, bulk, selected, depth, onMenu, renaming, onRename, onRenameClose, rowProps, rowClass = '', schemaFields }: Props) {
  const [open, setOpen] = useState(false);
  const [openFields, setOpenFields] = useState<Set<number>>(new Set()); // 被點開的「收合欄位」

  // 區塊標題按了「全部展開／收起」時跟著切換
  useEffect(() => {
    if (bulk.tick > 0) setOpen(bulk.show);
  }, [bulk.tick]);

  // 欄位名稱前面的圖示（範本裡有設定才畫）
  // 範本裡只要有一個欄位設了圖示，沒設的也留一格空位，欄位名稱的第一個字才會對齊
  const anyIcon = schemaFields.some((s) => s.icon);
  const fieldIcon = (key: string) => {
    const def = fieldIconDef(schemaFields.find((s) => s.key === key));
    if (def) return <Icon icon={def} className="field-icon" />;
    return anyIcon ? <span className="field-icon field-icon-slot" /> : null;
  };

  // 內容在右邊那欄排不下一行的欄位（第幾個）：改成名稱一行、內容從下一行開始
  // 用「內容文字的寬度」跟「右邊那欄的寬度」比，不看排出來有沒有折行：改成上下排之後變寬也不會跳回並排，畫面不會來回閃
  // 名稱欄寬由這張卡所有名稱決定（上下排的名稱也還在第一欄），所以右邊那欄的寬度不受上下排影響
  const bodyRef = useRef<HTMLDivElement>(null);
  const [stacked, setStacked] = useState<Set<number>>(new Set());
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!open || !body) return;
    const ctx = document.createElement('canvas').getContext('2d');
    const check = () => {
      const key = body.querySelector<HTMLElement>(':scope > .card-row > .card-key');
      const value = body.querySelector<HTMLElement>(':scope > .card-row > .card-value');
      if (!ctx || !key || !value) return;
      const style = getComputedStyle(body);
      const inner = body.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const room = inner - key.getBoundingClientRect().width - (parseFloat(style.columnGap) || 0);
      ctx.font = getComputedStyle(value).font;
      const next = new Set<number>();
      card.fields.forEach((f, i) => {
        if (!f.collapsed && (f.value.includes('\n') || ctx.measureText(f.value).width > room)) next.add(i);
      });
      setStacked((prev) => (prev.size === next.size && [...next].every((i) => prev.has(i)) ? prev : next));
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(body);
    return () => ro.disconnect();
  }, [open, card.fields]);

  const toggleField = (i: number) => {
    const next = new Set(openFields);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    setOpenFields(next);
  };

  return (
    <div className="card">
      <div
        {...rowProps}
        className={`tree-row card-header${selected ? ' selected' : ''}${rowClass}`}
        onClick={() => setOpen(!open)}
        style={{ paddingLeft: 6 + depth * 14 }}
        onContextMenu={(e) => {
          e.preventDefault();
          onMenu(e);
        }}
      >
        <Icon icon={open ? 'chevron-down' : 'chevron-right'} className="chevron" />
        <Icon icon={sectionMeta(section).icon} className="tree-icon" />
        {renaming ? (
          <NameInput initial={card.name} onSubmit={onRename} onClose={onRenameClose} />
        ) : (
          <CardName section={section} name={card.name} />
        )}
        {!renaming && (
          <button
            className="icon-btn card-edit"
            title="在分頁中編輯"
            onClick={(e) => {
              e.stopPropagation(); // 避免同時觸發「展開／收起」
              ops.open(section, card.id);
            }}
          >
            <Icon icon="edit" />
          </button>
        )}
      </div>

      {open && (
        <div className="card-body" ref={bodyRef} style={{ paddingLeft: 30 + depth * 14 }}>
          {card.fields.map((f, i) =>
            f.collapsed ? (
              // 收合欄位：只顯示名稱，點了才展開內容
              <div key={i} className="card-fold">
                <div className="card-row clickable" onClick={() => toggleField(i)}>
                  <FieldKey name={f.key}>
                    <Icon icon={openFields.has(i) ? 'chevron-down' : 'chevron-right'} className="fold-chevron" /> {fieldIcon(f.key)}
                    {f.key}
                  </FieldKey>
                </div>
                {openFields.has(i) && (
                  <div className="card-fold-value">
                    <FieldText text={f.value} />
                  </div>
                )}
              </div>
            ) : (
              <div key={i} className={`card-row${stacked.has(i) ? ' stacked' : ''}`}>
                <FieldKey name={f.key}>
                  {fieldIcon(f.key)}
                  {f.key}
                </FieldKey>
                <FieldText className="card-value" text={f.value} />
              </div>
            ),
          )}
          {/* 欄位下面接著顯示詳細內容（沒寫就不顯示） */}
          {card.detail.trim() && (
            <div className="card-detail">
              <RichTextView markdown={card.detail} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
