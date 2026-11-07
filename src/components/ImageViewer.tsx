import { useEffect, useRef, useState } from 'react';
import { imageSrc } from '../images';

// 點圖片欄位（卡片分頁、側邊欄縮圖）的圖：畫面變暗，圖片放大在中央
//   滾輪：放大縮小（原尺寸的 0.2～10 倍）；圖片還放得進視窗時維持置中，超出視窗後才朝滑鼠的位置縮放
//   按住拖曳：移動圖片；雙擊：回到剛打開的大小和位置
//   Esc 或點圖片以外的地方：關掉（拖曳放開時不算）
// 任何地方呼叫 openImageViewer(路徑) 就會打開；畫面本身（ImageViewerHost）在 App 裡放一個

const OPEN_EVENT = 'vn-open-image';
const MIN_SCALE = 0.2;
const MAX_SCALE = 10;

export function openImageViewer(path: string) {
  if (path.trim()) window.dispatchEvent(new CustomEvent<string>(OPEN_EVENT, { detail: path }));
}

export default function ImageViewerHost() {
  const [path, setPath] = useState<string | null>(null);
  useEffect(() => {
    const open = (e: Event) => setPath((e as CustomEvent<string>).detail);
    window.addEventListener(OPEN_EVENT, open);
    return () => window.removeEventListener(OPEN_EVENT, open);
  }, []);
  return path ? <ImageViewer key={path} path={path} onClose={() => setPath(null)} /> : null;
}

interface View {
  scale: number; // 相對於圖片原尺寸
  x: number; // 圖片左上角在畫面上的位置
  y: number;
}

function ImageViewer({ path, onClose }: { path: string; onClose: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [broken, setBroken] = useState(false);
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const fitRef = useRef<View>({ scale: 1, x: 0, y: 0 });
  const dragged = useRef(false); // 這次按下滑鼠有沒有拖動（拖完放開不算「點一下關掉」）

  // 剛打開的樣子：放得下就照原尺寸，放不下就縮到視窗的 90%，置中
  const fit = (w: number, h: number): View => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const scale = Math.min(1, (vw * 0.9) / w, (vh * 0.9) / h);
    return { scale, x: (vw - w * scale) / 2, y: (vh - h * scale) / 2 };
  };

  // Esc 關掉
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [onClose]);

  // 滾輪縮放（要能 preventDefault，所以自己掛 passive: false 的監聽）
  useEffect(() => {
    const el = rootRef.current;
    if (!el || !natural) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      const min = Math.min(MIN_SCALE, fitRef.current.scale);
      const scale = Math.min(MAX_SCALE, Math.max(min, v.scale * Math.exp(-e.deltaY * 0.0015)));
      const k = scale / v.scale;
      // 橫向、直向分開算：圖片在這個方向還放得進視窗 → 在畫面中央；超出視窗 → 滑鼠指著的那一點縮放前後留在原位
      const axis = (mouse: number, pos: number, size: number, view: number) => {
        const next = size * scale;
        return next <= view ? (view - next) / 2 : mouse - (mouse - pos) * k;
      };
      setView({
        scale,
        x: axis(e.clientX, v.x, natural.w, window.innerWidth),
        y: axis(e.clientY, v.y, natural.h, window.innerHeight),
      });
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [natural]);

  const startDrag = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const sx = e.clientX;
    const sy = e.clientY;
    const start = viewRef.current;
    dragged.current = false;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      if (Math.abs(dx) + Math.abs(dy) > 3) dragged.current = true;
      setView({ ...start, x: start.x + dx, y: start.y + dy });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('image-viewer-dragging');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    document.body.classList.add('image-viewer-dragging');
  };

  return (
    <div
      className="image-viewer"
      ref={rootRef}
      onPointerDown={() => (dragged.current = false)}
      onClick={(e) => {
        // 點在圖片以外的地方才關；剛拖完放開不關
        if (e.target === e.currentTarget && !dragged.current) onClose();
      }}
    >
      {broken ? (
        <div className="image-viewer-missing" onClick={onClose}>
          找不到圖片：{path}
        </div>
      ) : (
        <img
          className="image-viewer-img"
          src={imageSrc(path)}
          alt={path}
          draggable={false}
          style={
            natural
              ? { width: natural.w, height: natural.h, transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }
              : { visibility: 'hidden' }
          }
          onLoad={(e) => {
            const img = e.currentTarget;
            const w = img.naturalWidth || 1;
            const h = img.naturalHeight || 1;
            fitRef.current = fit(w, h);
            setNatural({ w, h });
            setView(fitRef.current);
          }}
          onError={() => setBroken(true)}
          onPointerDown={startDrag}
          onDoubleClick={() => setView(fitRef.current)}
        />
      )}
      {natural && !broken && (
        <div className="image-viewer-info">
          {Math.round(view.scale * 100)}%　{path}
        </div>
      )}
    </div>
  );
}
