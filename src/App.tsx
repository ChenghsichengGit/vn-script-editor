import { useEffect, useRef, useState } from 'react';
import ActivityBar from './components/ActivityBar';
import Sidebar from './components/Sidebar';
import EditorTabs from './components/EditorTabs';
import ScriptEditor from './components/ScriptEditor';
import CardEditor from './components/CardEditor';
import StatusBar from './components/StatusBar';
import WelcomeScreen from './components/WelcomeScreen';
import { Card, CardOps, CardSectionId, SectionId, cardTabId, parseCardTab } from './model';
import { sectionMeta, sectionOrder } from './sampleData';
import {
  ProjectData,
  ProjectStore,
  folderBase,
  isInFolder,
  openRecent,
  parentFolder,
  pickFolder,
  rememberProject,
  sanitizeName,
  validateName,
  withScriptExt,
} from './projectFiles';

const emptyCards: Record<CardSectionId, Card[]> = { characters: [], world: [], commands: [] };
const emptyFolders: Record<SectionId, string[]> = { files: [], characters: [], world: [], commands: [] };

// 「還沒存檔」清單裡的代號：劇本是 file:id，設定卡直接用分頁 id（card:區塊:id）
const fileKey = (id: string) => `file:${id}`;
const SAVE_DELAY = 1000; // 停止輸入多久後自動存檔（毫秒）

// 側邊欄的版面（開了哪些區塊、各自多高、多寬），會記在瀏覽器裡
export interface Layout {
  open: SectionId[];
  sizes: Partial<Record<SectionId, number>>;
  width: number;
}
const LAYOUT_KEY = 'vn-editor-layout';
const defaultLayout: Layout = { open: [...sectionOrder], sizes: {}, width: 300 };

function loadLayout(): Layout {
  try {
    return { ...defaultLayout, ...JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? '{}') };
  } catch {
    return defaultLayout;
  }
}

// 劇本檔案的操作：由 App 實作，Sidebar 只負責呼叫
// add / rename 回傳錯誤訊息（名稱不能用或重複）；成功回傳 null
export interface FileOps {
  add: (folder: string, name: string) => string | null;
  rename: (id: string, name: string) => string | null;
  remove: (id: string) => void;
}

// 資料夾的操作（四個區塊共用）：立即寫到硬碟，不經過 dirty／自動存檔
// 名稱的錯誤用回傳值告訴輸入框；硬碟操作失敗則已經 alert 過，回傳 null
export interface FolderOps {
  create: (section: SectionId, parent: string, name: string) => Promise<string | null>;
  rename: (section: SectionId, folder: string, name: string) => Promise<string | null>;
  remove: (section: SectionId, folder: string) => Promise<void>;
}

