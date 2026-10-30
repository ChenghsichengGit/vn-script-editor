import { Fragment, useRef } from 'react';
import { dragWith } from '../App';
import type { Layout, Side } from '../layout';
import { SectionId } from '../model';
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

// 側邊欄（左右兩邊共用）：把這一邊的區塊上下疊起來
// 每個區塊拖到多高就固定多高；只有「最下面的區塊」會伸縮填滿剩下的空間
// 放不下時，固定高度的區塊會按比例暫時縮小（記住的高度不變，空間夠了就恢復），側邊欄不會出現捲軸
export default function Sidebar(props: Props) {
  const { layout, sections, side, onLayoutChange, ...tree } = props;
  const asideRef = useRef<HTMLElement>(null);

  const filler = sections[sections.length - 1]; // 負責填滿空間的那一塊

  // 拖曳第 index 條分隔線：改變上方區塊的高度
  // 下方如果是填滿用的區塊，它會自動吸收差額；如果是固定高度的，就一增一減
  const startSectionResize = (index: number, e: React.MouseEvent) => {
    e.preventDefault();
    const above = sections[index];
    const below = sections[index + 1];
    if (!above || !below) return;

    const height = (id: SectionId) =>
      asideRef.current!.querySelector(`:scope > [data-section="${id}"]`)!.getBoundingClientRect().height;
    const startAbove = height(above);
    const startBelow = height(below);
    const startY = e.clientY;
    const belowMin = below === filler ? FILLER_MIN_HEIGHT : MIN_HEIGHT;

    dragWith((ev) => {
      let dy = ev.clientY - startY;
      // 上下兩塊都不能比最小高度矮，否則內容會撐出側邊欄、跑出捲軸
      dy = Math.max(MIN_HEIGHT - startAbove, dy);
      dy = Math.min(startBelow - belowMin, dy);
      const sizes = { ...layout.sizes, [above]: startAbove + dy };
      if (below !== filler) sizes[below] = startBelow - dy;
      onLayoutChange({ sizes });
    });
  };

  return (
    <aside className="sidebar" data-side={side} style={{ width: layout[side].width }} ref={asideRef}>
      {sections.map((id, i) => (
        <Fragment key={id}>
          {i > 0 && <div className="section-sash" onMouseDown={(e) => startSectionResize(i - 1, e)} />}
          <SectionPanel {...tree} id={id} fill={id === filler} height={layout.sizes[id] ?? DEFAULT_HEIGHT} />
        </Fragment>
      ))}
    </aside>
  );
}
