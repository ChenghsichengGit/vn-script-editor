import { useEffect, useRef, useState } from 'react';
import { dragWith } from '../App';
import { FLOAT_MIN_H, FLOAT_MIN_W, FloatPanel } from '../layout';
import SectionPanel, { TreeProps } from './SectionPanel';

interface Props extends TreeProps {
  panels: FloatPanel[]; // 要顯示的浮動面板（已經排除被隱藏的）
  onChange: (id: FloatPanel['id'], patch: Partial<Pick<FloatPanel, 'x' | 'y' | 'w' | 'h'>>) => void;
  onFront: (id: FloatPanel['id']) => void; // 點到面板：移到最上層
}

// 八個縮放把手：n/s/e/w 代表拖哪條邊，兩個字母就是角落
const HANDLES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

// 蓋在主區域上方的一層，放所有浮動面板。這一層本身不擋滑鼠（pointer-events: none），只有面板接收
// 面板的座標是相對於這一層；顯示時一律限制在這一層裡面（視窗縮小了面板也不會跑出去）
export default function FloatLayer({ panels, onChange, onFront, ...tree }: Props) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  // 量這一層的大小，視窗改變時跟著更新
  useEffect(() => {
    const el = layerRef.current!;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 把面板的矩形限制在這一層裡（至少 200x150，除非這一層本身更小）
  const fit = (f: { x: number; y: number; w: number; h: number }) => {
    const w = Math.min(Math.max(f.w, FLOAT_MIN_W), Math.max(size.w, 1));
    const h = Math.min(Math.max(f.h, FLOAT_MIN_H), Math.max(size.h, 1));
    return {
      w,
      h,
      x: Math.min(Math.max(0, f.x), Math.max(0, size.w - w)),
      y: Math.min(Math.max(0, f.y), Math.max(0, size.h - h)),
    };
  };

  // 從邊或角落拖曳縮放：被拖的那一邊跟著滑鼠，對面那一邊不動
  const startResize = (panel: FloatPanel, dir: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const { x, y, w, h } = fit(panel);
    const startX = e.clientX;
    const startY = e.clientY;
    const bounds = size;

    dragWith((ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      let nx = x, ny = y, nw = w, nh = h;
      if (dir.includes('e')) nw = Math.min(Math.max(FLOAT_MIN_W, w + dx), bounds.w - x);
      if (dir.includes('s')) nh = Math.min(Math.max(FLOAT_MIN_H, h + dy), bounds.h - y);
      if (dir.includes('w')) {
        nx = Math.min(Math.max(0, x + dx), x + w - FLOAT_MIN_W);
        nw = x + w - nx;
      }
      if (dir.includes('n')) {
        ny = Math.min(Math.max(0, y + dy), y + h - FLOAT_MIN_H);
        nh = y + h - ny;
      }
      onChange(panel.id, { x: nx, y: ny, w: nw, h: nh });
    });
  };

  const top = Math.max(0, ...panels.map((p) => p.z));

  return (
    <div className="float-layer" ref={layerRef}>
      {panels.map((p) => {
        const r = fit(p);
        return (
          <div
            key={p.id}
            className="float-panel"
            data-float={p.id}
            style={{ left: r.x, top: r.y, width: r.w, height: r.h, zIndex: p.z }}
            // 用 capture：點到裡面任何東西（包括會 stopPropagation 的）都先把面板移到最上層
            onMouseDownCapture={() => p.z !== top && onFront(p.id)}
          >
            <SectionPanel {...tree} id={p.id} fill floating />
            {HANDLES.map((d) => (
              <div key={d} className={`float-handle ${d}`} onMouseDown={(e) => startResize(p, d, e)} />
            ))}
          </div>
        );
      })}
    </div>
  );
}
