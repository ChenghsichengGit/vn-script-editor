import { useEffect, useState } from 'react';
import {
  ProjectData,
  ProjectStore,
  baseName,
  forgetProject,
  getRecentProjects,
  openRecent as allowRecent,
  pickFolder,
  rememberProject,
} from '../projectFiles';

type Recent = { name: string; path: string };
type Opened = { store: ProjectStore; data: ProjectData };

// 開始畫面：開啟專案資料夾、建立新專案、最近開過的專案
// startInCreateMode：從選單「新增專案…」進來時，一開始就跳出資料夾選擇視窗
export default function WelcomeScreen({
  onOpen,
  startInCreateMode = false,
}: {
  onOpen: (store: ProjectStore, data: ProjectData) => void;
  startInCreateMode?: boolean;
}) {
  const [recent, setRecent] = useState<Recent[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // 建立新專案的第二步：已經選好資料夾，等使用者輸入專案名稱
  const [creating, setCreating] = useState<string | null>(null);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    getRecentProjects().then(setRecent).catch(() => setRecent([]));
    if (startInCreateMode) startCreate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 共用流程：執行開啟／建立 → 成功就記到「最近的專案」並進入編輯器，失敗就顯示錯誤
  const run = async (task: () => Promise<Opened | null>) => {
    setError('');
    setBusy(true);
    try {
      const opened = await task();
      if (opened) {
        await rememberProject(opened.data.name, opened.store.root);
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

  const openRecent = (path: string) =>
    run(async () => {
      // 先請主程序允許存取這個資料夾（資料夾不見了會丟錯）
      await allowRecent(path);
      return ProjectStore.open(path);
    });

  const startCreate = async () => {
    setError('');
    try {
      const dir = await pickFolder();
      if (dir) {
        setCreating(dir);
        setNewName(baseName(dir));
      }
    } catch (e) {
      setError(`發生錯誤：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const confirmCreate = () => run(() => ProjectStore.create(creating!, newName.trim() || baseName(creating!)));

  const removeRecent = async (path: string) => {
    await forgetProject(path);
    setRecent(await getRecentProjects());
  };

  return (
    <div className="welcome">
      <div className="welcome-panel">
        <h1>VN Script Editor</h1>
        <p className="welcome-sub">視覺小說劇本編輯器</p>

        {creating ? (
          <div className="welcome-create">
            <div className="welcome-label">在「{baseName(creating)}」資料夾建立新專案</div>
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
              <div key={r.path} className="welcome-recent-row">
                <button className="link" disabled={busy} onClick={() => openRecent(r.path)}>
                  {r.name}
                </button>
                <span className="welcome-folder">{r.path}</span>
                <button className="icon-btn" title="從清單移除" onClick={() => removeRecent(r.path)}>
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
