import { Fragment, useRef } from 'react';
import { dragWith } from '../hooks';
import { useCtrlWheel } from '../settings';
import type { Layout, Side } from '../layout';
import { SectionId } from '../model';
import { ASSETS_ID, SCENE_ID, sectionOrder } from '../sections';
import SectionPanel, { TreeProps } from './SectionPanel';
import ScenePanel from './ScenePanel';
import AssetPanel from './AssetPanel';

interface Props extends TreeProps {
  side: Side;
  sections: SectionId[]; // 要顯示的格子（疊成標籤的用佔位區塊的 id；已經排除整疊都被隱藏的），由上到下
  layout: Layout;
  onLayoutChange: (patch: Partial<Layout>) => void;
}

const MIN_HEIGHT = 60; // 每個展開區塊最矮多高
const FILLER_MIN_HEIGHT = 120; // 填滿用的區塊最矮多高（要和 styles.css 的 .section.filler 一致）
const DEFAULT_HEIGHT = 200; // 還沒調整過的區塊預設高度（像素）

export default function Sidebar(props: Props) {
  const { layout, sections, side, onLayoutChange, ...tree } = props;
  const asideRef = useRef<HTMLElement>(null);
  useCtrlWheel(asideRef, 'sidebarFontSize');
  // 摺疊的區塊只剩標題列（沒有內容的不會自動縮小）；空出來的高度給最下面那個展開的區塊（負責填滿空間）
  const shown = tree.stacks.shown;
  // 一格疊了好幾個區塊時，看現在顯示的那個
  const isShort = (slot: SectionId) => tree.folded.includes(shown(slot));
  const live = sections.filter((id) => !isShort(id));
  const filler = live[live.length - 1];
  const existing = new Set(sectionOrder());
  const placed = layout[side].sections.filter((id) => sections.includes(id) || existing.has(id)); // 沒顯示的 = 整疊都被隱藏
  const bonus: Partial<Record<SectionId, number>> = {};
  placed.forEach((id, i) => {
    if (sections.includes(id)) return;
    const after = placed.slice(i + 1).find((s) => sections.includes(s));
    if (!after) return; // 下面已經沒有顯示的區塊：最下面那塊本來就會填滿
    const before = placed.slice(0, i).reverse().find((s) => sections.includes(s));
    const to = before ?? after;
    bonus[to] = (bonus[to] ?? 0) + (layout.sizes[id] ?? DEFAULT_HEIGHT) + 1; // + 1 = 分隔線
  });
  // 拖區塊之間的線：只調整展開的區塊（線上面的、線下面的），只剩標題列的不動
  const startSectionResize = (boundary: number, e: React.MouseEvent) => {
    e.preventDefault();
    const above = sections.slice(0, boundary).filter((id) => live.includes(id));
    const below = sections.slice(boundary).filter((id) => live.includes(id));
    if (above.length === 0 || below.length === 0) return;
    const ids = [...above, ...below];
    const index = above.length - 1;
    const height = (id: SectionId) =>
      asideRef.current!.querySelector(`:scope > [data-slot="${id}"]`)!.getBoundingClientRect().height;
    const start = ids.map(height);
    const cur = start.slice(); // 目前的高度（每一步都在這上面改）
    const minOf = (i: number) => (ids[i] === filler ? FILLER_MIN_HEIGHT : MIN_HEIGHT);
    const all = ids.map((_, i) => i);
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
      ids.forEach((id, i) => {
        if (id !== filler && cur[i] !== start[i]) sizes[id] = Math.max(MIN_HEIGHT, cur[i] - (bonus[id] ?? 0)); // 臨時加的高度不記
      });
      onLayoutChange({ sizes });
    });
  };
  return (
    <aside className="sidebar" data-side={side} style={{ width: layout[side].width }} ref={asideRef}>
      {sections.map((slot, i) => {
        const id = shown(slot);
        const panel = { ...tree, id, slot, fill: slot === filler, short: isShort(slot), height: (layout.sizes[slot] ?? DEFAULT_HEIGHT) + (bonus[slot] ?? 0) };
        return (
          <Fragment key={slot}>
            {i > 0 && <div className="section-sash" onMouseDown={(e) => startSectionResize(i, e)} />}
            {id === SCENE_ID ? <ScenePanel key={id} {...panel} /> : id === ASSETS_ID ? <AssetPanel key={id} {...panel} /> : <SectionPanel key={id} {...panel} />}
          </Fragment>
        );
      })}
    </aside>
  );
}
