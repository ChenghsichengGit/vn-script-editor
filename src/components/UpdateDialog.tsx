import { useEffect, useState } from 'react';
import { check, Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

// 自動更新：程式啟動時檢查有沒有新版本（網址在 src-tauri/tauri.conf.json 的 plugins.updater.endpoints）
// 有的話跳出這個視窗：顯示新版本號和更新內容 → 按「更新」下載（有進度條）→ 檢查簽章 → 安裝 → 重新啟動
// 下載的檔案會用程式裡的公鑰檢查簽章，不是我們簽的就不會安裝
// beforeInstall：安裝前先把沒存的內容存起來（安裝時程式會被關掉）
export default function UpdateDialog({ beforeInstall }: { beforeInstall: () => Promise<unknown> }) {
  const [update, setUpdate] = useState<Update | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 開發模式不檢查（版本號跟正式版不同，會一直跳）；只有程式的第一個視窗檢查
  useEffect(() => {
    if (import.meta.env.DEV || !window.api.isFirstWindow) return;
    check()
      .then((u) => u && setUpdate(u))
      .catch(() => {
        // 沒有網路、更新伺服器沒開：安靜略過，不打擾使用者
      });
  }, []);

  if (!update) return null;

  const install = async () => {
    setError(null);
    try {
      await beforeInstall();
      let done = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') setProgress({ done: 0, total: event.data.contentLength ?? 0 });
        else if (event.event === 'Progress') {
          done += event.data.chunkLength;
          setProgress((p) => ({ done, total: p?.total ?? 0 }));
        }
      });
      await relaunch();
    } catch (e) {
      setProgress(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const percent = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : null;

  return (
    <div className="close-backdrop">
      <div className="close-panel update-panel" role="dialog" aria-label="有新版本">
        <div className="close-message">
          有新版本 <b>{update.version}</b>（目前是 {update.currentVersion}）
        </div>
        {update.body && <div className="update-notes">{update.body}</div>}
        {progress && (
          <div className="update-progress">
            <div className="update-bar" style={{ width: `${percent ?? 100}%` }} />
            <span>{percent !== null ? `下載中… ${percent}%` : '下載中…'}</span>
          </div>
        )}
        {error && <div className="close-error">更新失敗：{error}</div>}
        <div className="close-buttons">
          <button type="button" className="close-btn primary" disabled={!!progress} onClick={() => void install()}>
            {progress ? '更新中…' : '更新'}
          </button>
          <button type="button" className="close-btn" disabled={!!progress} onClick={() => setUpdate(null)}>
            稍後再說
          </button>
        </div>
      </div>
    </div>
  );
}
