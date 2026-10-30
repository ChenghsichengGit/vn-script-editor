import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import './ContextMenu.css';

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

// 右鍵選單：出現在滑鼠位置，點外面、按 Esc、選了項目之後都會關閉
export default function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // 量出選單大小，如果會超出視窗就往回推，避免被切掉
  useLayoutEffect(() => {
    const rect = ref.current!.getBoundingClientRect();
    setPos({
      left: Math.max(0, Math.min(x, window.innerWidth - rect.width)),
      top: Math.max(0, Math.min(y, window.innerHeight - rect.height)),
    });
  }, [x, y]);

  useEffect(() => {
    // 點在選單外面就關掉（用 capture，才不會被其他元件的 stopPropagation 擋住）
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation(); // 只關選單，不要連外面的對話框也一起關掉
        onClose();
      }
    };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);

  return (
    <div className="context-menu" ref={ref} style={pos} onContextMenu={(e) => e.preventDefault()}>
      <MenuItems items={items} onClose={onClose} />
    </div>
  );
}

// 一層選單的項目；有 children 的項目滑鼠移上去，在右邊展開下一層
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
              <div className="context-menu context-submenu">
                <MenuItems items={item.children!} onClose={onClose} />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
