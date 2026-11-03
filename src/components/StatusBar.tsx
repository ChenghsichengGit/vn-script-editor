import Icon from './Icon';

// 底部狀態列：左邊顯示目前開的是什麼，右邊顯示位置或字數（內容由 App 決定）
export default function StatusBar(props: { left: string; right: string; problems?: number; onProblems?: () => void }) {
  return (
    <footer className="status-bar">
      {props.problems !== undefined && (
        <button type="button" className="status-problems" title="問題 (Ctrl+Shift+M)" onClick={props.onProblems}>
          <Icon icon="error" /> {props.problems}
        </button>
      )}
      <span>{props.left}</span>
      <span className="status-right">{props.right}</span>
    </footer>
  );
}
