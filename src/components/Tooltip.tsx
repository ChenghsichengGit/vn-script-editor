import { useEffect, useLayoutEffect, useRef, useState } from 'react';

// 按鈕的提示框（取代瀏覽器內建的 title：那個要停很久才出現，字也很小）
// 用法：在任何元素上加 data-tip="說明文字"；滑鼠停 0.4 秒就在它下方（下方放不下就上方）顯示
// 整個畫面只放一個 <Tooltip />（在 App 裡）
export default function Tooltip() {
  const [tip, setTip] = useState<{ text: string; anchor: DOMRect } | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timer: number | undefined;
    let current: HTMLElement | null = null;
    const hide = () => {
      window.clearTimeout(timer);
      current = null;
      setTip(null);
    };
    const onOver = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]');
      if (el === current) return;
      hide();
      if (!el) return;
      current = el;
      timer = window.setTimeout(() => setTip({ text: el.dataset.tip ?? '', anchor: el.getBoundingClientRect() }), 400);
    };
    window.addEventListener('mouseover', onOver);
    window.addEventListener('mousedown', hide, true);
    window.addEventListener('wheel', hide, true);
    return () => {
      hide();
      window.removeEventListener('mouseover', onOver);
      window.removeEventListener('mousedown', hide, true);
      window.removeEventListener('wheel', hide, true);
    };
  }, []);

  // 量出提示框大小再決定位置：置中在按鈕下方，超出視窗左右邊就往內推；下方放不下改放上方
  useLayoutEffect(() => {
    if (!tip || !ref.current) return setPos(null);
    const { width, height } = ref.current.getBoundingClientRect();
    const a = tip.anchor;
    const left = Math.max(4, Math.min(a.left + a.width / 2 - width / 2, window.innerWidth - width - 4));
    const top = a.bottom + 6 + height > window.innerHeight ? a.top - 6 - height : a.bottom + 6;
    setPos({ left, top });
  }, [tip]);

  if (!tip) return null;
  return (
    <div ref={ref} className="tooltip" style={pos ?? { left: -9999, top: -9999 }}>
      {tip.text}
    </div>
  );
}
