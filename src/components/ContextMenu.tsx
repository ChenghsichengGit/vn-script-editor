import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import './ContextMenu.css';

export interface ContextMenuItem {
  label: string;
  onClick: () => void;
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
      if (e.key === 'Escape') onClose();
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
      {items.map((item) => (
        <div
          key={item.label}
          className="context-menu-item"
          onClick={() => {
            onClose();
            item.onClick();
          }}
        >
          {item.label}
        </div>
      ))}
    </div>
  );
}
