import { Fragment, useRef, useState } from 'react';
import type { FileOps, Layout } from '../App';
import { dragWith } from '../App';
import { Card, CardOps, CardSectionId, SectionId, cardTabId } from '../model';
import { sectionMeta } from '../sampleData';
import CardItem from './CardItem';
import ContextMenu from './ContextMenu';

interface Props {
  layout: Layout;
  onLayoutChange: (patch: Partial<Layout>) => void;
  files: Record<string, { name: string }>;
  fileOps: FileOps;
  cards: Record<CardSectionId, Card[]>;
  cardOps: CardOps;
  activeTab: string | null;
  onOpenFile: (id: string) => void;
}

const MIN_HEIGHT = 60; // 每個展開區塊最矮多高
const FILLER_MIN_HEIGHT = 120; // 填滿用的區塊最矮多高（要和 styles.css 的 .section.filler 一致）
const DEFAULT_HEIGHT = 200; // 還沒調整過的區塊預設高度（像素）

// 側邊欄：把開著的區塊上下疊起來
// 每個區塊拖到多高就固定多高；只有「最下面的區塊」會伸縮填滿剩下的空間
// 放不下時，固定高度的區塊會按比例暫時縮小（記住的高度不變，空間夠了就恢復），側邊欄不會出現捲軸
export default function Sidebar(props: Props) {
  const { layout } = props;
  const sectionEls = useRef<Partial<Record<SectionId, HTMLDivElement | null>>>({});
  // 每個區塊的「全部展開／全部收起」訊號：tick 每按一次加 1，卡片看到變化就跟著切換
  const [bulk, setBulk] = useState<Partial<Record<SectionId, { show: boolean; tick: number }>>>({});

  // 檔案的右鍵選單（記著位置和是哪個檔案）、以及正在改名的檔案
  const [menu, setMenu] = useState<{ x: number; y: number; fileId: string } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);

  const filler = layout.open[layout.open.length - 1]; // 負責填滿空間的那一塊

  // 拖曳第 index 條分隔線：改變上方區塊的高度
  // 下方如果是填滿用的區塊，它會自動吸收差額；如果是固定高度的，就一增一減
  const startSectionResize = (index: number, e: React.MouseEvent) => {
    e.preventDefault();
    const above = layout.open[index];
    const below = layout.open[index + 1];
    if (!above || !below) return;

    const height = (id: SectionId) => sectionEls.current[id]!.getBoundingClientRect().height;
    const startAbove = height(above);
    const startBelow = height(below);
    const startY = e.clientY;
    const belowMin = below === filler ? FILLER_MIN_HEIGHT : MIN_HEIGHT;

    dragWith((ev) => {
      let dy = ev.clientY - startY;
      // 上下兩塊都不能比最小高度矮，否則內容會撐出側邊欄、跑出捲軸
      dy = Math.max(MIN_HEIGHT - startAbove, dy);
      dy = Math.min(startBelow - belowMin, dy);
      const sizes = { ...layout.sizes, [above]: startAbove + dy };
      if (below !== filler) sizes[below] = startBelow - dy;
      props.onLayoutChange({ sizes });
    });
  };

  return (
    <aside className="sidebar" style={{ width: layout.width }}>
      {layout.open.map((id, i) => {
        const meta = sectionMeta[id];
        const sectionBulk = bulk[id] ?? { show: false, tick: 0 };
        return (
          <Fragment key={id}>
            {i > 0 && <div className="section-sash" onMouseDown={(e) => startSectionResize(i - 1, e)} />}
            <div
              className={`section${id === filler ? ' filler' : ''}`}
              ref={(el) => (sectionEls.current[id] = el)}
              style={id !== filler ? { height: layout.sizes[id] ?? DEFAULT_HEIGHT } : undefined}
            >
              {/* 區塊標題列：檔案區塊只有＋，設定卡區塊還多一個全部展開／收起 */}
              <div className="section-header">
                <span className="section-title">{meta.title}</span>
                {id === 'files' && (
                  <span className="section-actions">
                    <button className="icon-btn" title="新增劇本" onClick={props.fileOps.add}>
                      ＋
                    </button>
                  </span>
                )}
                {id !== 'files' && (
                  <span className="section-actions">
                    <button
                      className="icon-btn"
                      title={sectionBulk.show ? '全部收起' : '全部展開'}
                      onClick={() => setBulk({ ...bulk, [id]: { show: !sectionBulk.show, tick: sectionBulk.tick + 1 } })}
                    >
                      {sectionBulk.show ? '⊟' : '⊞'}
                    </button>
                    <button className="icon-btn" title={`新增${meta.title}`} onClick={() => props.cardOps.add(id)}>
                      ＋
                    </button>
                  </span>
                )}
              </div>

              <div className="section-body">
                {id === 'files'
                  ? Object.entries(props.files).map(([fileId, file]) => (
                      <div
                        key={fileId}
                        className={`tree-row${props.activeTab === fileId ? ' selected' : ''}`}
                        style={{ paddingLeft: 22 }}
                        onClick={() => props.onOpenFile(fileId)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setMenu({ x: e.clientX, y: e.clientY, fileId });
                        }}
                      >
                        {renamingId === fileId ? (
                          <RenameInput
                            name={file.name}
                            onCommit={(name) => {
                              props.fileOps.rename(fileId, name);
                              setRenamingId(null);
                            }}
                            onCancel={() => setRenamingId(null)}
                          />
                        ) : (
                          <span className="tree-label">{file.name}</span>
                        )}
                      </div>
                    ))
                  : props.cards[id].map((card) => (
                      <CardItem
                        key={card.id}
                        section={id}
                        card={card}
                        ops={props.cardOps}
                        bulk={sectionBulk}
                        selected={props.activeTab === cardTabId(id, card.id)}
                      />
                    ))}
              </div>
            </div>
          </Fragment>
        );
      })}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: '重新命名', onClick: () => setRenamingId(menu.fileId) },
            {
              label: '刪除',
              onClick: () => {
                const name = props.files[menu.fileId].name;
                if (window.confirm(`要刪除「${name}」嗎？`)) props.fileOps.remove(menu.fileId);
              },
            },
          ]}
        />
      )}
    </aside>
  );
}

// 改名用的輸入框：Enter 或離開輸入框就確定，Esc 取消
function RenameInput(props: { name: string; onCommit: (name: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(props.name);
  // 確定或取消後輸入框會消失並觸發 blur，用這個旗標避免重複處理
  const finished = useRef(false);

  const finish = (commit: boolean) => {
    if (finished.current) return;
    finished.current = true;
    if (commit) props.onCommit(value);
    else props.onCancel();
  };

  // 一開始選取副檔名前面的部分，直接打字就能改檔名
  const dot = props.name.lastIndexOf('.');

  return (
    <input
      className="rename-input"
      value={value}
      autoFocus
      onFocus={(e) => e.currentTarget.setSelectionRange(0, dot > 0 ? dot : props.name.length)}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(true);
        else if (e.key === 'Escape') finish(false);
      }}
      onBlur={() => finish(true)}
    />
  );
}
