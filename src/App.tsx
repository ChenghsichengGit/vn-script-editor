import { useEffect, useMemo, useRef, useState } from 'react';
import ActivityBar from './components/ActivityBar';
import Sidebar from './components/Sidebar';
import FloatLayer from './components/FloatLayer';
import { MoveItem, folderKey, remapFolderKeys } from './components/SectionPanel';
import EditorDock, { EditorDockHandle } from './components/EditorDock';
import StatusBar from './components/StatusBar';
import WelcomeScreen from './components/WelcomeScreen';
import SettingsDialog from './components/SettingsDialog';
import { getSettings, updateSettings, useSettings } from './settings';
import {
  Card,
  CardOps,
  CardSectionId,
  ItemOrder,
  SchemaEdit,
  FieldRemoval,
  Schemas,
  SectionId,
  applySchema,
  cardTabId,
  defaultSchema,
  defaultSchemas,
  parseCardTab,
  folderOrderKey,
  perSection,
  SAVE_ALL_EVENT,
} from './model';
import SchemaDialog from './components/SchemaDialog';
import CloseDialog from './components/CloseDialog';
import UpdateDialog from './components/UpdateDialog';
import HelpDialog, { HelpTopic } from './components/HelpDialog';
import Tooltip from './components/Tooltip';
import Icon from './components/Icon';
import QuickPick, { QuickPickItem } from './components/QuickPick';
import ProblemsPanel, { ProblemGroup } from './components/ProblemsPanel';
import BottomPanel, { PanelTab } from './components/BottomPanel';
import SearchPanel, { SearchState, emptySearch } from './components/SearchPanel';
import { SearchGroup, SearchHit, SearchMatch, SearchTarget, replaceAllInText, replaceOneInText } from './projectSearch';
import { playEdit, waitForEditor } from './aiPlayback';
import monaco from './monaco';
import type { DiskChanges } from './projectFiles';
import { AI_GUIDE_NAME, buildAiGuide } from './aiGuide';
import { buildProjectExport, exportFileName } from './exportProject';
import { FIXED_COMMAND_FIELDS, checkScript, migrateFormatField, revealInEditor, setScriptData } from './scriptLanguage';
import { fileIcon } from './sampleData';
import { SectionDef, SectionRemoval, cardSectionIds, getCardSections, sectionMeta, sectionOrder, setCardSections } from './sections';
import SectionsDialog from './components/SectionsDialog';
import {
  FLOAT_DEFAULT_H,
  FLOAT_DEFAULT_W,
  FLOAT_MIN_H,
  FLOAT_MIN_W,
  LAYOUT_KEY,
  Layout,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  Side,
  dockSection,
  floatSection,
  loadLayout,
  reconcileLayout,
} from './layout';
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

// 每個區塊一份空的卡片／資料夾清單（區塊是專案自訂的，照目前的區塊清單做）
const emptyCards = (): Record<CardSectionId, Card[]> => perSection(cardSectionIds(), () => [] as Card[]);
const emptyFolders = (): Record<SectionId, string[]> => ({ files: [], ...perSection(cardSectionIds(), () => [] as string[]) });

