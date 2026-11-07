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

  // 拖曳第 index 條分隔線（在第 index 和 index+1 塊之間）
  // 一步一步推：每次滑鼠移動只套用這一小段位移，從目前的高度算起
  //   拖的方向那一邊的區塊由近到遠依序縮（最近的縮到最小，再推下一塊）；另一邊緊鄰的那塊變高
  //   往回拖時，之前被推過的區塊留在原地，不會彈回來
  //   推到底後線停住；滑鼠要回到線的位置，線才再跟著動（線和滑鼠一直對齊）
  // 填滿用的區塊（最下面）不記高度，它會自動吸收差額
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
      // 往下拖：下方由近到遠縮、上方緊鄰的那塊變高；往上拖反過來
      const shrink = dy > 0 ? all.slice(index + 1) : all.slice(0, index + 1).reverse();
      const grow = dy > 0 ? index : index + 1;
      let left = Math.abs(dy);
      for (const i of shrink) {
        if (left <= 0) break;
        const take = Math.min(left, Math.max(0, cur[i] - minOf(i)));
        cur[i] -= take;
        left -= take;
      }
      // 每一塊都縮到最小了：多拖的部分不算（區塊不能比最小高度矮，否則內容會撐出側邊欄、跑出捲軸）
      const moved = Math.abs(dy) - left;
      if (moved === 0) return; // 已經推到底，滑鼠還在線的外側：線不動
      cur[grow] += moved;
      lineY += Math.sign(dy) * moved;
      const sizes = { ...layout.sizes };
      sections.forEach((id, i) => {
        if (id !== filler && cur[i] !== start[i]) sizes[id] = cur[i];
      });
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
