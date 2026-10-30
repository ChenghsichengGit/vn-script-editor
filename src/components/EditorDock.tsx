import { createContext, forwardRef, useContext, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  BuiltInContextMenuItem,
  DockviewApi,
  DockviewReact,
  DockviewReadyEvent,
  DockviewTheme,
  GetTabContextMenuItemsParams,
  IDockviewPanelHeaderProps,
  IDockviewPanelProps,
  ReactContextMenuItemConfig,
  themeDark,
} from 'dockview-react';
import 'dockview-react/dist/styles/dockview.css';
import { Card, CardSectionId, Schemas, parseCardTab } from '../model';
import ScriptEditor from './ScriptEditor';
import CardEditor from './CardEditor';

// 編輯區：用 dockview 做 VS Code 式的分頁群組
// 分頁可以拖曳排序、拖到別的群組、拖到群組邊緣分割（左右或上下並排），也可以拉成浮動視窗
// 「開了哪些分頁、分在哪些群組」都由 dockview 管（App 不再自己記分頁清單），
// App 只透過 ref 呼叫 open / closeTabs，並從 onActiveTabChange 知道目前作用中的分頁

// 每個 dockview 面板的參數：它顯示的是哪個分頁（劇本檔案 id，或 card:區塊:id）
// 面板自己的 id 預設就是分頁 id；同一個檔案被使用者明確「分割」時，才會多一個 `分頁id~2` 這樣的面板
interface PanelParams {
  tabId: string;
}
const COMPONENT = 'editor';
const layoutKey = (root: string) => `vn-editor-dock:${root}`;
const SAVE_DELAY = 300; // 版面一有變動，停多久後才寫進 localStorage（毫秒）

// 面板和分頁標籤都由 dockview 建立，拿不到 App 的資料；改用 context 把資料傳進去
// （dockview-react 用 portal 畫面板，所以 context 傳得進來）
interface EditorCtxValue {
  files: Record<string, { name: string; folder: string }>;
  contents: Record<string, string>;
  cards: Record<CardSectionId, Card[]>;
  schemas: Schemas;
  activePanelId: string | null; // 目前作用中的面板（狀態列和游標追蹤都跟著它）
  isDirty: (tabId: string) => boolean;
  tabLabel: (tabId: string) => string;
  onFileChange: (id: string, text: string) => void;
  onCardChange: (section: CardSectionId, id: string, patch: Partial<Card>) => void;
  onCursor: (pos: { line: number; column: number }) => void;
}
const EditorCtx = createContext<EditorCtxValue | null>(null);

// ── 面板內容 ──────────────────────────────

// 一個面板 = 一個劇本編輯器或一張設定卡的編輯頁
// 檔案或卡片已經被刪掉（面板馬上就會被關掉）時，先什麼都不畫
function EditorPanel({ api, params }: IDockviewPanelProps<PanelParams>) {
  const ctx = useContext(EditorCtx)!;
  const { tabId } = params;
  const cardRef = parseCardTab(tabId);

  if (cardRef) {
    const card = ctx.cards[cardRef.section].find((c) => c.id === cardRef.id);
    if (!card) return null;
    return (
      <CardEditor
        card={card}
        isCommand={cardRef.section === 'commands'}
        lockedKeys={ctx.schemas[cardRef.section].fields.map((f) => f.key)}
        onChange={(patch) => ctx.onCardChange(cardRef.section, card.id, patch)}
      />
    );
  }
  if (!ctx.files[tabId]) return null;
  return (
    <ScriptEditor
      fileId={tabId}
      initialText={ctx.contents[tabId] ?? ''}
      onChange={(text) => ctx.onFileChange(tabId, text)}
      onCursor={ctx.onCursor}
      active={ctx.activePanelId === api.id}
      fileName={ctx.files[tabId].name}
    />
  );
}

// 分頁標籤：標題、還沒存檔的圓點、關閉鈕。沿用 dockview 預設分頁的 class，樣式和拖曳行為才會一致
function EditorTab({ api, params }: IDockviewPanelHeaderProps<PanelParams>) {
  const ctx = useContext(EditorCtx)!;
  const { tabId } = params;
  return (
    <div
      className="dv-default-tab"
      // 滑鼠中鍵關閉分頁（和 VS Code 一樣）
      onAuxClick={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          api.close();
        }
      }}
    >
      <span className="dv-default-tab-content">{ctx.tabLabel(tabId)}</span>
      {ctx.isDirty(tabId) && (
        <span className="tab-dirty" title="尚未儲存">
          ●
        </span>
      )}
      <button
        type="button"
        className="dv-default-tab-action"
        aria-label="關閉"
        onPointerDown={(e) => e.preventDefault()} // 避免按 × 時被當成開始拖曳分頁
        onClick={(e) => {
          e.preventDefault();
          api.close();
        }}
      >
        ×
      </button>
    </div>
  );
}