// 「還沒存檔」清單裡的代號：劇本是 file:id，設定卡直接用分頁 id（card:區塊:id）
const fileKey = (id: string) => `file:${id}`;
const SAVE_DELAY = 1000; // 停止輸入多久後自動存檔（毫秒）

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
  // 左側欄整排收起來了沒（Ctrl+B 或活動列最下面的按鈕）；記在版面裡，下次開啟維持原樣
  const leftVisible = !layout.leftCollapsed;
  const setLeftVisible = (v: boolean | ((visible: boolean) => boolean)) =>
    setLayout((l) => ({ ...l, leftCollapsed: !(typeof v === 'function' ? v(!l.leftCollapsed) : v) }));
  const settings = useSettings();
  const [showSettings, setShowSettings] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set()); // 被摺起來的資料夾（所有區塊共用，key 含區塊名）
  const [project, setProject] = useState<{ store: ProjectStore; name: string } | null>(null); // null = 顯示開始畫面
  const [cards, setCards] = useState(emptyCards);
  // 開了哪些分頁、分在哪些群組，都交給編輯區的 dockview 管（見 EditorDock）；App 只記「現在作用中的分頁」
  // 它決定狀態列顯示什麼、側邊欄反白哪一項，由 EditorDock 在作用中的面板改變時通知
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const dockRef = useRef<EditorDockHandle>(null);
  const [contents, setContents] = useState<Record<string, string>>({});
  // 檔案清單（只有檔名；文字內容在上面的 contents）。物件的順序就是加入的順序
  // folder = 所在子資料夾（'' = 根目錄）
  const [files, setFiles] = useState<Record<string, { name: string; folder: string }>>({});
  // 每個區塊所有的子資料夾（含空的）
  const [folders, setFolders] = useState(emptyFolders);
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  // 角色／世界觀／指令的欄位範本（存在 project.json），以及正在編輯哪一個區塊的範本
  const [schemas, setSchemas] = useState<Schemas>(() => defaultSchemas(cardSectionIds()));
  // 這個專案的設定卡區塊清單（真正給畫面讀的在 sections.ts；這個 state 讓清單換掉時畫面跟著重畫）
  const [, setSections] = useState<SectionDef[]>([]);
  const [schemaDialog, setSchemaDialog] = useState<CardSectionId | null>(null);
  // 「區塊設定」視窗開著沒
  const [sectionsDialog, setSectionsDialog] = useState(false);
  // 左側清單的自訂順序（存在 project.json）
  const [order, setOrder] = useState<ItemOrder>({});
  // 卡片或範本一變，就把最新的指令清單和參數可選值交給劇本編輯器的補齊功能
  useEffect(() => setScriptData(cards, schemas), [cards, schemas]);

  // 問題面板：檢查所有 .vns 劇本（含沒打開的）。打字時不要每個字都重算，停 0.3 秒才算
  // 放在 setScriptData 後面：指令清單更新完才檢查
  const [problems, setProblems] = useState<ProblemGroup[]>([]);
  useEffect(() => {
    const timer = setTimeout(() => {
      const groups: ProblemGroup[] = [];
      for (const [fileId, f] of Object.entries(files)) {
        if (!/\.vns$/i.test(f.name)) continue;
        const lines = (contents[fileId] ?? '').split(/\r?\n/);
        const found = checkScript(lines);
        if (found.length > 0) groups.push({ fileId, name: f.name, folder: f.folder, lines, problems: found });
      }
      groups.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
      setProblems(groups);
    }, 300);
    return () => clearTimeout(timer);
  }, [files, contents, cards, schemas]);
  const problemCount = problems.reduce((n, g) => n + g.problems.length, 0);

  // 專案資料夾最上層的「AI說明.md」：指令或欄位設定一改，停 2 秒就重新產生（內容一樣就不寫）
  const guideRef = useRef<{ root: string; text: string } | null>(null);
  useEffect(() => {
    if (!project) return;
    const timer = setTimeout(() => {
      const text = buildAiGuide(project.name, cards, schemas);
      if (guideRef.current?.root === project.store.root && guideRef.current.text === text) return;
      guideRef.current = { root: project.store.root, text };
      window.api.writeText(`${project.store.root}/${AI_GUIDE_NAME}`, text).catch(reportError);
    }, 2000);
    return () => clearTimeout(timer);
  }, [project, cards.commands, schemas]);

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
  const latest = useRef({ project, files, contents, cards, dirty, activeTab });
  latest.current = { project, files, contents, cards, dirty, activeTab };

  // 存完回傳 null；有東西存失敗回傳錯誤訊息（那些東西會放回「還沒存」清單）
  // only = 只存這幾個（關分頁時只存那一個）；沒給就全部存
  const flush = async (only?: string[]): Promise<string | null> => {
    const { project, files, contents, cards, dirty } = latest.current;
    const keys = [...dirty].filter((k) => !only || only.includes(k));
    if (!project || keys.length === 0) return null;
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
      return null;
    } catch (e) {
      // 存失敗：把這些東西放回「還沒存」清單，狀態列顯示錯誤
      const message = e instanceof Error ? e.message : String(e);
      setDirty((d) => new Set([...d, ...keys]));
      setSaveState('error');
      setSaveError(message);
      return message;
    }
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;
  // Ctrl+S：只存目前作用中的分頁（劇本或設定卡）；沒有開分頁就不做事
  const saveActive = () => {
    const tab = latest.current.activeTab;
    if (tab) void flushRef.current([parseCardTab(tab) ? tab : fileKey(tab)]);
  };
  const saveActiveRef = useRef(saveActive);
  saveActiveRef.current = saveActive;
  // 劇本編輯器裡按 Ctrl+K S（由 ScriptEditor 登記的組合鍵）送來的「全部存檔」
  useEffect(() => {
    const onSaveAll = () => void flushRef.current();
    window.addEventListener(SAVE_ALL_EVENT, onSaveAll);
    return () => window.removeEventListener(SAVE_ALL_EVENT, onSaveAll);
  }, []);

  // 「說明」選單：打開的說明視窗，以及手動「檢查更新」（每按一次加 1）
  const [help, setHelp] = useState<HelpTopic | null>(null);
  const [updateCheck, setUpdateCheck] = useState(0);

  // Ctrl+P／Ctrl+Shift+P 的快速選單：null = 沒開；'' = 找檔案；'>' = 找功能
  const [quickPick, setQuickPick] = useState<string | null>(null);

  // 關閉程式時跳出的「要先儲存嗎？」視窗是否顯示中
  const [closePrompt, setClosePrompt] = useState(false);
  // 關分頁時跳出的「要先儲存嗎？」視窗：哪個分頁，以及問完要通知 EditorDock 關不關
  const [tabClose, setTabClose] = useState<{ tabId: string; resolve: (close: boolean) => void } | null>(null);
  // 外部（AI）改了檔案、你這邊也有沒存的修改時，問要用哪一邊的版本
  const [conflict, setConflict] = useState<{ label: string; resolve: (takeTheirs: boolean) => void } | null>(null);

  // 自動存檔：任何內容一改，計時重新開始；停下來 1 秒就存（設定裡關掉自動存檔就只靠 Ctrl+S）
  // 問「要先儲存嗎？」（關程式或關分頁）或「要用哪一邊的版本？」（外部修改）時暫停，不然還沒選就已經被自動存進去了
  useEffect(() => {
    if (dirty.size === 0 || !settings.autoSave || closePrompt || tabClose || conflict) return;
    const timer = setTimeout(() => flushRef.current(), SAVE_DELAY);
    return () => clearTimeout(timer);
  }, [dirty, contents, cards, files, settings.autoSave, closePrompt, tabClose, conflict]);

  // 套用設定：UI 大小交給桌面程式縮放整個畫面；設定卡內文大小用 CSS 變數
  useEffect(() => window.api.setZoom(settings.uiZoom), [settings.uiZoom]);
  // 顏色主題：<html data-theme="light"> 之類，styles.css 依這個換顏色（深色是預設，不用設）
  useEffect(() => {
    if (settings.theme === 'dark') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);
  useEffect(() => {
    document.documentElement.style.setProperty('--card-font-size', `${settings.cardFontSize}px`);
  }, [settings.cardFontSize]);

  // ── 關分頁時有沒存的內容：問「儲存／不儲存／取消」──
  // EditorDock 關掉某個檔案的最後一個畫面前呼叫，回傳要不要關
  const dirtyKeyOf = (tabId: string) => (parseCardTab(tabId) ? tabId : fileKey(tabId));
  const confirmTabClose = (tabId: string) =>
    latest.current.dirty.has(dirtyKeyOf(tabId))
      ? new Promise<boolean>((resolve) => setTabClose({ tabId, resolve }))
      : Promise.resolve(true);
  // 「不儲存」：丟掉這次的修改，從硬碟讀回上次存的內容（從沒存過的就保持現在的樣子，只是不再標成還沒存）
  const revertTab = async (tabId: string) => {
    const store = latest.current.project?.store;
    const ref = parseCardTab(tabId);
    try {
      if (store && ref) {
        const saved = await store.readSavedCard(ref.section, ref.id);
        if (saved) setCards((all) => ({ ...all, [ref.section]: all[ref.section].map((c) => (c.id === ref.id ? saved : c)) }));
      } else if (store) {
        const saved = await store.readSavedFile(tabId);
        if (saved) {
          setFiles((all) => ({ ...all, [tabId]: { ...all[tabId], name: saved.name } }));
          setContents((c) => ({ ...c, [tabId]: saved.content }));
        }
      }
    } catch (e) {
      reportError(e);
    }
    unmarkDirty(dirtyKeyOf(tabId));
  };
  const tabCloseDialog = () =>
    tabClose && (
      <CloseDialog
        message={`「${tabLabel(tabClose.tabId)}」有尚未儲存的變更，要先儲存嗎？`}
        onSave={async () => {
          const error = await flushRef.current([dirtyKeyOf(tabClose.tabId)]);
          if (!error) {
            tabClose.resolve(true);
            setTabClose(null);
          }
          return error;
        }}
        onDiscard={async () => {
          await revertTab(tabClose.tabId);
          tabClose.resolve(true);
          setTabClose(null);
        }}
        onCancel={() => {
          tabClose.resolve(false);
          setTabClose(null);
        }}
      />
    );

  // ── 外部改動（例如 AI 在程式外面改了檔案）─────────
  // 資料夾一有變動，停 0.3 秒（同一次改好幾個檔案時合在一起）就重新讀硬碟，比對出被外部改過的東西
  // 開了「打字效果」：一個一個切到那個分頁，把改動打出來；設定卡則是切過去、改到的欄位亮一下
  // 你這邊也有還沒存的修改時，先問要用哪一邊的版本

  // 正在播放打字效果的劇本：這段期間編輯器的改動不算「還沒存」（內容跟硬碟一樣）
  const playingRef = useRef(new Set<string>());
  const [flash, setFlash] = useState<{ tabId: string; keys: string[] } | null>(null);
  const askConflict = (label: string) => new Promise<boolean>((resolve) => setConflict({ label, resolve }));

  // 劇本開著（有編輯器在用）的話，內容要直接改編輯器的，不然畫面不會變
  const setModelText = (fileId: string, text: string) => {
    const model = monaco.editor.getModels().find((m) => m.uri.path.replace(/^\//, '') === fileId);
    if (model && model.getValue() !== text) {
      model.pushEditOperations([], [{ range: model.getFullModelRange(), text }], () => null);
      model.pushStackElement();
    }
  };

  // 一個劇本被外部改了（或新增）：切過去播放打字效果，或直接套用
  const applyFile = async (id: string, text: string) => {
    const { aiPlayback, aiSpeed } = getSettings();
    if (aiPlayback) {
      openTab(id);
      const editor = await waitForEditor(id);
      if (editor) {
        playingRef.current.add(id);
        try {
          await playEdit(editor, editor.getValue(), text, aiSpeed);
        } finally {
          playingRef.current.delete(id);
        }
      }
    } else setModelText(id, text);
    setContents((c) => ({ ...c, [id]: text }));
  };

  // 一張設定卡被外部改了（或新增）：換成新內容，切過去讓改到的欄位亮一下
  const applyCard = async (section: CardSectionId, card: Card, isNew: boolean) => {
    const before = latest.current.cards[section].find((c) => c.id === card.id);
    setCards((all) => ({
      ...all,
      [section]: isNew ? [...all[section], card] : all[section].map((c) => (c.id === card.id ? card : c)),
    }));
    if (!getSettings().aiPlayback) return;
    const keys = card.fields
      .filter((f) => before?.fields.find((b) => b.key === f.key)?.value !== f.value)
      .map((f) => f.key);
    if (!before || before.name !== card.name) keys.push('__name');
    if (!before || before.detail !== card.detail) keys.push('__detail');
    const tabId = cardTabId(section, card.id);
    openTab(tabId);
    setFlash({ tabId, keys });
    await new Promise((r) => setTimeout(r, 1800));
    setFlash((f) => (f?.tabId === tabId ? null : f));
  };

  // 把讀到的差別一項一項套用（同一時間只跑一輪；跑的時候又有變動，跑完再跑一輪）
  const applyChanges = async (ch: DiskChanges) => {
    const { dirty } = latest.current;
    setFolders(ch.folders);
    if (ch.meta) {
      setSchemas(ch.meta.schemas);
      setOrder(ch.meta.order);
    }
    // 刪掉的：從清單拿掉，開著的分頁直接關（不問）
    const gone = [...ch.files.removed, ...(Object.keys(ch.cards) as CardSectionId[]).flatMap((s) => ch.cards[s].removed.map((id) => cardTabId(s, id)))];
    if (gone.length > 0) {
      setFiles((all) => Object.fromEntries(Object.entries(all).filter(([id]) => !ch.files.removed.includes(id))));
      setCards((all) => {
        const next = { ...all };
        for (const s of Object.keys(ch.cards) as CardSectionId[]) next[s] = all[s].filter((c) => !ch.cards[s].removed.includes(c.id));
        return next;
      });
      closeTabs(gone);
      for (const id of ch.files.removed) unmarkDirty(fileKey(id));
      for (const s of Object.keys(ch.cards) as CardSectionId[]) for (const id of ch.cards[s].removed) unmarkDirty(cardTabId(s, id));
    }
    // 新增的劇本：先放一個空白的進清單，再把內容打出來
    for (const f of ch.files.added) {
      setFiles((all) => ({ ...all, [f.id]: { name: f.name, folder: f.folder } }));
      setContents((c) => ({ ...c, [f.id]: '' }));
      await applyFile(f.id, f.content);
    }
    for (const f of ch.files.changed) {
      if (dirty.has(fileKey(f.id))) {
        if (!(await askConflict(f.name))) continue; // 保留我的版本：下次存檔會蓋過去
        unmarkDirty(fileKey(f.id));
      }
      await applyFile(f.id, f.content);
    }
    for (const section of Object.keys(ch.cards) as CardSectionId[]) {
      for (const card of ch.cards[section].added) await applyCard(section, card, true);
      for (const card of ch.cards[section].changed) {
        if (dirty.has(cardTabId(section, card.id))) {
          if (!(await askConflict(card.name))) continue;
          unmarkDirty(cardTabId(section, card.id));
        }
        await applyCard(section, card, false);
      }
    }
  };

  const syncing = useRef<{ running: boolean; again: boolean }>({ running: false, again: false });
  const syncFromDisk = async () => {
    const store = latest.current.project?.store;
    if (!store) return;
    if (syncing.current.running) {
      syncing.current.again = true;
      return;
    }
    syncing.current.running = true;
    try {
      do {
        syncing.current.again = false;
        await applyChanges(await store.syncFromDisk());
      } while (syncing.current.again);
    } catch (e) {
      reportError(e);
    } finally {
      syncing.current.running = false;
    }
  };
  const syncRef = useRef(syncFromDisk);
  syncRef.current = syncFromDisk;
  useEffect(() => {
    let timer: number | undefined;
    return window.api.onFsChange(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void syncRef.current(), 300);
    });
  }, []);
  const conflictDialog = conflict && (
    <div className="close-backdrop">
      <div className="close-panel" role="dialog" aria-label="外部修改">
        <div className="close-message">「{conflict.label}」在程式外面被修改了，但你這邊也有還沒存的修改。要用哪一邊的版本？</div>
        <div className="close-buttons">
          <button
            type="button"
            className="close-btn primary"
            onClick={() => {
              conflict.resolve(true);
              setConflict(null);
            }}
          >
            用外面改的版本
          </button>
          <button
            type="button"
            className="close-btn"
            onClick={() => {
              conflict.resolve(false);
              setConflict(null);
            }}
          >
            保留我的版本
          </button>
        </div>
      </div>
    </div>
  );

  // 關閉視窗：主程式會先通知這裡。全部存好了就直接關；還有沒存的就跳出「儲存／不儲存／取消」視窗
  useEffect(() => {
    return window.api.onAppClosing(() => {
      if (latest.current.dirty.size === 0) window.api.readyToClose();
      else setClosePrompt(true);
    });
  }, []);
  const closeDialog = closePrompt && (
    <CloseDialog
      onSave={async () => {
        const error = await flushRef.current();
        if (!error) window.api.readyToClose();
        return error;
      }}
      onDiscard={() => window.api.readyToClose()}
      onCancel={() => setClosePrompt(false)}
    />
  );

  // ── 下方面板（問題／搜尋）────────────────
  // 問題的快捷鍵或狀態列：面板開著而且就在這個分頁 → 收起；否則打開並切過去
  const togglePanel = (tab: PanelTab) =>
    setLayout((l) => (l.problemsOpen && l.panelTab === tab ? { ...l, problemsOpen: false } : { ...l, problemsOpen: true, panelTab: tab }));
  const togglePanelRef = useRef(togglePanel);
  togglePanelRef.current = togglePanel;

  const [search, setSearch] = useState<SearchState>(emptySearch);
  const [searchFocus, setSearchFocus] = useState(0);
  // Ctrl+Shift+F：打開搜尋分頁、游標放進搜尋框；劇本編輯器裡選了一小段（一行內）的字，就拿來當搜尋的字
  const openSearch = () => {
    if (!latest.current.project) return;
    const editor = monaco.editor.getEditors().find((e) => e.hasTextFocus());
    const sel = editor?.getSelection();
    const picked = sel && !sel.isEmpty() && sel.startLineNumber === sel.endLineNumber ? editor?.getModel()?.getValueInRange(sel) : '';
    if (picked) setSearch((s) => ({ ...s, query: picked, regex: false }));
    setLayout((l) => ({ ...l, problemsOpen: true, panelTab: 'search' }));
    setSearchFocus((n) => n + 1);
  };
  const openSearchRef = useRef(openSearch);
  openSearchRef.current = openSearch;

  // 搜尋結果裡的一段文字：目前的內容，以及把它改成新內容
  const targetText = (t: SearchTarget): string | null => {
    const { contents, cards } = latest.current;
    if (t.kind === 'file') return contents[t.fileId] ?? null;
    const card = cards[t.section].find((c) => c.id === t.cardId);
    if (!card) return null;
    if (t.part === 'name') return card.name;
    if (t.part === 'detail') return card.detail;
    return card.fields[t.part.field]?.value ?? null;
  };
  const setTargetText = (t: SearchTarget, text: string) => {
    if (t.kind === 'file') {
      // 劇本開著的話改編輯器的內容：可以用 Ctrl+Z 復原
      setModelText(t.fileId, text);
      setContents((c) => ({ ...c, [t.fileId]: text }));
      markDirty(fileKey(t.fileId));
      return;
    }
    if (t.part === 'name') return; // 卡片名稱不取代（改名會連帶改檔名）
    const card = latest.current.cards[t.section].find((c) => c.id === t.cardId);
    if (!card) return;
    if (t.part === 'detail') cardOps.update(t.section, t.cardId, { detail: text });
    else {
      const i = t.part.field;
      cardOps.update(t.section, t.cardId, { fields: card.fields.map((f, j) => (j === i ? { ...f, value: text } : f)) });
    }
  };
  // 全部取代：同一張卡的好幾個欄位要合併成一次更新，不然後面的會用舊的卡片內容蓋掉前面改好的
  const replaceInGroups = (groups: SearchGroup[], re: RegExp) => {
    const { replace, regex } = search;
    let count = 0;
    for (const g of groups) {
      const hits = g.hits.filter((h) => !h.readonly);
      if (hits.length === 0) continue;
      const first = hits[0].target;
      if (first.kind === 'file') {
        const before = targetText(first);
        if (before === null) continue;
        const r = replaceAllInText(before, re, replace, regex);
        count += r.count;
        if (r.count > 0) setTargetText(first, r.text);
        continue;
      }
      const card = latest.current.cards[first.section].find((c) => c.id === first.cardId);
      if (!card) continue;
      let detail = card.detail;
      const fields = card.fields.map((f) => ({ ...f }));
      for (const h of hits) {
        const t = h.target;
        if (t.kind !== 'card' || t.part === 'name') continue;
        const before = t.part === 'detail' ? detail : fields[t.part.field]?.value;
        if (before === undefined) continue;
        const r = replaceAllInText(before, re, replace, regex);
        count += r.count;
        if (t.part === 'detail') detail = r.text;
        else fields[t.part.field].value = r.text;
      }
      cardOps.update(first.section, first.cardId, { detail, fields });
    }
    return count;
  };
  const replaceAll = (groups: SearchGroup[], re: RegExp) => {
    const editable = groups.filter((g) => g.hits.some((h) => !h.readonly));
    const total = editable.reduce((n, g) => n + g.hits.filter((h) => !h.readonly).reduce((m, h) => m + h.matches.length, 0), 0);
    const where = groups.length === 1 ? `「${groups[0].name}」` : `${editable.length} 個檔案或設定卡`;
    const note = '開著的劇本可以用 Ctrl+Z 復原；沒開的劇本和設定卡不能復原。';
    if (!window.confirm(`要在${where}中取代 ${total.toLocaleString()} 處嗎？\n\n${note}`)) return;
    setStatusNote(`已取代 ${replaceInGroups(groups, re).toLocaleString()} 處`);
  };
  const replaceOne = (hit: SearchHit, match: SearchMatch, re: RegExp) => {
    const before = targetText(hit.target);
    const after = before === null ? null : replaceOneInText(before, match, re, search.replace, search.regex);
    if (after !== null) setTargetText(hit.target, after); // null = 內容已經變了，對不上（等它重新搜尋完再按）
  };
  const jumpToMatch = (_g: SearchGroup, hit: SearchHit, m: SearchMatch) => {
    const t = hit.target;
    if (t.kind === 'file') {
      openTab(t.fileId);
      revealInEditor(t.fileId, m.line, m.start + 1, m.end + 1);
    } else cardOps.open(t.section, t.cardId);
  };
  const searchData = useMemo(() => ({ files, contents, cards }), [files, contents, cards]);

  // 選單的快捷鍵由這裡偵測：游標在畫面裡時，按鍵會先被 WebView2 收走，桌面程式的選單收不到
  // 用 capture：比劇本編輯器（Monaco）自己的快捷鍵先處理
  useEffect(() => {
    let chord = 0; // 按了 Ctrl+K 的時間：之後 1.5 秒內按 Ctrl+\ 就是「向下分割」
    const onKey = (e: KeyboardEvent) => {
      // Ctrl+K 接著 S（S 不按 Ctrl）：全部存檔（跟 VS Code 一樣）
      // 游標在劇本編輯器裡時交給編輯器自己的組合鍵處理（見 ScriptEditor），不然編輯器會一直等第二個鍵
      if (!e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && e.key.toLowerCase() === 's' && Date.now() - chord < 1500) {
        chord = 0;
        if ((e.target as HTMLElement | null)?.closest?.('.monaco-editor')) return;
        e.preventDefault();
        e.stopPropagation();
        void flushRef.current();
        return;
      }
      if (e.key === 'Control' || e.key === 'Shift' || e.key === 'Alt') return; // 單獨按下修飾鍵不算，組合鍵等下一個鍵
      if (!e.ctrlKey || e.altKey || e.metaKey) {
        chord = 0;
        return;
      }
      const key = e.key.toLowerCase();
      // Ctrl+\：向右分割；Ctrl+K 接著 Ctrl+\：向下分割（跟 VS Code 一樣）
      // （Ctrl+K 本身不攔下來：劇本編輯器還有 Ctrl+K Ctrl+C 這類組合鍵要用）
      if (!e.shiftKey && key === 'k') {
        chord = Date.now();
        return;
      }
      if (!e.shiftKey && key === '\\') {
        e.preventDefault();
        e.stopPropagation();
        dockRef.current?.splitActive(Date.now() - chord < 1500 ? 'below' : 'right');
        chord = 0;
        return;
      }
      chord = 0;
      // Ctrl+Shift+M：打開／收起問題面板；Ctrl+Shift+F：在整個專案中搜尋
      if (e.shiftKey && key === 'm') {
        e.preventDefault();
        e.stopPropagation();
        togglePanelRef.current('problems');
        return;
      }
      if (e.shiftKey && key === 'f') {
        e.preventDefault();
        e.stopPropagation();
        openSearchRef.current();
        return;
      }
      // Ctrl+P：快速開啟；Ctrl+Shift+P：指令面板（同一個選單，開頭是 > 就是找功能）
      if (key === 'p') {
        e.preventDefault();
        e.stopPropagation();
        setQuickPick(e.shiftKey ? '>' : '');
        return;
      }
      // Ctrl+Shift+N：新視窗
      if (e.shiftKey) {
        if (key !== 'n') return;
        e.preventDefault();
        e.stopPropagation();
        void window.api.newWindow();
        return;
      }
      const ev: MenuEvent | null =
        key === 'o' ? { type: 'open-project' } : key === 'w' ? { type: 'close-tab' } : key === ',' ? { type: 'open-settings' } : null;
      if (!ev) return;
      e.preventDefault();
      e.stopPropagation();
      void onMenuRef.current(ev);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // 刪除檔案時直接呼叫，失敗就顯示在狀態列
  const reportError = (e: unknown) => {
    setSaveState('error');
    setSaveError(e instanceof Error ? e.message : String(e));
  };

  // ── 專案 ──────────────────────────────

  // 從開始畫面打開專案：把資料夾讀到的內容放進各個狀態
  // 要開哪些分頁由編輯區決定：還原這個專案上次的版面，沒有記錄就開第一個劇本
  const loadProject = (store: ProjectStore, data: ProjectData) => {
    dockRef.current?.saveLayout(); // 從別的專案切過來時，先把舊專案的版面存起來
    // 這個專案的區塊：先換掉 sections.ts 裡的清單，之後畫面讀到的都是這個專案的；版面裡沒有的區塊補到左邊
    setCardSections(data.sections);
    setSections(data.sections);
    setLayout((l) => reconcileLayout(l, sectionOrder()));
    const ids = Object.keys(data.files);
    setFiles(Object.fromEntries(ids.map((id) => [id, { name: data.files[id].name, folder: data.files[id].folder }])));
    setFolders(data.folders);
    setContents(Object.fromEntries(ids.map((id) => [id, data.files[id].content])));
    // 舊專案：指令卡的「格式」欄位併進「用法」，改過的卡標成還沒存（自動存檔會寫回去）
    const migrated: string[] = [];
    const commands = data.cards.commands.map((card) => {
      const next = migrateFormatField(card);
      if (!next) return card;
      migrated.push(cardTabId('commands', card.id));
      return next;
    });
    setCards({ ...data.cards, commands });
    // 欄位設定也一起：拿掉「格式」，沒有「用法」就補在最前面
    let nextSchemas = data.schemas;
    const cmdFields = data.schemas.commands.fields;
    if (cmdFields.some((f) => f.key === '格式')) {
      const kept = cmdFields.filter((f) => f.key !== '格式');
      const fields = kept.some((f) => f.key === '用法') ? kept : [{ key: '用法' }, ...kept];
      nextSchemas = { ...data.schemas, commands: { ...data.schemas.commands, fields } };
      store.saveSchemas(nextSchemas).catch(reportError);
    }
    setSchemas(nextSchemas);
    setOrder(data.order);
    setActiveTab(null);
    setDirty(new Set(migrated));
    setSaveState('saved');
    setProject({ store, name: data.name });
    // 監看專案資料夾：外部（例如 AI）改了檔案就讀進來
    window.api.watchProject(store.root).catch(reportError);
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
    dockRef.current?.saveLayout(); // 編輯區即將卸載，先把版面存起來
    setProject(null);
    setFiles({});
    setFolders(emptyFolders);
    setContents({});
    setCards(emptyCards);
    setActiveTab(null);
    setDirty(new Set());
    void window.api.releaseProject(); // 別的視窗就可以開這個專案了
    return true;
  };

  // 開啟專案後共用的收尾：記到「最近的專案」再載入畫面
  const openOpened = async ({ store, data }: { store: ProjectStore; data: ProjectData }) => {
    await rememberProject(data.name, store.root);
    loadProject(store, data);
  };

  // 狀態列右邊暫時顯示的一句話（例如「已複製」），3 秒後消失
  const [statusNote, setStatusNote] = useState<string | null>(null);
  useEffect(() => {
    if (!statusNote) return;
    const timer = setTimeout(() => setStatusNote(null), 3000);
    return () => clearTimeout(timer);
  }, [statusNote]);

  // 把整個專案組成一份文字（給網頁版 AI）：複製到剪貼簿，或存成檔案
  // 打包專案：先把還沒存的存完，再把整個專案資料夾壓成一個 .vnpack（AI說明.md 不放，打開時會重新產生）
  const packProject = async () => {
    const { project } = latest.current;
    if (!project) {
      window.alert('請先開啟專案。');
      return;
    }
    const error = await flushRef.current();
    if (error && !window.confirm(`有內容存檔失敗（${error}），還是要打包嗎？沒存到的內容不會在打包檔裡。`)) return;
    try {
      if (await window.api.packProject(project.store.root, `${sanitizeName(project.name)}.vnpack`, [AI_GUIDE_NAME])) setStatusNote('已打包專案');
    } catch (e) {
      window.alert(`打包失敗：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const exportProject = async (to: 'copy' | 'file') => {
    const { project, files, contents, cards } = latest.current;
    if (!project) {
      window.alert('請先開啟專案。');
      return;
    }
    const text = buildProjectExport({ name: project.name, files, contents, cards, folders, order, schemas });
    try {
      if (to === 'copy') {
        await navigator.clipboard.writeText(text);
        setStatusNote(`已複製整個專案（${text.length.toLocaleString()} 字元），可以貼到網頁版 AI`);
      } else if (await window.api.exportSaveText(exportFileName(project.name), text)) {
        setStatusNote('已匯出專案');
      }
    } catch (e) {
      window.alert(`匯出失敗：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // 原生選單送來的指令（用 ref 讓訂閱一次就好，執行時永遠是最新版）
  const onMenu = async (ev: MenuEvent) => {
    if (ev.type === 'open-settings') {
      setShowSettings(true);
      return;
    }
    if (ev.type === 'close-tab') {
      dockRef.current?.closeActive();
      return;
    }
    if (ev.type === 'show-shortcuts' || ev.type === 'show-syntax' || ev.type === 'show-about') {
      setHelp(ev.type === 'show-shortcuts' ? 'shortcuts' : ev.type === 'show-syntax' ? 'syntax' : 'about');
      return;
    }
    if (ev.type === 'check-update') {
      setUpdateCheck((n) => n + 1);
      return;
    }
    if (ev.type === 'copy-for-ai' || ev.type === 'export-project') {
      void exportProject(ev.type === 'copy-for-ai' ? 'copy' : 'file');
      return;
    }
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
        // 已經在別的視窗開著：跳到那個視窗，這個視窗維持原樣
        if (root && (await window.api.claimProject(root))) await openOpened(await ProjectStore.open(root));
      } else if (ev.type === 'open-recent') {
        if (!(await flushBeforeLeave('有內容存檔失敗，確定要離開目前的專案嗎？'))) return;
        await openRecent(ev.path);
        if (await window.api.claimProject(ev.path)) await openOpened(await ProjectStore.open(ev.path));
      } else if (ev.type === 'import-project') {
        if (!(await flushBeforeLeave('有內容存檔失敗，確定要離開目前的專案嗎？'))) return;
        const root = await window.api.unpackProject();
        if (root && (await window.api.claimProject(root))) await openOpened(await ProjectStore.open(root));
      } else if (ev.type === 'pack-project') {
        await packProject();
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

  // ── 側邊欄與浮動面板 ──────────────────────────────

  // 每個區塊住在哪裡：左、右、浮動（隱藏的區塊位置照樣保留）
  // 版面裡可能記著別的專案才有的區塊：這個專案沒有的不畫（位置照樣記著）
  const existing = new Set(sectionOrder());
  const visibleIds = (ids: SectionId[]) => ids.filter((s) => existing.has(s) && !layout.hidden.includes(s));
  const leftSections = visibleIds(layout.left.sections);
  const rightSections = visibleIds(layout.right.sections);
  const floatPanels = layout.floating.filter((f) => existing.has(f.id) && !layout.hidden.includes(f.id));
  // 側邊欄裡沒有任何要顯示的區塊就自動收起來
  const showLeft = leftVisible && leftSections.length > 0;
  const showRight = rightSections.length > 0;
  // 活動列上亮著的圖示 = 現在看得到的區塊（左側欄被 Ctrl+B 收起時，裡面的不算）
  const activeSections = sectionOrder().filter(
    (s) => !layout.hidden.includes(s) && (layout.left.sections.includes(s) ? leftVisible : true),
  );

  // 點活動列圖示：顯示／隱藏那個區塊，不管它現在在左、右還是浮動
  // 要顯示的區塊如果在被收起的左側欄裡，順便把左側欄打開
  const toggleSection = (id: SectionId) => {
    if (activeSections.includes(id)) {
      setLayout((l) => ({ ...l, hidden: [...l.hidden, id] }));
    } else {
      setLayout((l) => ({ ...l, hidden: l.hidden.filter((s) => s !== id) }));
      if (layout.left.sections.includes(id)) setLeftVisible(true);
    }
  };

  // Ctrl+B：收起／打開左側欄；Ctrl+S：存目前的分頁（Ctrl+K S 全部存檔在上面的快捷鍵那裡）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setLeftVisible((v) => !v);
      } else if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveActiveRef.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // 拖曳側邊欄靠編輯區那一側的線調整寬度（左邊要扣掉 48 的活動列；右邊從視窗右緣算起）
  const startWidthResize = (side: Side, e: React.MouseEvent) => {
    e.preventDefault();
    dragWith((ev) => {
      const w = side === 'left' ? ev.clientX - 48 : window.innerWidth - ev.clientX;
      setLayout((l) => ({ ...l, [side]: { ...l[side], width: Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, w)) } }));
    });
  };

  // 浮動面板：改位置／大小、點一下移到最上層
  const patchFloat = (id: SectionId, patch: Partial<Layout['floating'][number]>) =>
    setLayout((l) => ({ ...l, floating: l.floating.map((f) => (f.id === id ? { ...f, ...patch } : f)) }));
  const bringToFront = (id: SectionId) =>
    setLayout((l) => {
      const z = Math.max(0, ...l.floating.map((f) => f.z)) + 1;
      return { ...l, floating: l.floating.map((f) => (f.id === id ? { ...f, z } : f)) };
    });

  // ── 拖曳整個區塊（標題列）：換位置／換邊／變浮動視窗 ──────────────────────────────
  // 用滑鼠事件自己處理（不用 HTML5 拖放，才不會和檔案樹的拖曳搬移打架）
  // 每次滑鼠移動就判斷「放開會放到哪裡」，並畫出藍色提示：
  //   側邊欄裡 → 藍線（插入位置）；空的側邊欄 → 整條藍色邊；編輯區 → 半透明藍色（變成浮動視窗）
  const mainRef = useRef<HTMLDivElement>(null);
  const [panelDrag, setPanelDrag] = useState<{
    id: SectionId;
    ghost: boolean; // 從側邊欄拉出來的才有跟著滑鼠的標籤；浮動面板是整個視窗本身在動
    x: number;
    y: number;
    hit: PanelHit | null;
  } | null>(null);

  const startPanelDrag = (id: SectionId, e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const float = layout.floating.find((f) => f.id === id);
    const layerRect = mainRef.current!.getBoundingClientRect();
    // 浮動面板：記住滑鼠抓在面板的哪個位置，移動時保持這個相對位置
    // 視窗縮小時面板會被暫時縮小、推回畫面內（記住的座標和大小不變），所以位置和大小都以畫面上實際的為準
    const shown = float
      ? document.querySelector<HTMLElement>(`.float-panel[data-float="${id}"]`)?.getBoundingClientRect()
      : undefined;
    const floatW = shown?.width ?? float?.w ?? 0;
    const floatH = shown?.height ?? float?.h ?? 0;
    const grabX = float ? startX - (shown?.left ?? layerRect.left + float.x) : 0;
    const grabY = float ? startY - (shown?.top ?? layerRect.top + float.y) : 0;
    let started = false;
    let hit: PanelHit | null = null;

    dragWith(
      (ev) => {
        // 移動超過幾個像素才算開始拖，避免點一下標題列就被當成拖曳
        if (!started && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return;
        started = true;
        hit = hitTestPanel(ev.clientX, ev.clientY, id, !float);
        if (float) {
          // 浮動面板：即時跟著滑鼠，限制在視窗內
          const x = Math.min(Math.max(0, ev.clientX - layerRect.left - grabX), Math.max(0, layerRect.width - floatW));
          const y = Math.min(Math.max(0, ev.clientY - layerRect.top - grabY), Math.max(0, layerRect.height - floatH));
          patchFloat(id, { x, y, w: floatW, h: floatH }); // 一開始拖就把縮小後的大小定下來，面板才不會邊拖邊變大
        }
        setPanelDrag({ id, ghost: !float, x: ev.clientX, y: ev.clientY, hit });
      },
      (ev) => {
        setPanelDrag(null);
        const target = hit;
        if (!started || !target) return;
        if (target.kind === 'dock') {
          setLayout((l) => dockSection(l, id, target.side, target.before));
          if (target.side === 'left') setLeftVisible(true);
        } else if (!float) {
          // 放在編輯區：變成浮動視窗，標題列對準滑鼠，並限制在視窗內
          const w = Math.min(FLOAT_DEFAULT_W, layerRect.width);
          const h = Math.min(FLOAT_DEFAULT_H, layerRect.height);
          const x = Math.min(Math.max(0, ev.clientX - layerRect.left - 40), Math.max(0, layerRect.width - w));
          const y = Math.min(Math.max(0, ev.clientY - layerRect.top - 12), Math.max(0, layerRect.height - h));
          setLayout((l) => floatSection(l, id, { x, y, w: Math.max(FLOAT_MIN_W, w), h: Math.max(FLOAT_MIN_H, h) }));
        }
      },
    );
  };

  // ── 分頁 ──────────────────────────────

  // 開啟分頁：已經開著就切過去（EditorDock 處理）
  const openTab = (id: string) => dockRef.current?.open(id);

  // 關掉分頁（所有群組裡顯示它們的面板）。刪除檔案、卡片、資料夾時用
  const closeTabs = (ids: string[]) => dockRef.current?.closeTabs(ids);

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

  // 設定卡的名稱存在卡片內容裡，檔名只是把不能用的符號換成 _，所以名稱可以有 / | 這些符號（例如 #fade in/out）
  // 只要檔名不會和同資料夾的其他項目撞名就好
  const cardNameError = (section: CardSectionId, folder: string, name: string, id?: string) => {
    if (name === '') return '請輸入名稱';
    return takenNames(section, folder, { id }).has((sanitizeName(name) + '.md').toLowerCase()) ? '已經有同名的項目' : null;
  };

  // 存欄位範本：每張卡照新範本調整欄位（刪掉選了要刪的、改名、缺的補空白、照範本排序），範本本身寫進 project.json
  // 卡片的改動直接寫進檔案，不標成「還沒存」（在欄位設定按「儲存」就是確認了）
  // 例外：那張卡本來就有你還沒存的編輯 → 編輯器裡的版本（你的編輯 + 這次調整）維持「還沒存」，
  //       另外把檔案裡上次存的版本也做同樣的調整寫回去；之後關分頁選「不儲存」，讀回來的也已經符合新範本
  const saveSchema = (section: CardSectionId, nameParam: string, edits: SchemaEdit[], removals: FieldRemoval[] = []) => {
    // from 只是用來改名的，不存進範本；沒填的 param／icon／color 不寫出去
    const schema = edits.map(({ key, param, icon, color }) => ({ key, ...(param && { param }), ...(icon && { icon }), ...(icon && color && { color }) }));
    const renames = new Map(edits.filter((e) => e.from && e.from !== e.key).map((e) => [e.from!, e.key]));
    // 從範本刪掉、而且選了「連卡片上的一起刪」的欄位：先刪（用卡片上原本的名稱比對），再處理改名和補欄位
    const removeMode = new Map(removals.map((r) => [r.key, r.mode]));
    const adjust = (fields: Card['fields']) => {
      const kept = fields.filter((f) => {
        const mode = removeMode.get(f.key);
        return !(mode === 'all' || (mode === 'empty' && f.value.trim() === ''));
      });
      return applySchema(
        kept.map((f) => (renames.has(f.key) ? { ...f, key: renames.get(f.key)! } : f)),
        schema,
      );
    };

    const store = project?.store;
    const updated = new Map<string, Card>();
    for (const c of cards[section]) {
      const fields = adjust(c.fields);
      if (JSON.stringify(fields) === JSON.stringify(c.fields)) continue;
      const card = { ...c, fields };
      updated.set(c.id, card);
      if (!store) continue;
      if (!dirty.has(cardTabId(section, c.id))) {
        store.saveCard(section, card).catch(reportError);
      } else {
        // 有還沒存的編輯：只調整檔案裡的那一版（從沒存過的新卡沒有檔案，就不用）
        store
          .readSavedCard(section, c.id)
          .then((saved) => {
            if (!saved) return;
            const savedFields = adjust(saved.fields);
            if (JSON.stringify(savedFields) !== JSON.stringify(saved.fields)) return store.saveCard(section, { ...saved, fields: savedFields });
          })
          .catch(reportError);
      }
    }
    setCards((all) => ({ ...all, [section]: all[section].map((c) => updated.get(c.id) ?? c) }));
    const next = { ...schemas, [section]: nameParam ? { nameParam, fields: schema } : { fields: schema } };
    setSchemas(next);
    project?.store.saveSchemas(next).catch(reportError);
  };

  // 區塊設定按了「儲存」：先把還沒存的存完（資料夾可能要改名），再請 ProjectStore 改硬碟（刪、改名、建立資料夾），
  // 成功了才更新畫面：刪掉的區塊關掉它的分頁、拿掉卡片和範本；新增的區塊放進讀到的卡；版面裡沒有的區塊補到左邊
  const saveSections = async (next: SectionDef[], removals: SectionRemoval[]) => {
    const store = latest.current.project?.store;
    if (!store) return;
    await flushRef.current();
    let loaded: Awaited<ReturnType<ProjectStore['updateSections']>>;
    try {
      loaded = await store.updateSections(next, removals);
    } catch (e) {
      window.alert(`區塊設定失敗：${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    const removed = removals.map((r) => r.id);
    const { cards: allCards } = latest.current;
    const tabIds = removed.flatMap((id) => (allCards[id] ?? []).map((c) => cardTabId(id, c.id)));
    closeTabs(tabIds);
    setDirty((d) => new Set([...d].filter((k) => !tabIds.includes(k))));

    setCardSections(next);
    setSections(next);
    const without = <T,>(rec: Record<string, T>) => Object.fromEntries(Object.entries(rec).filter(([id]) => !removed.includes(id)));
    setCards((all) => ({ ...without(all), ...Object.fromEntries(loaded.map((l) => [l.id, l.cards])) }));
    setFolders((all) => ({ ...without(all), ...Object.fromEntries(loaded.map((l) => [l.id, l.folders])) }));
    const nextSchemas = { ...without(schemas), ...Object.fromEntries(loaded.map((l) => [l.id, defaultSchema(l.id)])) };
    setSchemas(nextSchemas);
    store.saveSchemas(nextSchemas).catch(reportError);
    if (removed.some((id) => orderRef.current[id])) commitOrder(without(orderRef.current) as ItemOrder);
    setLayout((l) => reconcileLayout(l, sectionOrder()));
  };

  const findCard = (section: CardSectionId, id: string) => cards[section].find((c) => c.id === id);

  const cardOps: CardOps = {
    open: (section, id) => openTab(cardTabId(section, id)),
    add: (section, folder, rawName) => {
      const name = rawName.trim();
      const err = cardNameError(section, folder, name);
      if (err) return err;
      // 新的卡一建立就帶著範本裡的欄位（內容空白）
      const card: Card = { id: Date.now().toString(36), name, fields: applySchema([], schemas[section].fields), detail: '', folder };
      setCards((all) => ({ ...all, [section]: [...all[section], card] }));
      markDirty(cardTabId(section, card.id));
      openTab(cardTabId(section, card.id));
      return null;
    },
    rename: (section, id, rawName) => {
      const card = findCard(section, id);
      const name = rawName.trim();
      if (!card || name === card.name) return null;
      const err = cardNameError(section, card.folder ?? '', name, id);
      if (err) return err;
      cardOps.update(section, id, { name });
      renameInOrder(section, card.folder ?? '', card.name, name);
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
      closeTabs([cardTabId(section, id)]);
    },
  };

  // ── 左側清單的自訂順序 ──────────────────────────────

  // 某個資料夾裡的項目改成這個順序（拖曳排序、右鍵排序），並寫回 project.json
  // 一律從 orderRef 讀最新的順序：拖曳時「先搬資料夾、再排位置」是連續兩次修改，中間還沒重新畫面，不能用舊的 order
  const orderRef = useRef(order);
  orderRef.current = order;
  const commitOrder = (next: ItemOrder) => {
    orderRef.current = next;
    setOrder(next);
    latest.current.project?.store.saveOrder(next).catch(reportError);
  };
  const reorder = (section: SectionId, folder: string, names: string[]) => {
    const cur = orderRef.current;
    commitOrder({ ...cur, [section]: { ...cur[section], [folder]: names } });
  };
  // 項目改名：順序清單裡的名字跟著換
  const renameInOrder = (section: SectionId, folder: string, from: string, to: string) => {
    const list = orderRef.current[section]?.[folder];
    if (list?.includes(from)) reorder(section, folder, list.map((n) => (n === from ? to : n)));
  };
  // 資料夾改名或搬家：它和底下各層資料夾的順序清單跟著搬到新路徑；
  // 原本所在那一層的清單裡，它的「名稱/」換成新名稱（同一層改名，位置不變）或拿掉（搬到別層）
  const renameFolderInOrder = (section: SectionId, oldPath: string, newPath: string) => {
    const lists = orderRef.current[section];
    if (!lists) return;
    const moved: Record<string, string[]> = Object.fromEntries(
      Object.entries(lists).map(([f, names]) => [isInFolder(f, oldPath) ? newPath + f.slice(oldPath.length) : f, names]),
    );
    const parent = parentFolder(oldPath);
    const oldKey = folderOrderKey(oldPath);
    if (moved[parent]?.includes(oldKey)) {
      moved[parent] =
        parentFolder(newPath) === parent
          ? moved[parent].map((n) => (n === oldKey ? folderOrderKey(newPath) : n))
          : moved[parent].filter((n) => n !== oldKey);
    }
    commitOrder({ ...orderRef.current, [section]: moved });
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
      renameInOrder('files', file.folder, file.name, name);
      return null;
    },
    remove: (id) => {
      setFiles((all) => Object.fromEntries(Object.entries(all).filter(([fileId]) => fileId !== id)));
      setContents((c) => Object.fromEntries(Object.entries(c).filter(([fileId]) => fileId !== id)));
      unmarkDirty(fileKey(id));
      project?.store.deleteFile(id).catch(reportError);
      closeTabs([id]);
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
        renameFolderInOrder(section, folder, newRel);
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

  // ── 拖曳搬移（檔案／設定卡／資料夾拖進別的資料夾）──────────────────────────────

  // 把 item 搬進 toFolder（'' = 區塊根目錄）。只在同一個區塊內搬；搬在硬碟上也是真的搬
  // 所有的錯誤（同名、搬進自己底下、硬碟操作失敗）都用 alert 告訴使用者，不會半途改了畫面
  const moveItem = async (section: SectionId, item: MoveItem, toFolder: string) => {
    const store = latest.current.project?.store;
    if (!store) return;

    // 項目目前所在的資料夾，以及搬過去之後會占用的名稱（和 takenNames 一樣的小寫規則）
    let from: string;
    let name: string;
    if (item.kind === 'folder') {
      if (isInFolder(toFolder, item.folder)) return window.alert('不能把資料夾移到它自己或它的子資料夾裡');
      from = parentFolder(item.folder);
      name = folderBase(item.folder);
    } else if (item.kind === 'file') {
      const f = files[item.id];
      if (!f) return;
      from = f.folder;
      name = f.name;
    } else {
      const c = findCard(section as CardSectionId, item.id);
      if (!c) return;
      from = c.folder ?? '';
      name = sanitizeName(c.name) + '.md';
    }
    if (from === toFolder) return; // 已經在那裡
    if (takenNames(section, toFolder).has(name.toLowerCase())) return window.alert('目標資料夾裡已經有同名的項目');

    // 先把還沒存的內容存完，才不會有存檔還在用舊路徑（和資料夾改名一樣）
    await flushRef.current();
    try {
      if (item.kind === 'file') {
        await store.moveFile(item.id, toFolder);
        setFiles((all) => ({ ...all, [item.id]: { ...all[item.id], folder: toFolder } }));
      } else if (item.kind === 'card') {
        await store.moveCard(section as CardSectionId, item.id, toFolder);
        setCards((all) => ({
          ...all,
          [section]: all[section as CardSectionId].map((c) => (c.id === item.id ? { ...c, folder: toFolder } : c)),
        }));
      } else {
        const newRel = await store.moveFolder(section, item.folder, toFolder);
        // 資料夾本身和裡面每個檔案／卡片的路徑都換成新的前綴（和資料夾改名一樣）
        const remap = (p: string) => (isInFolder(p, item.folder) ? newRel + p.slice(item.folder.length) : p);
        setFolders((f) => ({ ...f, [section]: f[section].map(remap) }));
        renameFolderInOrder(section, item.folder, newRel);
        if (section === 'files') {
          setFiles((all) => Object.fromEntries(Object.entries(all).map(([id, f]) => [id, { ...f, folder: remap(f.folder) }])));
        } else {
          setCards((all) => ({
            ...all,
            [section]: all[section as CardSectionId].map((c) => ({ ...c, folder: remap(c.folder ?? '') })),
          }));
        }
        setCollapsed((c) => remapFolderKeys(c, section, item.folder, newRel));
      }
      // 目標資料夾如果是摺起來的就展開，才看得到搬進去的東西
      const targetKey = folderKey(section, toFolder);
      setCollapsed((c) => (c.has(targetKey) ? new Set([...c].filter((k) => k !== targetKey)) : c));
    } catch (e) {
      showFolderError('移動', e);
    }
  };

  // ── 決定每個分頁的標題、編輯區要顯示什麼、狀態列寫什麼 ─────────

  const tabLabel = (tabId: string) => {
    const ref = parseCardTab(tabId);
    if (!ref) return files[tabId]?.name ?? '';
    return findCard(ref.section, ref.id)?.name || '（未命名）';
  };
  // 分頁名稱前面的圖示：劇本照副檔名，設定卡用區塊的圖示
  const tabIcon = (tabId: string) => {
    const ref = parseCardTab(tabId);
    if (!ref) return files[tabId] ? fileIcon(files[tabId].name) : null;
    return sectionMeta(ref.section).icon;
  };

  const activeCardRef = activeTab ? parseCardTab(activeTab) : null;
  const activeCard = activeCardRef ? findCard(activeCardRef.section, activeCardRef.id) : undefined;

  let status = { left: '沒有開啟的檔案', right: '' };

  if (activeCardRef && activeCard) {
    status = { left: `${sectionMeta(activeCardRef.section).title}／${activeCard.name}`, right: `詳細內容 ${countChars(activeCard.detail)} 字` };
  } else if (activeTab && !activeCardRef && files[activeTab]) {
    status = {
      left: files[activeTab]?.name ?? '',
      right: `行 ${cursor.line}，欄 ${cursor.column}　｜　字數 ${countChars(contents[activeTab])}`,
    };
  }

  // 設定視窗蓋在最上面；開始畫面也能開
  const settingsDialog = showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />;

  // ── Ctrl+P 快速開啟／Ctrl+Shift+P 指令面板 ─────────
  // 找檔案：所有劇本和設定卡；找功能：選單上的功能、新增○○（接著在同一個框裡打名稱）、各區塊的欄位設定
  const where = (title: string, folder?: string) => (folder ? `${title}／${folder}` : title);
  const quickFiles: QuickPickItem[] = project
    ? [
        ...Object.entries(files).map(([id, f]) => ({
          id: `file:${id}`,
          label: f.name,
          detail: where('劇本', f.folder),
          icon: fileIcon(f.name),
          run: () => openTab(id),
        })),
        ...(Object.keys(cards) as CardSectionId[]).flatMap((section) =>
          cards[section].map((c) => ({
            id: cardTabId(section, c.id),
            label: c.name || '（未命名）',
            detail: where(sectionMeta(section).title, c.folder),
            icon: sectionMeta(section).icon,
            run: () => cardOps.open(section, c.id),
          })),
        ),
      ]
    : [];
  const menu = (type: MenuEvent['type']) => () => void onMenuRef.current({ type } as MenuEvent);
  const quickCommands: QuickPickItem[] = [
    { id: 'new-window', label: '新視窗', keybinding: 'Ctrl+Shift+N', icon: 'add', run: () => void window.api.newWindow() },
    { id: 'open-project', label: '開啟專案資料夾…', keybinding: 'Ctrl+O', icon: 'folder-opened', run: menu('open-project') },
    { id: 'new-project', label: '新增專案…', icon: 'new-folder', run: menu('new-project') },
    { id: 'settings', label: '設定…', keybinding: 'Ctrl+,', icon: 'settings-gear', run: () => setShowSettings(true) },
    ...(['dark', 'light', 'hc'] as const).map((theme, i) => ({
      id: `theme-${theme}`,
      label: `顏色主題：${['深色', '淺色', '高對比'][i]}`,
      icon: 'color-mode',
      run: () => updateSettings({ theme }),
    })),
    { id: 'help-shortcuts', label: '說明：鍵盤快捷鍵', icon: 'keyboard', run: () => setHelp('shortcuts') },
    { id: 'help-syntax', label: '說明：劇本語法', icon: 'book', run: () => setHelp('syntax') },
    { id: 'check-update', label: '檢查更新…', icon: 'sync', run: () => setUpdateCheck((n) => n + 1) },
    ...(project
      ? [
          { id: 'save', label: '存檔（目前的分頁）', keybinding: 'Ctrl+S', icon: 'save', run: () => saveActive() },
          { id: 'save-all', label: '全部存檔', keybinding: 'Ctrl+K S', icon: 'save', run: () => void flushRef.current() },
          { id: 'close-tab', label: '關閉分頁', keybinding: 'Ctrl+W', icon: 'close', run: menu('close-tab') },
          { id: 'split-right', label: '向右分割', keybinding: 'Ctrl+\\', icon: 'split-horizontal', run: () => dockRef.current?.splitActive('right') },
          { id: 'split-down', label: '向下分割', keybinding: 'Ctrl+K Ctrl+\\', icon: 'split-vertical', run: () => dockRef.current?.splitActive('below') },
          { id: 'toggle-left', label: '收起／打開左側欄', keybinding: 'Ctrl+B', icon: 'layout-sidebar-left', run: () => setLeftVisible((v) => !v) },
          {
            id: 'toggle-problems',
            label: '打開／收起問題面板',
            keybinding: 'Ctrl+Shift+M',
            icon: 'error',
            run: () => togglePanel('problems'),
          },
          { id: 'search', label: '在整個專案中搜尋／取代', keybinding: 'Ctrl+Shift+F', icon: 'search', run: () => openSearch() },
          {
            id: 'new-script',
            label: '新增劇本',
            icon: fileIcon('.vns'),
            run: () => ({ placeholder: '劇本檔名（沒寫副檔名會自動補 .vns）', submit: (name: string) => fileOps.add('', name) }),
          },
          ...(Object.keys(cards) as CardSectionId[]).map((section) => ({
            id: `new-${section}`,
            label: `新增${sectionMeta(section).title}`,
            icon: sectionMeta(section).icon,
            run: () => ({ placeholder: `${sectionMeta(section).title}的名稱`, submit: (name: string) => cardOps.add(section, '', name) }),
          })),
          ...(Object.keys(cards) as CardSectionId[]).map((section) => ({
            id: `schema-${section}`,
            label: `${sectionMeta(section).title}的欄位設定…`,
            icon: 'list-tree',
            run: () => setSchemaDialog(section),
          })),
          { id: 'copy-for-ai', label: '複製整個專案（給網頁版 AI）', icon: 'copy', run: () => void exportProject('copy') },
          { id: 'export-project', label: '匯出專案為單一文字檔…', icon: 'export', run: () => void exportProject('file') },
          { id: 'pack-project', label: '打包專案成一個檔案（.vnpack）…', icon: 'export', run: () => void packProject() },
          { id: 'edit-sections', label: '區塊設定…（新增、改名、刪除區塊）', icon: 'list-tree', run: () => setSectionsDialog(true) },
          { id: 'close-project', label: '關閉專案', icon: 'root-folder', run: menu('close-project') },
        ]
      : []),
  ];
  const quickPickView = quickPick !== null && (
    <QuickPick key={quickPick} initial={quickPick} files={quickFiles} commands={quickCommands} onClose={() => setQuickPick(null)} />
  );

  if (!project) {
    return (
      <>
        <WelcomeScreen key={createKey} startInCreateMode={startInCreate} onOpen={loadProject} />
        {settingsDialog}
        {closeDialog}
        <UpdateDialog beforeInstall={() => flushRef.current()} manualCheck={updateCheck} />
        {help && <HelpDialog topic={help} onClose={() => setHelp(null)} />}
        <Tooltip />
        {quickPickView}
      </>
    );
  }

  const saveLabel = statusNote ??
    (saveState === 'error' ? `⚠ 存檔失敗：${saveError}` : saveState === 'saving' ? '儲存中…' : dirty.size > 0 ? '尚未儲存' : '已儲存');

  // 左右側邊欄和浮動面板的 SectionPanel 共用的資料與操作
  const treeProps = {
    files,
    fileOps,
    folders,
    folderOps,
    cards,
    cardOps,
    activeTab,
    onOpenFile: openTab,
    collapsed,
    setCollapsed,
    onMove: moveItem,
    order,
    onReorder: reorder,
    onHeaderDrag: startPanelDrag,
    onEditSchema: setSchemaDialog,
    onEditSections: () => setSectionsDialog(true),
    schemas,
  };
  const onLayoutChange = (patch: Partial<Layout>) => setLayout((l) => ({ ...l, ...patch }));
  // 拖曳整個區塊時，沒有顯示側邊欄的那一邊要先露出一條窄窄的「放這裡」區域
  const dockZones: Side[] = panelDrag ? (['left', 'right'] as Side[]).filter((s) => !(s === 'left' ? showLeft : showRight)) : [];

  return (
    <div className="app">
      <div className="main" ref={mainRef}>
        <ActivityBar
          active={activeSections}
          onToggle={toggleSection}
          leftOpen={leftVisible}
          onToggleLeft={() => setLeftVisible((v) => !v)}
        />
        {showLeft && (
          <>
            <Sidebar {...treeProps} side="left" sections={leftSections} layout={layout} onLayoutChange={onLayoutChange} />
            <div className="splitter" onMouseDown={(e) => startWidthResize('left', e)} />
          </>
        )}
        <EditorDock
          key={project.store.root} // 換專案時整個編輯區重建，各自還原自己的版面
          ref={dockRef}
          rootPath={project.store.root}
          files={files}
          contents={contents}
          cards={cards}
          schemas={schemas}
          isDirty={(tabId) => dirty.has(parseCardTab(tabId) ? tabId : fileKey(tabId))}
          tabLabel={tabLabel}
          tabIcon={tabIcon}
          onFileChange={(id, text) => {
            setContents((c) => ({ ...c, [id]: text }));
            // 播放外部改動的打字效果時，內容其實跟硬碟一樣，不算還沒存
            if (!playingRef.current.has(id)) markDirty(fileKey(id));
          }}
          onCardChange={cardOps.update}
          onCursor={setCursor}
          onActiveTabChange={setActiveTab}
          confirmClose={confirmTabClose}
          flash={flash}
          bottom={
            layout.problemsOpen && (
              <BottomPanel
                tab={layout.panelTab}
                onTab={(panelTab) => setLayout((l) => ({ ...l, panelTab }))}
                problemCount={problemCount}
                height={layout.problemsHeight}
                onResize={(h) => setLayout((l) => ({ ...l, problemsHeight: h }))}
                onClose={() => setLayout((l) => ({ ...l, problemsOpen: false }))}
              >
                {layout.panelTab === 'problems' ? (
                  <ProblemsPanel
                    groups={problems}
                    onJump={(fileId, line, column) => {
                      openTab(fileId);
                      revealInEditor(fileId, line, column);
                    }}
                  />
                ) : (
                  <SearchPanel
                    data={searchData}
                    state={search}
                    onState={(patch) => setSearch((s) => ({ ...s, ...patch }))}
                    focusKey={searchFocus}
                    onJump={jumpToMatch}
                    onReplaceOne={replaceOne}
                    onReplaceAll={replaceAll}
                  />
                )}
              </BottomPanel>
            )
          }
        />
        {showRight && (
          <>
            <div className="splitter" onMouseDown={(e) => startWidthResize('right', e)} />
            <Sidebar {...treeProps} side="right" sections={rightSections} layout={layout} onLayoutChange={onLayoutChange} />
          </>
        )}
        <FloatLayer {...treeProps} panels={floatPanels} onChange={patchFloat} onFront={bringToFront} />

        {/* 拖曳區塊時的提示：空側邊欄的放置區 */}
        {dockZones.map((side) => (
          <div
            key={side}
            className={`dock-zone ${side}${panelDrag?.hit?.kind === 'dock' && panelDrag.hit.side === side ? ' hot' : ''}`}
            data-dock-zone={side}
          />
        ))}
      </div>
      {/* 藍線（插入位置）或藍色範圍（放進空側邊欄／變成浮動視窗），以及跟著滑鼠的標籤 */}
      {panelDrag?.hit && (
        <div className={panelDrag.hit.mark === 'line' ? 'drop-line' : 'drop-zone'} style={{ ...panelDrag.hit.rect }} />
      )}
      {panelDrag?.ghost && (
        <div className="drag-ghost" style={{ left: panelDrag.x + 12, top: panelDrag.y + 8 }}>
          <Icon icon={sectionMeta(panelDrag.id).icon} /> {sectionMeta(panelDrag.id).title}
        </div>
      )}
      <StatusBar
        problems={problemCount}
        onProblems={() => togglePanel('problems')}
        left={`${project.name}　｜　${status.left}`}
        right={status.right ? `${status.right}　｜　${saveLabel}` : saveLabel}
      />
      {settingsDialog}
      {closeDialog}
      <UpdateDialog beforeInstall={() => flushRef.current()} manualCheck={updateCheck} />
      {help && <HelpDialog topic={help} onClose={() => setHelp(null)} />}
      <Tooltip />
      {tabCloseDialog()}
      {conflictDialog}
      {quickPickView}
      {sectionsDialog && (
        <SectionsDialog
          sections={getCardSections()}
          cardCount={(id) => cards[id]?.length ?? 0}
          onSave={(next, removals) => void saveSections(next, removals)}
          onClose={() => setSectionsDialog(false)}
        />
      )}
      {schemaDialog && (
        <SchemaDialog
          key={schemaDialog}
          title={sectionMeta(schemaDialog).title}
          icon={sectionMeta(schemaDialog).icon}
          schema={schemas[schemaDialog]}
          specialFields={schemaDialog === 'commands' ? FIXED_COMMAND_FIELDS : []}
          cards={cards[schemaDialog]}
          onSave={(nameParam, edits, removals) => saveSchema(schemaDialog, nameParam, edits, removals)}
          onClose={() => setSchemaDialog(null)}
        />
      )}
    </div>
  );
}

// 字數：不算空白和換行
const countChars = (text: string) => text.replace(/\s/g, '').length.toLocaleString();

// 拖曳的共用寫法：按下後跟著滑鼠移動，放開就停止（onEnd 在放開時呼叫）
export function dragWith(onMove: (ev: MouseEvent) => void, onEnd?: (ev: MouseEvent) => void) {
  const onUp = (ev: MouseEvent) => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    document.body.classList.remove('dragging');
    onEnd?.(ev);
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  document.body.classList.add('dragging');
}

// 拖曳整個區塊時，滑鼠現在指著哪裡、放開會發生什麼，以及要畫在哪裡（螢幕座標）
type Box = { left: number; top: number; width: number; height: number };
type PanelHit =
  | { kind: 'dock'; side: Side; before: SectionId | null; mark: 'line' | 'zone'; rect: Box } // 放進側邊欄，插在 before 前面（null = 最後）
  | { kind: 'float'; mark: 'zone'; rect: Box }; // 變成浮動視窗

const boxOf = (r: DOMRect): Box => ({ left: r.left, top: r.top, width: r.width, height: r.height });

// 判斷 (x, y) 在哪個放置位置。dragId = 被拖的區塊（算插入位置時不把它自己算進去）
// allowFloat：從側邊欄拉出來時，放在編輯區 = 變浮動視窗；浮動面板本來就浮著，所以不用
function hitTestPanel(x: number, y: number, dragId: SectionId, allowFloat: boolean): PanelHit | null {
  const inside = (r: DOMRect) => x >= r.left && x < r.right && y >= r.top && y < r.bottom;

  for (const side of ['left', 'right'] as Side[]) {
    const bar = document.querySelector<HTMLElement>(`.sidebar[data-side="${side}"]`);
    if (bar) {
      const r = bar.getBoundingClientRect();
      if (!inside(r)) continue;
      // 插入位置：第一個「中線在滑鼠下方」的區塊前面；都不是就放最後
      const panels = [...bar.querySelectorAll<HTMLElement>(':scope > .section')].filter((el) => el.dataset.section !== dragId);
      let before: SectionId | null = null;
      let lineY = panels.length ? panels[panels.length - 1].getBoundingClientRect().bottom : r.top;
      for (const el of panels) {
        const pr = el.getBoundingClientRect();
        if (y < pr.top + pr.height / 2) {
          before = el.dataset.section as SectionId;
          lineY = pr.top;
          break;
        }
      }
      return { kind: 'dock', side, before, mark: 'line', rect: { left: r.left, top: lineY - 1, width: r.width, height: 3 } };
    }
    // 這一邊沒有側邊欄（空的或被收起）：看有沒有落在放置區
    const zone = document.querySelector<HTMLElement>(`[data-dock-zone="${side}"]`);
    if (zone && inside(zone.getBoundingClientRect())) {
      return { kind: 'dock', side, before: null, mark: 'zone', rect: boxOf(zone.getBoundingClientRect()) };
    }
  }

  if (allowFloat) {
    const editor = document.querySelector<HTMLElement>('.editor-area');
    if (editor && inside(editor.getBoundingClientRect())) {
      return { kind: 'float', mark: 'zone', rect: boxOf(editor.getBoundingClientRect()) };
    }
  }
  return null;
}
