import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Card, CardOps, CardSectionId, Field, SchemaField, cardTabId } from '../model';
import { fieldIconDef } from '../fieldIcons';
import { sectionDef, sectionMeta } from '../sections';
import { relationSummary, relations } from '../memories';
import { openMemoryViewer } from './MemoryViewer';
import type { IconDef } from './Icon';
import { RichTextView } from './RichTextEditor';
import NameInput from './NameInput';
import Icon from './Icon';
import FieldText from './FieldText';
import { imageSrc } from '../images';
import { openImageViewer } from './ImageViewer';
import { hasMarks, useChangeMarks } from '../changeMarks';

// 側邊欄的圖片欄位縮圖；讀不到圖（檔案不見、內容不是圖片路徑）就改成文字「找不到圖片」，不畫破圖
function CardImage({ path, className }: { path: string; className?: string }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [path]);
  const cls = className ? ` ${className}` : '';
  if (broken) return <span className={`card-image-missing${cls}`} title={path}>找不到圖片</span>;
  return (
    <img
      className={`card-image${cls}`}
      src={imageSrc(path)}
      alt={path}
      title={`${path}（點一下放大）`}
      draggable={false}
      onError={() => setBroken(true)}
      onClick={(e) => {
        e.stopPropagation(); // 不要觸發所在那一列的展開／收合
        openImageViewer(path);
      }}
    />
  );
}

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
  targetIcon: (name: string) => IconDef | undefined; // 記憶的對象那張卡所在區塊的圖示
}

// 每張卡在側邊欄上次停在「資料」還是「記憶」（key = 分頁 id）
const lastSideTab = new Map<string, 'data' | 'memory'>();
// 側邊欄裡詳細內容被點開的卡（key = 分頁 id）
const openDetails = new Set<string>();

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
export default function CardItem({ section, card, ops, bulk, selected, depth, onMenu, renaming, onRename, onRenameClose, rowProps, rowClass = '', schemaFields, targetIcon }: Props) {
  useChangeMarks(); // 「外部修改」的黃點一變就重畫
  const [open, setOpen] = useState(false);
  // 有記憶的區塊：展開後上面有「資料｜記憶」切換
  const hasMemory = !!sectionDef(section)?.memory;
  const tabId = cardTabId(section, card.id);
  const [sideTab, setSideTabState] = useState<'data' | 'memory'>(() => lastSideTab.get(tabId) ?? 'data');
  const setSideTab = (t: 'data' | 'memory') => {
    lastSideTab.set(tabId, t);
    setSideTabState(t);
  };
  const showMem = hasMemory && sideTab === 'memory';
  // 詳細內容展開了沒（每張卡各自記住；關掉程式就回到摺著）
  const [detailOpen, setDetailOpenState] = useState(() => openDetails.has(tabId));
  const setDetailOpen = (v: boolean) => {
    if (v) openDetails.add(tabId);
    else openDetails.delete(tabId);
    setDetailOpenState(v);
  };
  const memories = card.memories ?? [];
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

  // 圖片欄位：內容畫成縮圖（一律放在名稱下面）；沒放圖就空著
  // 範本欄位看範本的類型，卡片自己加的欄位看它自己的 type
  const isImage = (f: Field) => {
    const s = schemaFields.find((s) => s.key === f.key);
    return (s ? s.type : f.type) === 'image';
  };
  const fieldValue = (f: Field, className?: string) => {
    const value = f.value;
    return isImage(f) ? (
      value.trim() ? <CardImage path={value} className={className} /> : null
    ) : (
      <FieldText className={className} text={value} />
    );
  };

  // 內容在右邊那欄排不下一行的欄位（第幾個）：改成名稱一行、內容從下一行開始
  // 用「內容文字的寬度」跟「右邊那欄的寬度」比，不看排出來有沒有折行：改成上下排之後變寬也不會跳回並排，畫面不會來回閃
  // 名稱欄寬由這張卡所有名稱決定（上下排的名稱也還在第一欄），所以右邊那欄的寬度不受上下排影響
  const bodyRef = useRef<HTMLDivElement>(null);
  const [stacked, setStacked] = useState<Set<number>>(new Set());
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!open || showMem || !body) return;
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
        if (f.collapsed) return;
        if (isImage(f) ?f.value.trim() : f.value.includes('\n') || ctx.measureText(f.value).width > room) next.add(i);
      });
      setStacked((prev) => (prev.size === next.size && [...next].every((i) => prev.has(i)) ? prev : next));
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(body);
    return () => ro.disconnect();
  }, [open, showMem, card.fields, schemaFields]);

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
        {hasMarks(cardTabId(section, card.id)) && <span className="ext-dot" title="有其他人的修改" />}
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
          {hasMemory && (
            <div className="card-tabs">
              <button type="button" className={showMem ? '' : 'on'} onClick={() => setSideTab('data')}>
                資料
              </button>
              <button type="button" className={showMem ? 'on' : ''} onClick={() => setSideTab('memory')}>
                記憶 {memories.length}
              </button>
            </div>
          )}
          {showMem ? (
            // 記憶摘要：每個對象一行（最後的稱呼，沒有就印象）；點一下在畫面中央放大看
            <div className="card-mem" title="點一下放大看時間線和關係" onClick={() => openMemoryViewer(section, card.id)}>
              {memories.length === 0 ? (
                <span className="memory-note">還沒有記憶</span>
              ) : (
                <>
                  {relations(memories).map((r) => {
                    const icon = targetIcon(r.target);
                    return (
                      <div key={r.target} className="card-mem-row">
                        <span className="card-mem-icon">{icon && <Icon icon={icon} />}</span>
                        <span className="card-mem-target">{r.target}</span>
                        <span className="card-mem-text">{relationSummary(r)}</span>
                      </div>
                    );
                  })}
                  <span className="card-mem-more">
                    放大 <Icon icon="screen-full" />
                  </span>
                </>
              )}
            </div>
          ) : (
            <>
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
                  <div className="card-fold-value">{fieldValue(f)}</div>
                )}
              </div>
            ) : (
              <div key={i} className={`card-row${stacked.has(i) ? ' stacked' : ''}`}>
                <FieldKey name={f.key}>
                  {fieldIcon(f.key)}
                  {f.key}
                </FieldKey>
                {fieldValue(f, 'card-value')}
              </div>
            ),
          )}
          {/* 欄位下面是詳細內容（沒寫就不顯示）：預設摺著，點標題才展開；「全部展開」不管它 */}
          {card.detail.trim() && (
            <div className="card-fold card-detail-fold">
              <div className="card-row clickable" onClick={() => setDetailOpen(!detailOpen)}>
                <span className="card-key">
                  <Icon icon={detailOpen ? 'chevron-down' : 'chevron-right'} className="fold-chevron" /> 詳細內容
                </span>
              </div>
              {detailOpen && (
                <div className="card-detail">
                  <RichTextView markdown={card.detail} />
                </div>
              )}
            </div>
          )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
