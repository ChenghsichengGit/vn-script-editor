import { errorText } from '../hooks';
import { useEffect, useState } from 'react';
import { check, Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

export default function UpdateDialog({ beforeInstall, manualCheck }: { beforeInstall: () => Promise<unknown>; manualCheck: number }) {
  const [update, setUpdate] = useState<Update | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null); // 手動檢查的結果（已經是最新版、檢查失敗）
  useEffect(() => {
    if (import.meta.env.DEV || !window.api.isFirstWindow) return;
    check()
      .then((u) => u && setUpdate(u))
      .catch(() => {
      });
  }, []);
  useEffect(() => {
    if (manualCheck === 0) return;
    setNotice('檢查中…');
    check()
      .then((u) => {
        if (u) {
          setNotice(null);
          setUpdate(u);
        } else setNotice('已經是最新版本了。');
      })
      .catch((e) => setNotice(`無法檢查更新：${errorText(e)}`));
  }, [manualCheck]);
  if (notice && !update) {
    return (
      <div className="close-backdrop">
        <div className="close-panel" role="dialog" aria-label="檢查更新">
          <div className="close-message">{notice}</div>
          <div className="close-buttons">
            <button type="button" className="close-btn primary" onClick={() => setNotice(null)} autoFocus>確定</button>
          </div>
        </div>
      </div>
    );
  }
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
      setError(errorText(e));
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
          <button type="button" className="close-btn primary" disabled={!!progress} onClick={() => void install()}>{progress ? '更新中…' : '更新'}</button>
          <button type="button" className="close-btn" disabled={!!progress} onClick={() => setUpdate(null)}>稍後再說</button>
        </div>
      </div>
    </div>
  );
}
