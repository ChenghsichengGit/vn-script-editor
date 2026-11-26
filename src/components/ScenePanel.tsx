// 「本場」區塊：目前劇本用到的設定卡（指令參數裡出現的、記憶出處是這個劇本的）＋手動固定的，照區塊分組
import { Fragment, useEffect, useState } from 'react';
import type { CardSectionId, SectionId } from '../model';
import { cardTabId } from '../model';
import { sectionMeta } from '../sections';
import { sourceLabel, targetIcon } from '../memories';
import { useChangeMarks } from '../changeMarks';
import CardItem from './CardItem';
import ContextMenu, { ContextMenuItem } from './ContextMenu';
import Icon from './Icon';
import { FoldButton, SectionTitle, TreeProps, pinItem } from './SectionPanel';
import { openCardViewer } from './MemoryViewer';

interface Props extends TreeProps {
  id: SectionId;
  fill?: boolean;
  height?: number;
  floating?: boolean;
  short?: boolean;
  slot?: SectionId; // 疊成標籤時佔位的區塊
}

export default function ScenePanel(props: Props) {
  useChangeMarks();
  const { id, scene } = props;
  const meta = sectionMeta(id);
  const [bulk, setBulk] = useState({ show: false, tick: 0 });
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const [renaming, setRenaming] = useState<{ section: CardSectionId; id: string } | null>(null);
  const [bodies, setBodies] = useState<Set<string>>(new Set()); // 欄位展開著的卡（卡片分頁 id）
  const [sel, setSel] = useState<string | null>(null); // 點一下選到的卡；點兩下打開分頁
  // 打開了本場裡的卡：選到它
  useEffect(() => {
    if (props.activeTab && scene.items.some((it) => cardTabId(it.section, it.card.id) === props.activeTab)) setSel(props.activeTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.activeTab]);
  const short = !!props.short && !props.floating;
  const toggleBody = (key: string) =>
    setBodies((b) => {
      const next = new Set(b);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const toggleBulk = () => {
    const show = !bulk.show;
    setBulk((b) => ({ show, tick: b.tick + 1 }));
    setBodies(show ? new Set(scene.items.map((it) => cardTabId(it.section, it.card.id))) : new Set());
  };
  const openMenu = (e: React.MouseEvent, items: ContextMenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, items });
  };
  const rootItems: ContextMenuItem[] = [{ label: bulk.show ? '全部收起' : '全部展開', onClick: toggleBulk }];
  let lastSection: CardSectionId | null = null;
  return (
    <div
      className={`section scene-section${props.fill ? ' filler' : ''}${props.floating ? ' floating' : ''}${short ? ' short' : ''}`}
      data-section={id}
      data-slot={props.slot ?? id}
      style={!props.fill && !short ? { height: props.height } : undefined}
    >
      <div
        className="section-header"
        onMouseDown={(e) => {
          if (e.button === 0 && !(e.target as HTMLElement).closest('button')) props.onHeaderDrag(props.slot ?? id, e);
        }}
        onContextMenu={(e) => openMenu(e, rootItems)}
      >
        {!props.floating && <FoldButton id={id} folded={props.folded.includes(id)} onFold={props.onFold} />}
        <SectionTitle
          id={id}
          slot={props.slot ?? id}
          stacks={props.stacks}
          tip={scene.path ? `目前進度：${scene.path}` : '打開劇本後，這裡會列出這一場用到的設定卡'}
          title={
            <>
              {meta.title}
              {scene.path && <span className="scene-script">：{sourceLabel(scene.path)}</span>}
            </>
          }
        />
        <span className="section-actions">
          <button className="icon-btn" data-tip={bulk.show ? '全部收起：每張卡只顯示名稱' : '全部展開：顯示每張卡的欄位和詳細內容'} onClick={toggleBulk}>
            <Icon icon={bulk.show ? 'collapse-all' : 'expand-all'} />
          </button>
        </span>
      </div>
      <div className="section-body ap-tree" tabIndex={0} onContextMenu={(e) => openMenu(e, rootItems)}>
        {!scene.path ? (
          <div className="scene-note">打開劇本後，這裡會列出這一場用到的角色和設定。</div>
        ) : scene.items.length === 0 ? (
          <div className="scene-note">這一場還沒有用到設定卡。在卡片上按右鍵「固定到本場」可以手動加進來。</div>
        ) : (
          scene.items.map(({ section, card, pinned }) => {
            const head = section !== lastSection;
            lastSection = section;
            const sm = sectionMeta(section);
            return (
              <Fragment key={`${section}:${card.id}`}>
                {head && (
                  <div className="scene-group">
                    <Icon icon={sm.icon} /> {sm.title}
                  </div>
                )}
                <CardItem
                  section={section}
                  card={card}
                  ops={props.cardOps}
                  bulk={bulk}
                  selected={false}
                  depth={0}
                  pad={4}
                  bodyOpen={bodies.has(cardTabId(section, card.id))}
                  onBodyToggle={() => toggleBody(cardTabId(section, card.id))}
                  rowProps={{
                    onClick: () => setSel(cardTabId(section, card.id)),
                    onDoubleClick: () => props.cardOps.open(section, card.id),
                  }}
                  rowClass={` ap-row${sel === cardTabId(section, card.id) ? ' ap-selected' : ''}`}
                  onMenu={(e) =>
                    openMenu(e, [
                      { label: '編輯', onClick: () => props.cardOps.open(section, card.id) },
                      { label: '放大檢視', onClick: () => openCardViewer(section, card.id) },
                      ...pinItem(scene, section, card.name),
                      { label: '重新命名', onClick: () => setRenaming({ section, id: card.id }) },
                    ])
                  }
                  renaming={renaming?.section === section && renaming.id === card.id}
                  onRename={(name) => props.cardOps.rename(section, card.id, name)}
                  onRenameClose={() => setRenaming(null)}
                  schemaFields={props.schemas[section]?.fields ?? []}
                  targetIcon={(name) => targetIcon(props.cards, name, section)}
                  badge={pinned ? <span className="scene-pin" title="手動固定在本場"><Icon icon="pin" /></span> : undefined}
                />
              </Fragment>
            );
          })
        )}
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={menu.items} />}
    </div>
  );
}
