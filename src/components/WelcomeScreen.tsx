import { useEffect, useState } from 'react';
import { getSettings } from '../settings';
import Icon from './Icon';
import {
  ProjectData,
  ProjectStore,
  baseName,
  forgetProject,
  getRecentProjects,
  openRecent as allowRecent,
  pickFolder,
  pickProjectFile,
  rememberProject,
} from '../projectFiles';

type Recent = { name: string; path: string };

// 「啟動時開啟上次的專案」只在程式剛打開時做一次；之後關閉專案回到這個畫面時不會又自動打開
let triedLastProject = false;
type Opened = { store: ProjectStore; data: ProjectData };

// 開始畫面：開啟專案（選 .vnsp）、建立新專案、最近開過的專案
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
    const first = !triedLastProject;
    triedLastProject = true;
    void (async () => {
      // 雙擊專案檔（.vnsp）開的視窗：直接打開那個專案（主程式已經允許存取），不再開上次的專案
      const fromFile = first ? await window.api.takeInitialProject().catch(() => null) : null;
      if (fromFile) void openPath(fromFile);
      try {
        const list = await getRecentProjects();
        setRecent(list);
        // 最近的專案清單第一個就是上次開的
        // 只有程式的第一個視窗會這樣做；之後開的新視窗都從開始畫面開始
        if (!fromFile && first && window.api.isFirstWindow && !startInCreateMode && getSettings().openLastProject && list[0]) {
          void openRecent(list[0].path);
        }
      } catch {
        setRecent([]);
      }
    })();
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

  // 開啟專案：選專案檔（.vnsp，舊專案可以選 project.json），打開它所在的資料夾
  const openProjectFile = () =>
    run(async () => {
      const dir = await pickProjectFile();
      // 已經在別的視窗開著：跳到那個視窗，這裡不開
      return dir && (await window.api.claimProject(dir)) ? ProjectStore.open(dir) : null;
    });

  const openRecent = (path: string) =>
    run(async () => {
      // 先請主程式允許存取這個資料夾（資料夾不見了會丟錯）
      await allowRecent(path);
      if (!(await window.api.claimProject(path))) return null; // 已經在別的視窗開著
      return ProjectStore.open(path);
    });

  // 雙擊專案檔來的：資料夾已經允許存取，不用經過「最近的專案」
  const openPath = (path: string) =>
    run(async () => ((await window.api.claimProject(path)) ? ProjectStore.open(path) : null));

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

  const confirmCreate = () =>
    run(async () => {
      await window.api.claimProject(creating!);
      return ProjectStore.create(creating!, newName.trim() || baseName(creating!));
    });

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
            <button className="primary" disabled={busy} onClick={openProjectFile} title="選專案檔（.vnsp）；舊專案可以選資料夾裡的 project.json">
              <Icon icon="folder-opened" /> 開啟專案
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
