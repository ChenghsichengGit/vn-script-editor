import { useEffect, useLayoutEffect, useRef, useState } from 'react';

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
    <div ref={ref} className="tooltip" style={pos ?? { left: -9999, top: -9999 }}>{tip.text}</div>
  );
}
