import { clearMarks, hasMarks, useChangeMarks } from '../changeMarks';

export default function ChangeBar({ markKey }: { markKey: string }) {
  useChangeMarks();
  if (!hasMarks(markKey)) return null;
  return (
    <div className="change-bar">
      <span className="change-bar-dot" />
      有其他人的修改（淡黃底的地方）
      <button type="button" className="change-bar-btn" onClick={() => clearMarks(markKey)}>清除標記</button>
    </div>
  );
}
