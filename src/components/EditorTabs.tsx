// 分頁列 + 下方內容區。內容要顯示什麼由 App 決定（劇本編輯器或設定卡）
interface Props {
  tabs: { id: string; label: string; dirty?: boolean }[];
  activeTab: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  children: React.ReactNode;
}

export default function EditorTabs(props: Props) {
  return (
    <section className="editor-area">
      <div className="tabs">
        {props.tabs.map((tab) => (
          <div
            key={tab.id}
            className={`tab${tab.id === props.activeTab ? ' active' : ''}`}
            onClick={() => props.onSelect(tab.id)}
          >
            {tab.label}
            {tab.dirty && <span className="tab-dirty" title="尚未儲存">●</span>}
            <span
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation(); // 避免點 × 時也觸發「切換分頁」
                props.onClose(tab.id);
              }}
            >
              ×
            </span>
          </div>
        ))}
      </div>
      <div className="editor-content">{props.children}</div>
    </section>
  );
}
