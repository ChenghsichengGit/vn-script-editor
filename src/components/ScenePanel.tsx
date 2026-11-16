// 「本場」區塊：目前劇本用到的設定卡（指令參數裡出現的、記憶出處是這個劇本的）＋手動固定的，照區塊分組
import { Fragment, useState } from 'react';
import type { CardSectionId, SectionId } from '../model';
import { cardTabId } from '../model';
import { sectionMeta } from '../sections';
import { sourceLabel, targetIcon } from '../memories';
import { useChangeMarks } from '../changeMarks';
import CardItem from './CardItem';
import ContextMenu, { ContextMenuItem } from './ContextMenu';
import Icon from './Icon';
import { FoldButton, TreeProps, pinItem } from './SectionPanel';
import { openCardViewer } from './MemoryViewer';

interface Props extends TreeProps {
  id: SectionId;
  fill?: boolean;
  height?: number;
  floating?: boolean;
  short?: boolean;
}

export default function ScenePanel(props: Props) {
  useChangeMarks();
  const { id, scene } = props;
  const meta = sectionMeta(id);
  const [bulk, setBulk] = useState({ show: false, tick: 0 });
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const [renaming, setRenaming] = useState<{ section: CardSectionId; id: string } | null>(null);
  const short = !!props.short && !props.floating;
  const toggleBulk = () => setBulk((b) => ({ show: !b.show, tick: b.tick + 1 }));
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
      style={!props.fill && !short ? { height: props.height } : undefined}
    >
      <div
        className="section-header"
        onMouseDown={(e) => {
          if (e.button === 0 && !(e.target as HTMLElement).closest('button')) props.onHeaderDrag(id, e);
        }}
        onContextMenu={(e) => openMenu(e, rootItems)}
      >
        {!props.floating && <FoldButton id={id} folded={props.folded.includes(id)} empty={scene.items.length === 0} onFold={props.onFold} />}
        <span className="section-title" title={scene.path ? `目前進度：${scene.path}` : '打開劇本後，這裡會列出這一場用到的設定卡'}>
          {meta.title}
          {scene.path && <span className="scene-script">：{sourceLabel(scene.path)}</span>}
        </span>
        <span className="section-actions">
          <button className="icon-btn" data-tip={bulk.show ? '全部收起：每張卡只顯示名稱' : '全部展開：顯示每張卡的欄位和詳細內容'} onClick={toggleBulk}>
            <Icon icon={bulk.show ? 'collapse-all' : 'expand-all'} />
          </button>
        </span>
      </div>
      <div className="section-body" onContextMenu={(e) => openMenu(e, rootItems)}>
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
                  selected={props.activeTab === cardTabId(section, card.id)}
                  depth={0}
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