// 沒有任何分頁時顯示的提示
function Watermark() {
  return (
    <div className="empty" style={{ height: '100%' }}>
      從左側開啟劇本或設定卡
    </div>
  );
}

// 注意：這幾個物件／函式要放在元件外面，保持同一個參考，dockview 才不會一直重建
const components = { [COMPONENT]: EditorPanel };

// 配色：以 dockview 的深色主題為底，再用 styles.css 的 .dockview-theme-vn 換成 VS Code 的顏色
const vnTheme: DockviewTheme = { ...themeDark, name: 'vn', className: 'dockview-theme-dark dockview-theme-vn' };

// ── 對 dockview 的操作 ──────────────────────────────

const tabIdOf = (p: { params?: unknown }) => (p.params as Partial<PanelParams> | undefined)?.tabId;
const panelsOf = (api: DockviewApi, tabId: string) => api.panels.filter((p) => tabIdOf(p) === tabId);

// 新增一個面板顯示某個分頁。direction / referencePanel 有給就開在那個面板旁邊（分割），沒給就放進目前的群組
function addPanel(
  api: DockviewApi,
  tabId: string,
  title: string,
  position?: { referencePanel: string; direction: 'right' | 'below' },
) {
  // 面板 id 不能重複：分頁 id 被用掉了（分割出來的第二個畫面）就加編號
  let id = tabId;
  for (let n = 2; api.getPanel(id); n++) id = `${tabId}~${n}`;
  api.addPanel<PanelParams>({ id, component: COMPONENT, title, params: { tabId }, position });
}

// 右鍵選單：關閉、分割、變浮動視窗。全部自己寫成中文（內建項目的文字是英文）
function tabMenu({ panel, group, api }: GetTabContextMenuItemsParams): (BuiltInContextMenuItem | ReactContextMenuItemConfig)[] {
  const tabId = tabIdOf(panel);
  const split = (direction: 'right' | 'below') => () =>
    tabId && addPanel(api, tabId, panel.title ?? '', { referencePanel: panel.id, direction });
  const closeAll = (keep?: string) => () => group.panels.filter((p) => p.id !== keep).forEach((p) => p.api.close());
  return [
    { label: '關閉', action: () => panel.api.close() },
    { label: '關閉其他', action: closeAll(panel.id), disabled: group.panels.length < 2 },
    { label: '關閉群組內全部', action: closeAll() },
    'separator',
    // 同一個檔案分割成兩個畫面：Monaco 以檔案 id 共用同一份內容，兩邊會即時同步
    { label: '向右分割', action: split('right') },
    { label: '向下分割', action: split('below') },
    'separator',
    {
      label: '變成浮動視窗',
      action: () => api.addFloatingGroup(panel),
      disabled: group.api.location.type === 'floating',
    },
  ];
}

// ── 元件本體 ──────────────────────────────

// App 能呼叫的操作
export interface EditorDockHandle {
  open: (tabId: string) => void; // 開啟分頁；已經開著就直接切過去，不重複開
  closeTabs: (tabIds: string[]) => void; // 關掉這些分頁（所有群組裡顯示它們的面板）
  saveLayout: () => void; // 立刻把版面存起來（離開專案前呼叫）
}

interface Props {
  rootPath: string; // 專案資料夾路徑：版面以它為 key 記在 localStorage
  files: EditorCtxValue['files'];
  contents: EditorCtxValue['contents'];
  cards: EditorCtxValue['cards'];
  schemas: EditorCtxValue['schemas'];
  isDirty: EditorCtxValue['isDirty'];
  tabLabel: EditorCtxValue['tabLabel'];
  onFileChange: EditorCtxValue['onFileChange'];
  onCardChange: EditorCtxValue['onCardChange'];
  onCursor: EditorCtxValue['onCursor'];
  onActiveTabChange: (tabId: string | null) => void; // 作用中的面板換了（沒有任何面板時是 null）
}

