import { errorText } from '../hooks';
import { useEffect, useState } from 'react';
import { getSettings } from '../settings';
import Icon from './Icon';
import {
  ProjectData,
  ProjectStore,
  assertProject,
  baseName,
  joinPath,
  forgetProject,
  getRecentProjects,
  openRecent as allowRecent,
  pickFolder,
  rememberProject,
  sanitizeName,
} from '../projectFiles';

type Recent = { name: string; path: string };

let triedLastProject = false;
type Opened = { store: ProjectStore; data: ProjectData };

export default function WelcomeScreen({ onOpen, startInCreateMode = false }: {
  onOpen: (store: ProjectStore, data: ProjectData) => void;
  startInCreateMode?: boolean;
}) {
  const [recent, setRecent] = useState<Recent[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  useEffect(() => {
    const first = !triedLastProject;
    triedLastProject = true;
    getRecentProjects()
      .then((list) => {
        setRecent(list);
        if (first && window.api.isFirstWindow && !startInCreateMode && getSettings().openLastProject && list[0]) {
          void openRecent(list[0].path);
        }
      })
      .catch(() => setRecent([]));
    if (startInCreateMode) startCreate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
      setError(`發生錯誤：${errorText(e)}`);
    } finally {
      setBusy(false);
    }
  };
  const openFolder = () =>
    run(async () => {
      const dir = await pickFolder();
      if (!dir) return null;
      await assertProject(dir);
      return (await window.api.claimProject(dir)) ? ProjectStore.open(dir) : null;
    });
  const openRecent = (path: string) =>
    run(async () => {
      await allowRecent(path);
      await assertProject(path);
      if (!(await window.api.claimProject(path))) return null; // 已經在別的視窗開著
      return ProjectStore.open(path);
    });
  const importPack = () =>
    run(async () => {
      const root = await window.api.unpackProject();
      return root && (await window.api.claimProject(root)) ? ProjectStore.open(root) : null;
    });
  const startCreate = async () => {
    setError('');
    try {
      const dir = await pickFolder();
      if (dir) {
        setCreating(dir);
        setNewName('');
      }
    } catch (e) {
      setError(`發生錯誤：${errorText(e)}`);
    }
  };
  const newFolderName = newName.trim() ? sanitizeName(newName.trim()) : '';
  const confirmCreate = () =>
    run(async () => {
      const name = newName.trim();
      if (!name) throw new Error('請輸入專案名稱');
      const root = joinPath(creating!, newFolderName);
      if (await window.api.exists(root)) {
        throw new Error(`「${baseName(creating!)}」裡已經有「${newFolderName}」這個資料夾，請換一個名稱`);
      }
      await window.api.claimProject(root);
      return ProjectStore.create(root, name);
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
            <div className="welcome-label">在「{baseName(creating)}」裡建立新專案</div>
            <input
              autoFocus
              value={newName}
              placeholder="專案名稱"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && confirmCreate()}
            />
            <div className="welcome-hint">會新增資料夾：{joinPath(creating, newFolderName || '（專案名稱）').replace(/\//g, '\\')}</div>
            <div className="welcome-actions">
              <button className="primary" disabled={busy} onClick={confirmCreate}>建立</button>
              <button disabled={busy} onClick={() => setCreating(null)}>取消</button>
            </div>
          </div>
        ) : (
          <div className="welcome-actions">
            <button className="primary" disabled={busy} onClick={openFolder}>
              <Icon icon="folder-opened" /> 開啟專案資料夾
            </button>
            <button disabled={busy} onClick={startCreate}>＋ 建立新專案</button>
            <button disabled={busy} onClick={importPack} title="開啟別人打包給你的專案（.vnpack）：選好要放在哪裡，會解壓成一個專案資料夾">
              <Icon icon="export" /> 匯入專案…
            </button>
          </div>
        )}
        {!creating && <p className="welcome-hint">建立新專案時，先選要放在哪裡、再取名字，會在那裡新增一個同名的專案資料夾。</p>}
        {error && <p className="welcome-error">{error}</p>}
        {recent.length > 0 && !creating && (
          <div className="welcome-recent">
            <div className="welcome-label">最近的專案</div>
            {recent.map((r) => (
              <div key={r.path} className="welcome-recent-row">
                <button className="link" disabled={busy} onClick={() => openRecent(r.path)}>{r.name}</button>
                <span className="welcome-folder">{r.path}</span>
                <button className="icon-btn" title="從清單移除" onClick={() => removeRecent(r.path)}>×</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
