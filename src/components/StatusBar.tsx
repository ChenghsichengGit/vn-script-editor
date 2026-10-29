// 底部狀態列：左邊顯示目前開的是什麼，右邊顯示位置或字數（內容由 App 決定）
export default function StatusBar(props: { left: string; right: string }) {
  return (
    <footer className="status-bar">
      <span>{props.left}</span>
      <span className="status-right">{props.right}</span>
    </footer>
  );
}
