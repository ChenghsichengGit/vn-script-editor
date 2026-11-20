import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Card, CardOps, CardSectionId, Field, SchemaField, cardTabId } from '../model';
import { fieldIconDef } from '../fieldIcons';
import { sectionDef, sectionMeta } from '../sections';
import { AUTO_CUT, memoriesAt, relationSummary, relations, sourceLabel } from '../memories';
import { useProgress } from '../progress';
import { openCardViewer, openMemoryViewer } from './MemoryViewer';
import type { IconDef } from './Icon';
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
  badge?: React.ReactNode; // 名稱後面的小標記（「本場」區塊裡固定的卡畫圖釘）
  kids?: { open: boolean; onToggle: () => void }; // 有子卡片：前面的箭頭改成展開／收起子卡片（點名稱還是展開欄位）
  children?: React.ReactNode; // 子卡片的列，畫在這張卡下面
}

const lastSideTab = new Map<string, 'data' | 'memory'>();
const LEADING_BREAK = /^\r?\n/; // 值一開頭就換行

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

export default function CardItem({ section, card, ops, bulk, selected, depth, onMenu, renaming, onRename, onRenameClose, rowProps, rowClass = '', schemaFields, targetIcon, badge, kids, children }: Props) {
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
  const memories = card.memories ?? [];
  const progress = useProgress();
  const memShown = memoriesAt(memories, AUTO_CUT, progress); // 側邊欄的記憶跟著目前進度
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
  // 值一開頭就換行（刻意空一行）或是圖片 → 放到欄位名稱下面；其他都接在名稱右邊，太長在右邊那欄換行
  const isStacked = (f: Field) => (isImage(f) ? !!f.value.trim() : LEADING_BREAK.test(f.value));
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
        {kids ? (
          <span
            className="card-kids-toggle"
            title={kids.open ? '收起子卡片' : '展開子卡片'}
            onClick={(e) => {
              e.stopPropagation();
              kids.onToggle();
            }}
          >
            <Icon icon={kids.open ? 'chevron-down' : 'chevron-right'} className="chevron" />
          </span>
        ) : (
          <Icon icon={open ? 'chevron-down' : 'chevron-right'} className="chevron" />
        )}
        <Icon icon={sectionMeta(section).icon} className="tree-icon" />
        {renaming ? (
          <NameInput initial={card.name} onSubmit={onRename} onClose={onRenameClose} />
        ) : (
          <CardName section={section} name={card.name} />
        )}
        {badge}
        {hasMarks(cardTabId(section, card.id)) && <span className="ext-dot" title="有其他人的修改" />}
        {!renaming && (
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
        <div className="card-body" style={{ paddingLeft: 30 + depth * 14 }}>
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
              {memories.length > 0 && progress.path && (
                <div className="card-mem-cut">到「{sourceLabel(progress.path)}」為止{memShown.length < memories.length && `（${memShown.length}／${memories.length} 筆）`}</div>
              )}
              {memories.length === 0 ? (
                <span className="memory-note">還沒有記憶</span>
              ) : memShown.length === 0 ? (
                <span className="memory-note">到這裡為止還沒有記憶</span>
              ) : (
                <>
                  {relations(memShown).map((r) => {
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
              <div key={i} className={`card-row${isStacked(f) ? ' stacked' : ''}`}>
                <FieldKey name={f.key}>
                  {fieldIcon(f.key)}
                  {f.key}
                </FieldKey>
                {fieldValue(isStacked(f) && !isImage(f) ? { ...f, value: f.value.replace(LEADING_BREAK, '') } : f, 'card-value')}
              </div>
            ),
          )}
          {card.detail.trim() && (
            <div className="card-fold card-detail-fold">
              <div className="card-row clickable card-detail-open" title="放大看詳細內容" onClick={() => openCardViewer(section, card.id, 'detail')}>
                <span className="card-key">
                  <Icon icon="screen-full" className="fold-chevron" /> 詳細內容
                </span>
              </div>
            </div>
          )}
            </>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
