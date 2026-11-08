import { useLayoutEffect, useRef, useState } from 'react';
import './ContextMenu.css';
import { useEscape, useOutsideClick } from '../hooks';

export interface ContextMenuItem {
  label: string;
  onClick?: () => void;
  disabled?: boolean; // 灰色、點了沒反應
  children?: ContextMenuItem[]; // 有的話是第二層：滑鼠移上去才在右邊展開
}

interface Props {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export default function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const rect = ref.current!.getBoundingClientRect();
    setPos({ left: Math.max(0, Math.min(x, window.innerWidth - rect.width)), top: Math.max(0, Math.min(y, window.innerHeight - rect.height)) });
  }, [x, y]);
  useOutsideClick(ref, onClose);
  useEscape(onClose); // 只關選單，不會連外面的對話框也一起關掉
  return (
    <div className="context-menu" ref={ref} style={pos} onContextMenu={(e) => e.preventDefault()}><MenuItems items={items} onClose={onClose} /></div>
  );
}

function MenuItems({ items, onClose }: { items: ContextMenuItem[]; onClose: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      {items.map((item) => {
        const sub = item.children && !item.disabled;
        return (
          <div
            key={item.label}
            className={`context-menu-item${item.disabled ? ' disabled' : ''}${item.children ? ' has-sub' : ''}`}
            onMouseEnter={() => setOpen(sub ? item.label : null)}
            onClick={() => {
              if (item.disabled || item.children) return;
              onClose();
              item.onClick?.();
            }}
          >
            {item.label}
            {item.children && <span className="context-menu-arrow">▸</span>}
            {sub && open === item.label && (
              <div className="context-menu context-submenu"><MenuItems items={item.children!} onClose={onClose} /></div>
            )}
          </div>
        );
      })}
    </>
  );
}
