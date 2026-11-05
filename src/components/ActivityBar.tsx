import { SectionId } from '../model';
import { sectionMeta, sectionOrder } from '../sections';
import Icon from './Icon';

// 最左邊的圖示列：每個圖示是一個開關，可以同時開好幾個（關閉專案改由選單的「檔案」操作）
// 最下面的按鈕把整排左側欄收起來／打開（和 Ctrl+B 一樣）
export default function ActivityBar(props: {
  active: SectionId[];
  onToggle: (id: SectionId) => void;
  leftOpen: boolean;
  onToggleLeft: () => void;
}) {
  return (
    <nav className="activity-bar">
      {sectionOrder().map((id) => (
        <button
          key={id}
          className={props.active.includes(id) ? 'active' : ''}
          data-tip={`${sectionMeta(id).title}：顯示／隱藏這個區塊`}
          onClick={() => props.onToggle(id)}
        >
          <Icon icon={sectionMeta(id).icon.name} />
        </button>
      ))}
      <button
        className="activity-collapse"
        data-tip={props.leftOpen ? '收起左側欄 (Ctrl+B)' : '打開左側欄 (Ctrl+B)'}
        onClick={props.onToggleLeft}
      >
        <Icon icon={props.leftOpen ? 'layout-sidebar-left' : 'layout-sidebar-left-off'} />
      </button>
    </nav>
  );
}