// App 是「總管」：所有狀態都存在這裡，子元件只負責顯示、把使用者的操作回報上來
export default function App() {
  const [layout, setLayout] = useState<Layout>(loadLayout);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [project, setProject] = useState<{ store: ProjectStore; name: string } | null>(null); // null = 顯示開始畫面
  const [cards, setCards] = useState(emptyCards);
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [contents, setContents] = useState<Record<string, string>>({});
  // 檔案清單（只有檔名；文字內容在上面的 contents）。物件的順序就是加入的順序
  // folder = 所在子資料夾（'' = 根目錄）
  const [files, setFiles] = useState<Record<string, { name: string; folder: string }>>({});
  // 每個區塊所有的子資料夾（含空的）
  const [folders, setFolders] = useState(emptyFolders);
  const [cursor, setCursor] = useState({ line: 1, column: 1 });

  // ── 存檔 ──────────────────────────────
  // 有改動的東西記在 dirty 清單；停止輸入 1 秒後（或按 Ctrl+S）把清單裡的東西寫回資料夾

  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [saveError, setSaveError] = useState('');

  const markDirty = (key: string) => setDirty((d) => (d.has(key) ? d : new Set(d).add(key)));
  const unmarkDirty = (key: string) =>
    setDirty((d) => {
      const next = new Set(d);
      next.delete(key);
      return next;
    });

  // 存檔是非同步的，跑的時候要讀「最新」的資料，所以每次畫面更新都把目前的狀態放進 ref
  const latest = useRef({ project, files, contents, cards, dirty, openTabs, activeTab });
  latest.current = { project, files, contents, cards, dirty, openTabs, activeTab };

  const flush = async () => {
    const { project, files, contents, cards, dirty } = latest.current;
    if (!project || dirty.size === 0) return;
    const keys = [...dirty];
    // 先從清單拿掉；存檔途中又被修改的話，會再被加回來，下一輪再存
    setDirty((d) => new Set([...d].filter((k) => !keys.includes(k))));
    setSaveState('saving');
    try {
      for (const key of keys) {
        const card = parseCardTab(key);
        if (card) {
          const c = cards[card.section].find((x) => x.id === card.id);
          if (c) await project.store.saveCard(card.section, c);
        } else {
          const id = key.slice('file:'.length);
          if (files[id]) await project.store.saveFile(id, {
              name: files[id].name,
              folder: files[id].folder,
              content: contents[id] ?? '',
            });
        }
      }
      setSaveState('saved');
    } catch (e) {
      // 存失敗：把這些東西放回「還沒存」清單，狀態列顯示錯誤
      setDirty((d) => new Set([...d, ...keys]));
      setSaveState('error');
      setSaveError(e instanceof Error ? e.message : String(e));
    }
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;

  // 自動存檔：任何內容一改，計時重新開始；停下來 1 秒就存
  useEffect(() => {
    if (dirty.size === 0) return;
    const timer = setTimeout(() => flushRef.current(), SAVE_DELAY);
    return () => clearTimeout(timer);
  }, [dirty, contents, cards, files]);

  // 關閉視窗：主程序會先通知這裡，把沒存的存完（存失敗就問一下）再回報可以關了
  const closingRef = useRef(false);
  useEffect(() => {
    return window.api.onAppClosing(async () => {
      if (closingRef.current) return; // 正在存檔中，不要重複處理
      closingRef.current = true;
      try {
        await flushRef.current();
        if (latest.current.dirty.size > 0 && !window.confirm('有內容存檔失敗，確定要關閉嗎？')) return;
        window.api.readyToClose();
      } finally {
        closingRef.current = false;
      }
    });
  }, []);

  // 刪除檔案時直接呼叫，失敗就顯示在狀態列
  const reportError = (e: unknown) => {
    setSaveState('error');
    setSaveError(e instanceof Error ? e.message : String(e));
  };

  // ── 專案 ──────────────────────────────

  // 從開始畫面打開專案：把資料夾讀到的內容放進各個狀態，並打開第一個劇本
  const loadProject = (store: ProjectStore, data: ProjectData) => {
    const ids = Object.keys(data.files);
    setFiles(Object.fromEntries(ids.map((id) => [id, { name: data.files[id].name, folder: data.files[id].folder }])));
    setFolders(data.folders);
    setContents(Object.fromEntries(ids.map((id) => [id, data.files[id].content])));
    setCards(data.cards);
    setOpenTabs(ids.slice(0, 1));
    setActiveTab(ids[0] ?? null);
    setDirty(new Set());
    setSaveState('saved');
    setProject({ store, name: data.name });
  };

  // 開始畫面要不要直接進入「建立新專案」；createKey 每次加一，讓開始畫面重新建立
  const [createKey, setCreateKey] = useState(0);
  const [startInCreate, setStartInCreate] = useState(false);

  // 切換專案前：先把還沒存的存完；存失敗的話問使用者要不要放棄那些內容。回傳 true 代表可以繼續
  const flushBeforeLeave = async (question: string) => {
    await flushRef.current();
    return !(latest.current.dirty.size > 0 && !window.confirm(question));
  };

  // 關閉專案：先把還沒存的存完，再回到開始畫面
  const closeProject = async (): Promise<boolean> => {
    if (!(await flushBeforeLeave('有內容存檔失敗，確定要關閉專案嗎？'))) return false;
    setStartInCreate(false);
    setProject(null);
    setFiles({});
    setFolders(emptyFolders);
    setContents({});
    setCards(emptyCards);
    setOpenTabs([]);
    setActiveTab(null);
    setDirty(new Set());
    return true;
  };

  // 開啟專案後共用的收尾：記到「最近的專案」再載入畫面
  const openOpened = async ({ store, data }: { store: ProjectStore; data: ProjectData }) => {
    await rememberProject(data.name, store.root);
    loadProject(store, data);
  };

  // 原生選單送來的指令（用 ref 讓訂閱一次就好，執行時永遠是最新版）
  const onMenu = async (ev: MenuEvent) => {
    try {
      if (ev.type === 'close-project') {
        await closeProject();
      } else if (ev.type === 'new-project') {
        if (!(await flushBeforeLeave('有內容存檔失敗，確定要離開目前的專案嗎？'))) return;
        await closeProject();
        setStartInCreate(true);
        setCreateKey((k) => k + 1);
      } else if (ev.type === 'open-project') {
        if (!(await flushBeforeLeave('有內容存檔失敗，確定要離開目前的專案嗎？'))) return;
        const root = await pickFolder();
        if (root) await openOpened(await ProjectStore.open(root));
      } else if (ev.type === 'open-recent') {
        if (!(await flushBeforeLeave('有內容存檔失敗，確定要離開目前的專案嗎？'))) return;
        await openRecent(ev.path);
        await openOpened(await ProjectStore.open(ev.path));
      }
    } catch (e) {
      window.alert(`發生錯誤：${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const onMenuRef = useRef(onMenu);
  onMenuRef.current = onMenu;
  useEffect(() => window.api.onMenu((ev) => void onMenuRef.current(ev)), []);

  // 版面一有變動就記到瀏覽器
  useEffect(() => {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
    } catch {
      /* 存不了就算了，不影響使用 */
    }
  }, [layout]);

  // ── 側邊欄 ──────────────────────────────

  // 點活動列圖示：開／關那個區塊（可以同時開好幾個）
  const toggleSection = (id: SectionId) => {
    if (!sidebarVisible) {
      setSidebarVisible(true);
      if (!layout.open.includes(id)) setLayout({ ...layout, open: sortSections([...layout.open, id]) });
      return;
    }
    const open = layout.open.includes(id) ? layout.open.filter((s) => s !== id) : sortSections([...layout.open, id]);
    setLayout({ ...layout, open });
  };

  // Ctrl+B：收起／打開整個側邊欄；Ctrl+S：立刻存檔
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setSidebarVisible((v) => !v);
      } else if (e.ctrlKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        flushRef.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // 拖曳側邊欄右邊的線調整寬度（48 是活動列的寬度）
  const startWidthResize = (e: React.MouseEvent) => {
    e.preventDefault();
    dragWith((ev) => setLayout((l) => ({ ...l, width: Math.min(700, Math.max(180, ev.clientX - 48)) })));
  };

  // ── 分頁 ──────────────────────────────

  const openTab = (id: string) => {
    if (!openTabs.includes(id)) setOpenTabs((tabs) => [...tabs, id]);
    setActiveTab(id);
  };

  const closeTab = (id: string) => {
    const next = openTabs.filter((t) => t !== id);
    setOpenTabs(next);
    if (activeTab === id) setActiveTab(next[next.length - 1] ?? null);
  };

  // 一次關掉好幾個分頁（刪除資料夾時用）。在 await 之後呼叫，所以讀 ref 裡最新的分頁狀態
  const closeTabs = (ids: string[]) => {
    const gone = new Set(ids);
    const { openTabs: tabs, activeTab: active } = latest.current;
    const next = tabs.filter((t) => !gone.has(t));
    setOpenTabs(next);
    if (active && gone.has(active)) setActiveTab(next[next.length - 1] ?? null);
  };

  // ── 名稱檢查 ──────────────────────────────

  // 某區塊某個資料夾裡已被占用的名稱（小寫）：子資料夾 + 檔案／卡片（卡片的檔名 = 名稱 + .md）
  // except 用來排除「正在改名的自己」
  const takenNames = (section: SectionId, folder: string, except: { id?: string; folder?: string } = {}) => {
    const taken = new Set<string>();
    for (const f of folders[section]) {
      if (parentFolder(f) === folder && f !== except.folder) taken.add(folderBase(f).toLowerCase());
    }
    if (section === 'files') {
      for (const [id, f] of Object.entries(files)) {
        if (f.folder === folder && id !== except.id) taken.add(f.name.toLowerCase());
      }
    } else {
      for (const c of cards[section]) {
        if ((c.folder ?? '') === folder && c.id !== except.id) taken.add((sanitizeName(c.name) + '.md').toLowerCase());
      }
    }
    return taken;
  };

  // 檢查「檔名／資料夾名」candidate 能不能用；raw 是使用者打的原文（用來檢查非法字元）
  const nameError = (
    section: SectionId,
    folder: string,
    raw: string,
    candidate: string,
    dupMessage: string,
    except?: { id?: string; folder?: string },
  ) => validateName(raw) ?? (takenNames(section, folder, except).has(candidate.toLowerCase()) ? dupMessage : null);

  // ── 設定卡 ──────────────────────────────

  const findCard = (section: CardSectionId, id: string) => cards[section].find((c) => c.id === id);

  const cardOps: CardOps = {
    open: (section, id) => openTab(cardTabId(section, id)),
    add: (section, folder, rawName) => {
      const name = rawName.trim();
      const err = nameError(section, folder, name, name + '.md', '已經有同名的項目');
      if (err) return err;
      const card: Card = { id: Date.now().toString(36), name, fields: [], detail: '', folder };
      setCards((all) => ({ ...all, [section]: [...all[section], card] }));
      markDirty(cardTabId(section, card.id));
      openTab(cardTabId(section, card.id));
      return null;
    },
    rename: (section, id, rawName) => {
      const card = findCard(section, id);
      const name = rawName.trim();
      if (!card || name === card.name) return null;
      const err = nameError(section, card.folder ?? '', name, name + '.md', '已經有同名的項目', { id });
      if (err) return err;
      cardOps.update(section, id, { name });
      return null;
    },
    update: (section, id, patch) => {
      setCards((all) => ({ ...all, [section]: all[section].map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
      markDirty(cardTabId(section, id));
    },
    remove: (section, id) => {
      setCards((all) => ({ ...all, [section]: all[section].filter((c) => c.id !== id) }));
      unmarkDirty(cardTabId(section, id));
      project?.store.deleteCard(section, id).catch(reportError);
      if (openTabs.includes(cardTabId(section, id))) closeTab(cardTabId(section, id));
    },
  };

  // ── 劇本檔案 ──────────────────────────────

  const fileOps: FileOps = {
    add: (folder, rawName) => {
      // 使用者打的就是完整檔名；沒有副檔名就補 .vns
      const typed = rawName.trim();
      const name = withScriptExt(typed);
      const err = nameError('files', folder, typed, name, '已經有同名的檔案');
      if (err) return err;
      const id = Date.now().toString(36);
      setFiles((all) => ({ ...all, [id]: { name, folder } }));
      setContents((c) => ({ ...c, [id]: '' }));
      markDirty(fileKey(id));
      openTab(id);
      return null;
    },
    rename: (id, rawName) => {
      const file = files[id];
      const typed = rawName.trim();
      if (!file) return null;
      const name = withScriptExt(typed);
      if (name === file.name) return null;
      const err = nameError('files', file.folder, typed, name, '已經有同名的檔案', { id });
      if (err) return err;
      setFiles((all) => ({ ...all, [id]: { ...all[id], name } }));
      markDirty(fileKey(id));
      return null;
    },
    remove: (id) => {
      setFiles((all) => Object.fromEntries(Object.entries(all).filter(([fileId]) => fileId !== id)));
      setContents((c) => Object.fromEntries(Object.entries(c).filter(([fileId]) => fileId !== id)));
      unmarkDirty(fileKey(id));
      project?.store.deleteFile(id).catch(reportError);
      if (openTabs.includes(id)) closeTab(id);
    },
  };

  // ── 資料夾 ──────────────────────────────

  const showFolderError = (action: string, e: unknown) =>
    window.alert(`${action}失敗：${e instanceof Error ? e.message : String(e)}`);

  const folderOps: FolderOps = {
    create: async (section, parent, rawName) => {
      const name = rawName.trim();
      const err = nameError(section, parent, name, name, '已經有同名的項目');
      if (err) return err;
      try {
        const rel = await latest.current.project!.store.createFolder(section, parent, name);
        setFolders((f) => ({ ...f, [section]: [...f[section], rel] }));
      } catch (e) {
        showFolderError('新增資料夾', e);
      }
      return null;
    },
    rename: async (section, folder, rawName) => {
      const name = rawName.trim();
      if (name === folderBase(folder)) return null;
      const err = nameError(section, parentFolder(folder), name, name, '已經有同名的項目', { folder });
      if (err) return err;
      // 先把還沒存的內容存完，才不會有存檔還在用舊路徑
      await flushRef.current();
      try {
        const newRel = await latest.current.project!.store.renameFolder(section, folder, name);
        // 資料夾本身和裡面每個檔案／卡片的路徑都換成新的前綴
        const remap = (p: string) => (isInFolder(p, folder) ? newRel + p.slice(folder.length) : p);
        setFolders((f) => ({ ...f, [section]: f[section].map(remap) }));
        if (section === 'files') {
          setFiles((all) => Object.fromEntries(Object.entries(all).map(([id, f]) => [id, { ...f, folder: remap(f.folder) }])));
        } else {
          setCards((all) => ({
            ...all,
            [section]: all[section].map((c) => ({ ...c, folder: remap(c.folder ?? '') })),
          }));
        }
      } catch (e) {
        showFolderError('重新命名資料夾', e);
      }
      return null;
    },
    remove: async (section, folder) => {
      // 這個資料夾（含各層子資料夾）裡的所有檔案／卡片
      const inside =
        section === 'files'
          ? Object.keys(files).filter((id) => isInFolder(files[id].folder, folder))
          : cards[section].filter((c) => isInFolder(c.folder ?? '', folder)).map((c) => c.id);
      const keys = inside.map((id) => (section === 'files' ? fileKey(id) : cardTabId(section, id)));
      const tabIds = inside.map((id) => (section === 'files' ? id : cardTabId(section, id)));
      const wasDirty = keys.filter((k) => dirty.has(k));

      // 先清掉它們的「還沒存」記號，避免刪除途中自動存檔又把檔案寫回去
      setDirty((d) => new Set([...d].filter((k) => !keys.includes(k))));
      try {
        await latest.current.project!.store.deleteFolder(section, folder);
      } catch (e) {
        setDirty((d) => new Set([...d, ...wasDirty]));
        showFolderError('刪除資料夾', e);
        return;
      }
      setFolders((f) => ({ ...f, [section]: f[section].filter((p) => !isInFolder(p, folder)) }));
      if (section === 'files') {
        const gone = new Set(inside);
        setFiles((all) => Object.fromEntries(Object.entries(all).filter(([id]) => !gone.has(id))));
        setContents((c) => Object.fromEntries(Object.entries(c).filter(([id]) => !gone.has(id))));
      } else {
        setCards((all) => ({ ...all, [section]: all[section].filter((c) => !inside.includes(c.id)) }));
      }
      closeTabs(tabIds);
    },
  };

  // ── 決定每個分頁的標題、編輯區要顯示什麼、狀態列寫什麼 ─────────

  const tabLabel = (tabId: string) => {
    const ref = parseCardTab(tabId);
    if (!ref) return files[tabId]?.name ?? '';
    return `${sectionMeta[ref.section].icon} ${findCard(ref.section, ref.id)?.name || '（未命名）'}`;
  };

  const activeCardRef = activeTab ? parseCardTab(activeTab) : null;
  const activeCard = activeCardRef ? findCard(activeCardRef.section, activeCardRef.id) : undefined;

  let content: React.ReactNode = <div className="empty">從左側開啟劇本或設定卡</div>;
  let status = { left: '沒有開啟的檔案', right: '' };

  if (activeCardRef && activeCard) {
    // key：換成別張卡時，整個編輯頁重新建立，詳細內容編輯器才會載入新卡的內容
    content = (
      <CardEditor
        key={activeTab}
        card={activeCard}
        onChange={(patch) => cardOps.update(activeCardRef.section, activeCard.id, patch)}
      />
    );
    status = { left: `${sectionMeta[activeCardRef.section].title}／${activeCard.name}`, right: `詳細內容 ${countChars(activeCard.detail)} 字` };
  } else if (activeTab && !activeCardRef && files[activeTab]) {
    content = (
      <ScriptEditor
        fileId={activeTab}
        initialText={contents[activeTab]}
        onChange={(text) => {
          setContents((c) => ({ ...c, [activeTab]: text }));
          markDirty(fileKey(activeTab));
        }}
        onCursor={setCursor}
      />
    );
    status = {
      left: files[activeTab]?.name ?? '',
      right: `行 ${cursor.line}，欄 ${cursor.column}　｜　字數 ${countChars(contents[activeTab])}`,
    };
  }

  if (!project) return <WelcomeScreen key={createKey} startInCreateMode={startInCreate} onOpen={loadProject} />;

  const saveLabel =
    saveState === 'error' ? `⚠ 存檔失敗：${saveError}` : saveState === 'saving' ? '儲存中…' : dirty.size > 0 ? '尚未儲存' : '已儲存';

  return (
    <div className="app">
      <div className="main">
        <ActivityBar active={sidebarVisible ? layout.open : []} onToggle={toggleSection} />
        {sidebarVisible && layout.open.length > 0 && (
          <>
            <Sidebar
              layout={layout}
              onLayoutChange={(patch) => setLayout((l) => ({ ...l, ...patch }))}
              files={files}
              fileOps={fileOps}
              folders={folders}
              folderOps={folderOps}
              cards={cards}
              cardOps={cardOps}
              activeTab={activeTab}
              onOpenFile={openTab}
            />
            <div className="splitter" onMouseDown={startWidthResize} />
          </>
        )}
        <EditorTabs
          tabs={openTabs.map((id) => ({
            id,
            label: tabLabel(id),
            dirty: dirty.has(parseCardTab(id) ? id : fileKey(id)),
          }))}
          activeTab={activeTab}
          onSelect={setActiveTab}
          onClose={closeTab}
        >
          {content}
        </EditorTabs>
      </div>
      <StatusBar
        left={`📁 ${project.name}　｜　${status.left}`}
        right={status.right ? `${status.right}　｜　${saveLabel}` : saveLabel}
      />
    </div>
  );
}

// 區塊永遠照固定順序排（檔案 → 角色 → 世界觀 → 指令）
const sortSections = (ids: SectionId[]) => sectionOrder.filter((s) => ids.includes(s));

// 字數：不算空白和換行
const countChars = (text: string) => text.replace(/\s/g, '').length.toLocaleString();

// 拖曳的共用寫法：按下後跟著滑鼠移動，放開就停止
export function dragWith(onMove: (ev: MouseEvent) => void) {
  const onUp = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    document.body.classList.remove('dragging');
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  document.body.classList.add('dragging');
}
