import { clearMarks, hasMarks, useChangeMarks } from '../changeMarks';

// 分頁最上面的提示條：這個劇本／設定卡有被外部改過的地方（淡黃底），按「清除標記」全部拿掉
export default function ChangeBar({ markKey }: { markKey: string }) {
  useChangeMarks();
  if (!hasMarks(markKey)) return null;
  return (
    <div className="change-bar">
      <span className="change-bar-dot" />
      有其他人的修改（淡黃底的地方）
      <button type="button" className="change-bar-btn" onClick={() => clearMarks(markKey)}>
        清除標記
      </button>
    </div>
  );
}
