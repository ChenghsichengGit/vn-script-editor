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
import { ProjectData, ProjectStore } from './projectFiles';

const emptyCards: Record<CardSectionId, Card[]> = { characters: [], world: [], commands: [] };

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
export interface FileOps {
  add: () => void;
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
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
  const [files, setFiles] = useState<Record<string, { name: string }>>({});
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
  const latest = useRef({ project, files, contents, cards, dirty });
  latest.current = { project, files, contents, cards, dirty };

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
          if (files[id]) await project.store.saveFile(id, { name: files[id].name, content: contents[id] ?? '' });
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

  // 還有沒存的東西時關閉視窗，瀏覽器會先問一下
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (latest.current.dirty.size > 0) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
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
    setFiles(Object.fromEntries(ids.map((id) => [id, { name: data.files[id].name }])));
    setContents(Object.fromEntries(ids.map((id) => [id, data.files[id].content])));
    setCards(data.cards);
    setOpenTabs(ids.slice(0, 1));
    setActiveTab(ids[0] ?? null);
    setDirty(new Set());
    setSaveState('saved');
    setProject({ store, name: data.name });
  };

  // 關閉專案：先把還沒存的存完，再回到開始畫面
  const closeProject = async () => {
    await flushRef.current();
    if (latest.current.dirty.size > 0 && !window.confirm('有內容存檔失敗，確定要關閉專案嗎？')) return;
    setProject(null);
    setFiles({});
    setContents({});
    setCards(emptyCards);
    setOpenTabs([]);
    setActiveTab(null);
    setDirty(new Set());
  };

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

  // ── 設定卡 ──────────────────────────────

  const findCard = (section: CardSectionId, id: string) => cards[section].find((c) => c.id === id);

  const cardOps: CardOps = {
    open: (section, id) => openTab(cardTabId(section, id)),
    add: (section) => {
      const card: Card = { id: Date.now().toString(36), name: sectionMeta[section].newName!, fields: [], detail: '' };
      setCards((all) => ({ ...all, [section]: [...all[section], card] }));
      markDirty(cardTabId(section, card.id));
      openTab(cardTabId(section, card.id));
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
    add: () => {
      // 預設檔名被占用就加編號：新劇本 2.vns、新劇本 3.vns…
      const taken = new Set(Object.values(files).map((f) => f.name));
      let name = '新劇本.vns';
      for (let n = 2; taken.has(name); n++) name = `新劇本 ${n}.vns`;
      const id = Date.now().toString(36);
      setFiles((all) => ({ ...all, [id]: { name } }));
      setContents((c) => ({ ...c, [id]: '' }));
      markDirty(fileKey(id));
      openTab(id);
    },
    rename: (id, name) => {
      const trimmed = name.trim();
      // 空白或和別的檔案同名就不改
      if (!trimmed || Object.entries(files).some(([otherId, f]) => otherId !== id && f.name === trimmed)) return;
      setFiles((all) => ({ ...all, [id]: { name: trimmed } }));
      markDirty(fileKey(id));
    },
    remove: (id) => {
      setFiles((all) => Object.fromEntries(Object.entries(all).filter(([fileId]) => fileId !== id)));
      setContents((c) => Object.fromEntries(Object.entries(c).filter(([fileId]) => fileId !== id)));
      unmarkDirty(fileKey(id));
      project?.store.deleteFile(id).catch(reportError);
      if (openTabs.includes(id)) closeTab(id);
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

  if (!project) return <WelcomeScreen onOpen={loadProject} />;

  const saveLabel =
    saveState === 'error' ? `⚠ 存檔失敗：${saveError}` : saveState === 'saving' ? '儲存中…' : dirty.size > 0 ? '尚未儲存' : '已儲存';

  return (
    <div className="app">
      <div className="main">
        <ActivityBar active={sidebarVisible ? layout.open : []} onToggle={toggleSection} onCloseProject={closeProject} />
        {sidebarVisible && layout.open.length > 0 && (
          <>
            <Sidebar
              layout={layout}
              onLayoutChange={(patch) => setLayout((l) => ({ ...l, ...patch }))}
              files={files}
              fileOps={fileOps}
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
