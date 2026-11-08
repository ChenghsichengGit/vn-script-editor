import { Fragment, useRef } from 'react';
import { dragWith } from '../hooks';
import type { Layout, Side } from '../layout';
import { SectionId } from '../model';
import { sectionOrder } from '../sections';
import SectionPanel, { TreeProps } from './SectionPanel';

interface Props extends TreeProps {
  side: Side;
  sections: SectionId[]; // 要顯示的區塊（已經排除被隱藏的），由上到下
  layout: Layout;
  onLayoutChange: (patch: Partial<Layout>) => void;
}

const MIN_HEIGHT = 60; // 每個展開區塊最矮多高
const FILLER_MIN_HEIGHT = 120; // 填滿用的區塊最矮多高（要和 styles.css 的 .section.filler 一致）
const DEFAULT_HEIGHT = 200; // 還沒調整過的區塊預設高度（像素）

export default function Sidebar(props: Props) {
  const { layout, sections, side, onLayoutChange, ...tree } = props;
  const asideRef = useRef<HTMLElement>(null);
  const filler = sections[sections.length - 1]; // 負責填滿空間的那一塊
  const existing = new Set(sectionOrder());
  const placed = layout[side].sections.filter((id) => sections.includes(id) || (layout.hidden.includes(id) && existing.has(id)));
  const bonus: Partial<Record<SectionId, number>> = {};
  placed.forEach((id, i) => {
    if (sections.includes(id)) return;
    const after = placed.slice(i + 1).find((s) => sections.includes(s));
    if (!after) return; // 下面已經沒有顯示的區塊：最下面那塊本來就會填滿
    const before = placed.slice(0, i).reverse().find((s) => sections.includes(s));
    const to = before ?? after;
    bonus[to] = (bonus[to] ?? 0) + (layout.sizes[id] ?? DEFAULT_HEIGHT) + 1; // + 1 = 分隔線
  });
  const startSectionResize = (index: number, e: React.MouseEvent) => {
    e.preventDefault();
    if (!sections[index] || !sections[index + 1]) return;
    const height = (id: SectionId) =>
      asideRef.current!.querySelector(`:scope > [data-section="${id}"]`)!.getBoundingClientRect().height;
    const start = sections.map(height);
    const cur = start.slice(); // 目前的高度（每一步都在這上面改）
    const minOf = (i: number) => (sections[i] === filler ? FILLER_MIN_HEIGHT : MIN_HEIGHT);
    const all = sections.map((_, i) => i);
    let lineY = e.clientY; // 線目前在哪（滑鼠拖過頭時，線停在這裡）
    dragWith((ev) => {
      const dy = ev.clientY - lineY;
      if (dy === 0) return;
      const shrink = dy > 0 ? all.slice(index + 1) : all.slice(0, index + 1).reverse();
      const grow = dy > 0 ? index : index + 1;
      let left = Math.abs(dy);
      for (const i of shrink) {
        if (left <= 0) break;
        const take = Math.min(left, Math.max(0, cur[i] - minOf(i)));
        cur[i] -= take;
        left -= take;
      }
      const moved = Math.abs(dy) - left;
      if (moved === 0) return; // 已經推到底，滑鼠還在線的外側：線不動
      cur[grow] += moved;
      lineY += Math.sign(dy) * moved;
      const sizes = { ...layout.sizes };
      sections.forEach((id, i) => {
        if (id !== filler && cur[i] !== start[i]) sizes[id] = Math.max(MIN_HEIGHT, cur[i] - (bonus[id] ?? 0)); // 臨時加的高度不記
      });
      onLayoutChange({ sizes });
    });
  };
  return (
    <aside className="sidebar" data-side={side} style={{ width: layout[side].width }} ref={asideRef}>
      {sections.map((id, i) => (
        <Fragment key={id}>
          {i > 0 && <div className="section-sash" onMouseDown={(e) => startSectionResize(i - 1, e)} />}
          <SectionPanel {...tree} id={id} fill={id === filler} height={(layout.sizes[id] ?? DEFAULT_HEIGHT) + (bonus[id] ?? 0)} />
        </Fragment>
      ))}
    </aside>
  );
}
