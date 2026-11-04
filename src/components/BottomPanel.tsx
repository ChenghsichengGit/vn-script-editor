import type { ReactNode } from 'react';
import Icon from './Icon';

export type PanelTab = 'problems' | 'search';

// 編輯區下方的面板（跟 VS Code 一樣）：上面一排分頁「問題｜搜尋」，內容由外面給
// 上緣可以拖曳調整高度
export default function BottomPanel({
  tab,
  onTab,
  problemCount,
  height,
  onResize,
  onClose,
  children,
}: {
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  problemCount: number;
  height: number;
  onResize: (height: number) => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = height;
    const move = (ev: MouseEvent) => onResize(Math.min(600, Math.max(80, startH + startY - ev.clientY)));
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const tabButton = (id: PanelTab, label: string, tip: string, badge?: number) => (
    <button type="button" className={`panel-tab${tab === id ? ' active' : ''}`} data-tip={tip} onClick={() => onTab(id)}>
      {label}
      {badge !== undefined && <span className="problems-count">{badge}</span>}
    </button>
  );

  return (
    <div className="problems" style={{ height }}>
      <div className="problems-resize" onMouseDown={startResize} />
      <div className="problems-header">
        {tabButton('problems', '問題', '問題 (Ctrl+Shift+M)', problemCount)}
        {tabButton('search', '搜尋', '在整個專案中搜尋 (Ctrl+Shift+F)')}
        <button type="button" className="icon-btn problems-close" data-tip="關閉面板" onClick={onClose}>
          <Icon icon="close" />
        </button>
      </div>
      {children}
    </div>
  );
}
