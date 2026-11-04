import { useEffect, useState } from 'react';
import { Card, CardOps, CardSectionId, SchemaField } from '../model';
import { fieldIconDef } from '../fieldIcons';
import { sectionMeta } from '../sampleData';
import { RichTextView } from './RichTextEditor';
import NameInput from './NameInput';
import Icon from './Icon';

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
  const fieldIcon = (key: string) => {
    const def = fieldIconDef(schemaFields.find((s) => s.key === key));
    return def && <Icon icon={def} className="field-icon" />;
  };

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
        <Icon icon={sectionMeta[section].icon} className="tree-icon" />
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
        <div className="card-body" style={{ paddingLeft: 30 + depth * 14 }}>
          {card.fields.map((f, i) =>
            f.collapsed ? (
              // 收合欄位：只顯示名稱，點了才展開內容
              <div key={i} className="card-fold">
                <div className="card-row clickable" onClick={() => toggleField(i)}>
                  <span className="card-key">
                    <Icon icon={openFields.has(i) ? 'chevron-down' : 'chevron-right'} className="fold-chevron" /> {fieldIcon(f.key)}
                    {f.key}
                  </span>
                </div>
                {openFields.has(i) && <div className="card-fold-value">{f.value}</div>}
              </div>
            ) : (
              <div key={i} className="card-row">
                <span className="card-key">
                  {fieldIcon(f.key)}
                  {f.key}
                </span>
                <span className="card-value">{f.value}</span>
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
