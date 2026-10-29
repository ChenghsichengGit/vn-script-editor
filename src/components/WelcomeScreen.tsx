import { useEffect, useState } from 'react';
import {
  ProjectData,
  ProjectStore,
  ensurePermission,
  forgetProject,
  fsSupported,
  getRecentProjects,
  pickFolder,
  rememberProject,
} from '../projectFiles';

type Recent = { name: string; handle: FileSystemDirectoryHandle };
type Opened = { store: ProjectStore; data: ProjectData };

// 開始畫面：開啟專案資料夾、建立新專案、最近開過的專案
export default function WelcomeScreen({ onOpen }: { onOpen: (store: ProjectStore, data: ProjectData) => void }) {
  const [recent, setRecent] = useState<Recent[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // 建立新專案的第二步：已經選好資料夾，等使用者輸入專案名稱
  const [creating, setCreating] = useState<FileSystemDirectoryHandle | null>(null);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    if (fsSupported) getRecentProjects().then(setRecent).catch(() => setRecent([]));
  }, []);

  // 共用流程：執行開啟／建立 → 成功就記到「最近的專案」並進入編輯器，失敗就顯示錯誤
  const run = async (task: () => Promise<Opened | null>) => {
    setError('');
    setBusy(true);
    try {
      const opened = await task();
      if (opened) {
        await rememberProject(opened.data.name, opened.store.dir);
        onOpen(opened.store, opened.data);
      }
    } catch (e) {
      setError(`發生錯誤：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const openFolder = () =>
    run(async () => {
      const dir = await pickFolder();
      return dir ? ProjectStore.open(dir) : null;
    });

  const openRecent = (handle: FileSystemDirectoryHandle) =>
    run(async () => {
      // 瀏覽器重開後要重新允許存取資料夾
      if (!(await ensurePermission(handle))) throw new Error('沒有取得資料夾的存取權限');
      return ProjectStore.open(handle);
    });

  const startCreate = async () => {
    setError('');
    try {
      const dir = await pickFolder();
      if (dir) {
        setCreating(dir);
        setNewName(dir.name);
      }
    } catch (e) {
      setError(`發生錯誤：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const confirmCreate = () => run(() => ProjectStore.create(creating!, newName.trim() || creating!.name));

  const removeRecent = async (handle: FileSystemDirectoryHandle) => {
    await forgetProject(handle);
    setRecent(await getRecentProjects());
  };

  if (!fsSupported) {
    return (
      <div className="welcome">
        <div className="welcome-panel">
          <h1>VN Script Editor</h1>
          <p className="welcome-error">這個瀏覽器不能讀寫電腦裡的資料夾，請改用 Edge 或 Chrome 開啟。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="welcome">
      <div className="welcome-panel">
        <h1>VN Script Editor</h1>
        <p className="welcome-sub">視覺小說劇本編輯器</p>

        {creating ? (
          <div className="welcome-create">
            <div className="welcome-label">在「{creating.name}」資料夾建立新專案</div>
            <input
              autoFocus
              value={newName}
              placeholder="專案名稱"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && confirmCreate()}
            />
            <div className="welcome-actions">
              <button className="primary" disabled={busy} onClick={confirmCreate}>
                建立
              </button>
              <button disabled={busy} onClick={() => setCreating(null)}>
                取消
              </button>
            </div>
          </div>
        ) : (
          <div className="welcome-actions">
            <button className="primary" disabled={busy} onClick={openFolder}>
              📂 開啟專案資料夾
            </button>
            <button disabled={busy} onClick={startCreate}>
              ＋ 建立新專案
            </button>
          </div>
        )}
        {!creating && <p className="welcome-hint">建立新專案時，請選擇（或在選擇視窗裡新建）一個空的資料夾。</p>}

        {error && <p className="welcome-error">{error}</p>}

        {recent.length > 0 && !creating && (
          <div className="welcome-recent">
            <div className="welcome-label">最近的專案</div>
            {recent.map((r) => (
              <div key={r.name + r.handle.name} className="welcome-recent-row">
                <button className="link" disabled={busy} onClick={() => openRecent(r.handle)}>
                  {r.name}
                </button>
                <span className="welcome-folder">{r.handle.name}</span>
                <button className="icon-btn" title="從清單移除" onClick={() => removeRecent(r.handle)}>
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
