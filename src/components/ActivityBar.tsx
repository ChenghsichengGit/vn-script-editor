import { SectionId } from '../model';
import { sectionMeta, sectionOrder } from '../sampleData';

// 最左邊的圖示列：每個圖示是一個開關，可以同時開好幾個（關閉專案改由選單的「檔案」操作）
export default function ActivityBar(props: {
  active: SectionId[];
  onToggle: (id: SectionId) => void;
}) {
  return (
    <nav className="activity-bar">
      {sectionOrder.map((id) => (
        <button
          key={id}
          className={props.active.includes(id) ? 'active' : ''}
          title={sectionMeta[id].title}
          onClick={() => props.onToggle(id)}
        >
          {sectionMeta[id].icon}
        </button>
      ))}
    </nav>
  );
}
