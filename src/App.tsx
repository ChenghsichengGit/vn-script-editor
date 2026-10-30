import { useEffect, useRef, useState } from 'react';
import ActivityBar from './components/ActivityBar';
import Sidebar from './components/Sidebar';
import FloatLayer from './components/FloatLayer';
import { MoveItem, folderKey, remapFolderKeys } from './components/SectionPanel';
import EditorDock, { EditorDockHandle } from './components/EditorDock';
import StatusBar from './components/StatusBar';
import WelcomeScreen from './components/WelcomeScreen';
import SettingsDialog from './components/SettingsDialog';
import { useSettings } from './settings';
import {
  Card,
  CardOps,
  CardSectionId,
  ItemOrder,
  SchemaEdit,
  Schemas,
  SectionId,
  applySchema,
  cardTabId,
  defaultSchemas,
  parseCardTab,
} from './model';
import SchemaDialog from './components/SchemaDialog';
import { FIXED_COMMAND_FIELDS, migrateFormatField, setScriptData } from './scriptLanguage';
import { fileIcon, sectionMeta, sectionOrder } from './sampleData';
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

const emptyCards: Record<CardSectionId, Card[]> = { characters: [], world: [], commands: [] };
const emptyFolders: Record<SectionId, string[]> = { files: [], characters: [], world: [], commands: [] };

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
  const [schemas, setSchemas] = useState<Schemas>(defaultSchemas);
  const [schemaDialog, setSchemaDialog] = useState<CardSectionId | null>(null);
  // 左側清單的自訂順序（存在 project.json）
  const [order, setOrder] = useState<ItemOrder>({});
  // 卡片或範本一變，就把最新的指令清單和參數可選值交給劇本編輯器的補齊功能
  useEffect(() => setScriptData(cards, schemas), [cards, schemas]);

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

  // 自動存檔：任何內容一改，計時重新開始；停下來 1 秒就存（設定裡關掉自動存檔就只靠 Ctrl+S，關視窗時仍會存）
  useEffect(() => {
    if (dirty.size === 0 || !settings.autoSave) return;
    const timer = setTimeout(() => flushRef.current(), SAVE_DELAY);
    return () => clearTimeout(timer);
  }, [dirty, contents, cards, files, settings.autoSave]);

  // 套用設定：UI 大小交給 Electron 縮放整個畫面；設定卡內文大小用 CSS 變數
  useEffect(() => window.api.setZoom(settings.uiZoom), [settings.uiZoom]);
  useEffect(() => {
    document.documentElement.style.setProperty('--card-font-size', `${settings.cardFontSize}px`);
  }, [settings.cardFontSize]);

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

  // 從開始畫面打開專案：把資料夾讀到的內容放進各個狀態
  // 要開哪些分頁由編輯區決定：還原這個專案上次的版面，沒有記錄就開第一個劇本
  const loadProject = (store: ProjectStore, data: ProjectData) => {
    dockRef.current?.saveLayout(); // 從別的專案切過來時，先把舊專案的版面存起來
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
    return true;
  };

  // 開啟專案後共用的收尾：記到「最近的專案」再載入畫面
  const openOpened = async ({ store, data }: { store: ProjectStore; data: ProjectData }) => {
    await rememberProject(data.name, store.root);
    loadProject(store, data);
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

  // ── 側邊欄與浮動面板 ──────────────────────────────

  // 每個區塊住在哪裡：左、右、浮動（隱藏的區塊位置照樣保留）
  const visibleIds = (ids: SectionId[]) => ids.filter((s) => !layout.hidden.includes(s));
  const leftSections = visibleIds(layout.left.sections);
  const rightSections = visibleIds(layout.right.sections);
  const floatPanels = layout.floating.filter((f) => !layout.hidden.includes(f.id));
  // 側邊欄裡沒有任何要顯示的區塊就自動收起來
  const showLeft = leftVisible && leftSections.length > 0;
  const showRight = rightSections.length > 0;
  // 活動列上亮著的圖示 = 現在看得到的區塊（左側欄被 Ctrl+B 收起時，裡面的不算）
  const activeSections = sectionOrder.filter(
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

  // Ctrl+B：收起／打開左側欄；Ctrl+S：立刻存檔
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setLeftVisible((v) => !v);
      } else if (e.ctrlKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        flushRef.current();
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

  // 存欄位範本：先把改了名的欄位在每張卡上跟著改名，再讓每張卡都符合新範本（缺的補空白）
  // 有變動的卡標成「還沒存」，交給自動存檔寫回去；範本本身寫進 project.json
  const saveSchema = (section: CardSectionId, nameParam: string, edits: SchemaEdit[]) => {
    const schema = edits.map(({ key, param }) => (param ? { key, param } : { key }));
    const renames = new Map(edits.filter((e) => e.from && e.from !== e.key).map((e) => [e.from!, e.key]));
    const updated = new Map<string, Card>();
    for (const c of cards[section]) {
      const renamed = c.fields.map((f) => (renames.has(f.key) ? { ...f, key: renames.get(f.key)! } : f));
      const fields = applySchema(renamed, schema);
      if (JSON.stringify(fields) !== JSON.stringify(c.fields)) updated.set(c.id, { ...c, fields });
    }
    setCards((all) => ({ ...all, [section]: all[section].map((c) => updated.get(c.id) ?? c) }));
    updated.forEach((_, id) => markDirty(cardTabId(section, id)));
    const next = { ...schemas, [section]: nameParam ? { nameParam, fields: schema } : { fields: schema } };
    setSchemas(next);
    project?.store.saveSchemas(next).catch(reportError);
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
  const reorder = (section: SectionId, folder: string, names: string[]) => {
    const next: ItemOrder = { ...order, [section]: { ...order[section], [folder]: names } };
    setOrder(next);
    project?.store.saveOrder(next).catch(reportError);
  };
  // 項目改名：順序清單裡的名字跟著換
  const renameInOrder = (section: SectionId, folder: string, from: string, to: string) => {
    const list = order[section]?.[folder];
    if (list?.includes(from)) reorder(section, folder, list.map((n) => (n === from ? to : n)));
  };
  // 資料夾改名：它和底下各層資料夾的順序清單跟著搬到新路徑
  const renameFolderInOrder = (section: SectionId, oldPath: string, newPath: string) => {
    const lists = order[section];
    if (!lists) return;
    const moved = Object.fromEntries(
      Object.entries(lists).map(([f, names]) => [isInFolder(f, oldPath) ? newPath + f.slice(oldPath.length) : f, names]),
    );
    const next: ItemOrder = { ...order, [section]: moved };
    setOrder(next);
    project?.store.saveOrder(next).catch(reportError);
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
    if (!ref) return files[tabId] ? `${fileIcon(files[tabId].name)} ${files[tabId].name}` : '';
    return `${sectionMeta[ref.section].icon} ${findCard(ref.section, ref.id)?.name || '（未命名）'}`;
  };

  const activeCardRef = activeTab ? parseCardTab(activeTab) : null;
  const activeCard = activeCardRef ? findCard(activeCardRef.section, activeCardRef.id) : undefined;

  let status = { left: '沒有開啟的檔案', right: '' };

  if (activeCardRef && activeCard) {
    status = { left: `${sectionMeta[activeCardRef.section].title}／${activeCard.name}`, right: `詳細內容 ${countChars(activeCard.detail)} 字` };
  } else if (activeTab && !activeCardRef && files[activeTab]) {
    status = {
      left: files[activeTab]?.name ?? '',
      right: `行 ${cursor.line}，欄 ${cursor.column}　｜　字數 ${countChars(contents[activeTab])}`,
    };
  }

  // 設定視窗蓋在最上面；開始畫面也能開
  const settingsDialog = showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />;

  if (!project) {
    return (
      <>
        <WelcomeScreen key={createKey} startInCreateMode={startInCreate} onOpen={loadProject} />
        {settingsDialog}
      </>
    );
  }

  const saveLabel =
    saveState === 'error' ? `⚠ 存檔失敗：${saveError}` : saveState === 'saving' ? '儲存中…' : dirty.size > 0 ? '尚未儲存' : '已儲存';

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
          onFileChange={(id, text) => {
            setContents((c) => ({ ...c, [id]: text }));
            markDirty(fileKey(id));
          }}
          onCardChange={cardOps.update}
          onCursor={setCursor}
          onActiveTabChange={setActiveTab}
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
          {sectionMeta[panelDrag.id].icon} {sectionMeta[panelDrag.id].title}
        </div>
      )}
      <StatusBar
        left={`📁 ${project.name}　｜　${status.left}`}
        right={status.right ? `${status.right}　｜　${saveLabel}` : saveLabel}
      />
      {settingsDialog}
      {schemaDialog && (
        <SchemaDialog
          key={schemaDialog}
          title={sectionMeta[schemaDialog].title}
          icon={sectionMeta[schemaDialog].icon}
          schema={schemas[schemaDialog]}
          specialFields={schemaDialog === 'commands' ? FIXED_COMMAND_FIELDS : []}
          onSave={(nameParam, edits) => saveSchema(schemaDialog, nameParam, edits)}
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
