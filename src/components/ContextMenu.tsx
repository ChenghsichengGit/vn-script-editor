import { useLayoutEffect, useRef, useState } from 'react';
import './ContextMenu.css';
import { useEscape, useOutsideClick } from '../hooks';

export interface ContextMenuItem {
  label: string;
  onClick?: () => void;
  disabled?: boolean; // 灰色、點了沒反應
  children?: ContextMenuItem[]; // 有的話是第二層：滑鼠移上去才在右邊展開
  separator?: boolean; // 分隔線（開頭、結尾、連續的會自動拿掉）
}

export const SEP: ContextMenuItem = { label: '', separator: true };

// 拿掉多餘的分隔線：開頭、結尾、連在一起的
function tidy(items: ContextMenuItem[]) {
  const out: ContextMenuItem[] = [];
  for (const it of items) {
    if (it.separator && (out.length === 0 || out[out.length - 1].separator)) continue;
    out.push(it);
  }
  while (out.length && out[out.length - 1].separator) out.pop();
  return out;
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

// 第二層：預設開在右邊；右邊放不下就改開在左邊，底下超出視窗就往上移
function SubMenu({ items, onClose }: { items: ContextMenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: boolean; up: number }>({ left: false, up: 0 });
  useLayoutEffect(() => {
    const el = ref.current!;
    const rect = el.getBoundingClientRect();
    const parent = el.parentElement!.getBoundingClientRect();
    const left = rect.right > window.innerWidth && parent.left - rect.width >= 0;
    const up = Math.max(0, Math.min(rect.top, rect.bottom - window.innerHeight));
    setPlace({ left, up });
  }, []);
  return (
    <div
      ref={ref}
      className={`context-menu context-submenu${place.left ? ' to-left' : ''}`}
      style={place.up ? { transform: `translateY(-${place.up}px)` } : undefined}
    >
      <MenuItems items={items} onClose={onClose} />
    </div>
  );
}

function MenuItems({ items, onClose }: { items: ContextMenuItem[]; onClose: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      {tidy(items).map((item, i) => {
        if (item.separator) return <div key={`sep${i}`} className="context-menu-sep" />;
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
            {sub && open === item.label && <SubMenu items={item.children!} onClose={onClose} />}
          </div>
        );
      })}
    </>
  );
}
