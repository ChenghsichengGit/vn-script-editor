import { useState } from 'react';
import { SectionId } from '../model';
import { sectionMeta, sectionOrder } from '../sections';
import ContextMenu from './ContextMenu';
import Icon from './Icon';

export default function ActivityBar(props: {
  active: SectionId[];
  onToggle: (id: SectionId) => void;
  leftOpen: boolean;
  onToggleLeft: () => void;
  onEditSections: () => void;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  // 右鍵：區塊設定、顯示／隱藏各區塊
  const items = [
    { label: '區塊設定…', onClick: props.onEditSections },
    ...sectionOrder().map((id) => ({ label: `${props.active.includes(id) ? '✓' : '　'} ${sectionMeta(id).title}`, onClick: () => props.onToggle(id) })),
  ];
  return (
    <nav className="activity-bar" onContextMenu={(e) => (e.preventDefault(), setMenu({ x: e.clientX, y: e.clientY }))}>
      {sectionOrder().map((id) => (
        <button
          key={id}
          className={props.active.includes(id) ? 'active' : ''}
          data-tip={`${sectionMeta(id).title}：顯示／隱藏這個區塊`}
          onClick={() => props.onToggle(id)}
        >
          <Icon icon={sectionMeta(id).icon.name} />
        </button>
      ))}
      <button className="activity-collapse" data-tip={props.leftOpen ? '收起左側欄 (Ctrl+B)' : '打開左側欄 (Ctrl+B)'} onClick={props.onToggleLeft}>
        <Icon icon={props.leftOpen ? 'layout-sidebar-left' : 'layout-sidebar-left-off'} />
      </button>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />}
    </nav>
  );
}