const EditorDock = forwardRef<EditorDockHandle, Props>(function EditorDock(props, ref) {
  const apiRef = useRef<DockviewApi | null>(null);
  const [activePanelId, setActivePanelId] = useState<string | null>(null);

  // dockview 的事件只訂閱一次，所以事件裡要用的東西都從 ref 讀最新的
  const propsRef = useRef(props);
  propsRef.current = props;
  const cleanups = useRef<(() => void)[]>([]);

  // ── 版面記憶（每個專案各一份）──
  const readyRef = useRef(false); // 還原完成後才開始記，避免還原過程中的半成品蓋掉舊版面
  const timerRef = useRef<number | undefined>(undefined);
  const writeLayout = () => {
    const api = apiRef.current;
    if (!api || !readyRef.current) return;
    try {
      localStorage.setItem(layoutKey(propsRef.current.rootPath), JSON.stringify(api.toJSON()));
    } catch {
      /* 存不了就算了，不影響使用 */
    }
  };

  // 目前作用中的面板（作用中群組的作用中分頁）通知出去：App 用它決定狀態列和側邊欄的反白
  const syncActive = () => {
    const panel = apiRef.current?.activePanel;
    setActivePanelId(panel?.id ?? null);
    propsRef.current.onActiveTabChange((panel && tabIdOf(panel)) || null);
  };

  const open = (tabId: string) => {
    const api = apiRef.current;
    if (!api) return;
    const existing = panelsOf(api, tabId);
    if (existing.length > 0) {
      // 已經開著：切過去。同一個檔案有多個畫面時，優先選目前群組裡的那個
      (existing.find((p) => p.group === api.activeGroup) ?? existing[0]).api.setActive();
    } else {
      addPanel(api, tabId, propsRef.current.tabLabel(tabId));
    }
  };

  useImperativeHandle(ref, () => ({
    open,
    closeTabs: (tabIds) => {
      const api = apiRef.current;
      if (!api) return;
      const gone = new Set(tabIds);
      // 先複製一份再關：關閉會改動 api.panels
      for (const p of [...api.panels]) {
        const id = tabIdOf(p);
        if (id && gone.has(id)) p.api.close();
      }
    },
    saveLayout: writeLayout,
  }));

  // dockview 建好了：還原這個專案上次的版面；失敗或沒有記錄就開第一個劇本
  const onReady = ({ api }: DockviewReadyEvent) => {
    apiRef.current = api;
    const { rootPath, files, cards, tabLabel } = propsRef.current;
    const exists = (tabId: string) => {
      const card = parseCardTab(tabId);
      return card ? cards[card.section].some((c) => c.id === card.id) : tabId in files;
    };

    let restored = false;
    try {
      const raw = localStorage.getItem(layoutKey(rootPath));
      if (raw) {
        api.fromJSON(JSON.parse(raw));
        restored = true;
        // 檔案或卡片已經不存在（被刪、被改名搬走）的面板直接關掉；群組空了 dockview 會自己移除
        for (const p of [...api.panels]) {
          const id = tabIdOf(p);
          if (!id || !exists(id)) p.api.close();
        }
      }
    } catch {
      api.clear(); // 記錄壞了：清乾淨，走下面的預設做法
    }
    if (!restored) {
      const first = Object.keys(files)[0];
      if (first) addPanel(api, first, tabLabel(first));
    }

    readyRef.current = true;
    syncActive();
    writeLayout();

    // 作用中的面板、面板增減、載入版面都要通知；版面有任何變動（含拖曳、分割、調整分隔線）就延遲存檔
    const subs = [
      api.onDidActivePanelChange(syncActive),
      api.onDidActiveGroupChange(syncActive),
      api.onDidAddPanel(syncActive),
      api.onDidRemovePanel(syncActive),
      api.onDidLayoutChange(() => {
        window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(writeLayout, SAVE_DELAY);
      }),
    ];
    cleanups.current.push(() => subs.forEach((s) => s.dispose()));
  };

  // 離開（關閉專案或換專案）：先停止訂閱，並讓還沒寫的版面不要再寫（App 會在離開前呼叫 saveLayout）
  useEffect(
    () => () => {
      readyRef.current = false;
      window.clearTimeout(timerRef.current);
      cleanups.current.forEach((fn) => fn());
      apiRef.current = null;
    },
    [],
  );

  const ctx: EditorCtxValue = {
    files: props.files,
    contents: props.contents,
    cards: props.cards,
    schemas: props.schemas,
    activePanelId,
    isDirty: props.isDirty,
    tabLabel: props.tabLabel,
    onFileChange: props.onFileChange,
    onCardChange: props.onCardChange,
    onCursor: props.onCursor,
  };

  // .editor-area 是「拖曳區塊變浮動視窗」的放置目標，要維持這個 class
  return (
    <section className="editor-area">
      <EditorCtx.Provider value={ctx}>
        <div className="dock-host">
          <DockviewReact
            components={components}
            defaultTabComponent={EditorTab}
            watermarkComponent={Watermark}
            getTabContextMenuItems={tabMenu}
            theme={vnTheme}
            onReady={onReady}
          />
        </div>
      </EditorCtx.Provider>
    </section>
  );
});

export default EditorDock;
