import { useEffect, useState } from 'react';
import { Card, CardOps, CardSectionId } from '../model';
import { RichTextView } from './RichTextEditor';

interface Props {
  section: CardSectionId;
  card: Card;
  ops: CardOps;
  bulk: { show: boolean; tick: number };
  selected: boolean;
}

// 側邊欄裡的一張設定卡（只能看，不能改）
// 點整列：展開／收起（欄位和詳細內容）；✏️：在分頁開啟編輯；右鍵：刪除
export default function CardItem({ section, card, ops, bulk, selected }: Props) {
  const [open, setOpen] = useState(false);
  const [openFields, setOpenFields] = useState<Set<number>>(new Set()); // 被點開的「收合欄位」

  // 區塊標題按了「全部展開／收起」時跟著切換
  useEffect(() => {
    if (bulk.tick > 0) setOpen(bulk.show);
  }, [bulk.tick]);

  const toggleField = (i: number) => {
    const next = new Set(openFields);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    setOpenFields(next);
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (window.confirm(`要刪除「${card.name}」嗎？`)) ops.remove(section, card.id);
  };

  return (
    <div className="card">
      <div
        className={`tree-row card-header${selected ? ' selected' : ''}`}
        onClick={() => setOpen(!open)}
        onContextMenu={onContextMenu}
      >
        <span className="chevron">{open ? '▾' : '▸'}</span>
        <span className="tree-label">{card.name || '（未命名）'}</span>
        <button
          className="icon-btn card-edit"
          title="編輯"
          onClick={(e) => {
            e.stopPropagation(); // 避免同時觸發「展開／收起」
            ops.open(section, card.id);
          }}
        >
          ✏️
        </button>
      </div>

      {open && (
        <div className="card-body">
          {card.fields.map((f, i) =>
            f.collapsed ? (
              // 收合欄位：只顯示名稱，點了才展開內容
              <div key={i} className="card-fold">
                <div className="card-row clickable" onClick={() => toggleField(i)}>
                  <span className="card-key">
                    {openFields.has(i) ? '▾' : '▸'} {f.key}
                  </span>
                </div>
                {openFields.has(i) && <div className="card-fold-value">{f.value}</div>}
              </div>
            ) : (
              <div key={i} className="card-row">
                <span className="card-key">{f.key}</span>
                <span className="card-value">{f.value}</span>
              </div>
            ),
          )}
          {/* 欄位下面接著顯示詳細內容 */}
          {card.detail.trim() ? (
            <div className="card-detail">
              <RichTextView markdown={card.detail} />
            </div>
          ) : (
            <div className="card-detail empty-detail">（尚無詳細內容，點 ✏️ 開始撰寫）</div>
          )}
        </div>
      )}
    </div>
  );
}
