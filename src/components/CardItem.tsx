import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Card, CardOps, CardSectionId, Field, SchemaField, cardTabId } from '../model';
import { fieldIconDef } from '../fieldIcons';
import { sectionDef, sectionMeta } from '../sections';
import { relationSummary, relations } from '../memories';
import { openCardViewer, openMemoryViewer } from './MemoryViewer';
import type { IconDef } from './Icon';
import { RichTextView } from './RichTextEditor';
import NameInput from './NameInput';
import Icon from './Icon';
import FieldText from './FieldText';
import { imageSrc } from '../images';
import { openImageViewer } from './ImageViewer';
import { hasMarks, useChangeMarks } from '../changeMarks';

export function CardImage({ path, className }: { path: string; className?: string }) {
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

const lastSideTab = new Map<string, 'data' | 'memory'>();
const openDetails = new Set<string>();

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
    <span ref={ref} className={`card-key${cut ? ' overflow' : ''}`} title={cut ? name : undefined}>{children}</span>
  );
}

export default function CardItem({ section, card, ops, bulk, selected, depth, onMenu, renaming, onRename, onRenameClose, rowProps, rowClass = '', schemaFields, targetIcon }: Props) {
  useChangeMarks(); // 「外部修改」的黃點一變就重畫
  const [open, setOpen] = useState(false);
  const hasMemory = !!sectionDef(section)?.memory;
  const tabId = cardTabId(section, card.id);
  const [sideTab, setSideTabState] = useState<'data' | 'memory'>(() => lastSideTab.get(tabId) ?? 'data');
  const setSideTab = (t: 'data' | 'memory') => {
    lastSideTab.set(tabId, t);
    setSideTabState(t);
  };
  const showMem = hasMemory && sideTab === 'memory';
  const [detailOpen, setDetailOpenState] = useState(() => openDetails.has(tabId));
  const setDetailOpen = (v: boolean) => {
    if (v) openDetails.add(tabId);
    else openDetails.delete(tabId);
    setDetailOpenState(v);
  };
  const memories = card.memories ?? [];
  const [openFields, setOpenFields] = useState<Set<number>>(new Set()); // 被點開的「收合欄位」
  useEffect(() => {
    if (bulk.tick > 0) setOpen(bulk.show);
  }, [bulk.tick]);
  const anyIcon = schemaFields.some((s) => s.icon);
  const fieldIcon = (key: string) => {
    const def = fieldIconDef(schemaFields.find((s) => s.key === key));
    if (def) return <Icon icon={def} className="field-icon" />;
    return anyIcon ? <span className="field-icon field-icon-slot" /> : null;
  };
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
        {!renaming && !hasMemory && (
          <button
            className="icon-btn card-edit"
            title="放大看這張卡"
            onClick={(e) => {
              e.stopPropagation();
              openCardViewer(section, card.id);
            }}
          >
            <Icon icon="screen-full" />
          </button>
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
          {hasMemory && (
            <div className="card-tabs">
              <span className="card-tab">
                <button type="button" className={showMem ? '' : 'on'} onClick={() => setSideTab('data')}>資料</button>
                <button type="button" className="card-tab-zoom" title="放大看資料" onClick={() => openCardViewer(section, card.id)}><Icon icon="screen-full" /></button>
              </span>
              <span className="card-tab">
                <button type="button" className={showMem ? 'on' : ''} onClick={() => setSideTab('memory')}>記憶 {memories.length}</button>
                <button type="button" className="card-tab-zoom" title="放大看時間線和關係" onClick={() => openMemoryViewer(section, card.id)}><Icon icon="screen-full" /></button>
              </span>
            </div>
          )}
          {showMem ? (
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
                </>
              )}
            </div>
          ) : (
            <>
          {card.fields.map((f, i) =>
            f.collapsed ? (
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
          {card.detail.trim() && (
            <div className="card-fold card-detail-fold">
              <div className="card-row clickable" onClick={() => setDetailOpen(!detailOpen)}>
                <span className="card-key">
                  <Icon icon={detailOpen ? 'chevron-down' : 'chevron-right'} className="fold-chevron" /> 詳細內容
                </span>
              </div>
              {detailOpen && (
                <div className="card-detail"><RichTextView markdown={card.detail} /></div>
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
