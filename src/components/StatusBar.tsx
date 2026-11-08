import Icon from './Icon';

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
