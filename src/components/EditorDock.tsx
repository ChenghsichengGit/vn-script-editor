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
  IDockviewHeaderActionsProps,
  IDockviewPanel,
  ReactContextMenuItemConfig,
  SerializedDockview,
  themeDark,
} from 'dockview-react';
import 'dockview-react/dist/styles/dockview.css';
import { Card, CardSectionId, Schemas, cardTabId, parseCardTab } from '../model';
import ScriptEditor from './ScriptEditor';
import VnsEditor from './VnsEditor';
import { useSettings } from '../settings';
import CardEditor from './CardEditor';
import type { MemoryLinks } from './MemoryPanel';
import { findTargetCard, scriptPath, targetIcon } from '../memories';
import Icon, { IconDef } from './Icon';
import { sectionDef } from '../sections';
import { useLatest, writeJSON } from '../hooks';

type PanelParams = { tabId: string };
const COMPONENT = 'editor';
const layoutKey = (root: string) => `vn-editor-dock:${root}`;

function tabPathKeys(files: Record<string, { name: string; folder: string }>, cards: Record<CardSectionId, Card[]>) {
  const join = (folder: string | undefined, name: string) => (folder ? `${folder}/${name}` : name);
  const keys = new Map<string, string>(); // 分頁 id → 路徑 key
  for (const [id, f] of Object.entries(files)) keys.set(id, `path:files:${join(f.folder, f.name)}`);
  for (const section of Object.keys(cards)) for (const c of cards[section]) keys.set(cardTabId(section, c.id), `path:${section}:${join(c.folder, c.name)}`);
  return keys;
}

function mapLayoutStrings(value: unknown, map: Map<string, string>): unknown {
  if (typeof value === 'string') {
    const m = /^(.*?)(~\d+)?$/.exec(value)!;
    const hit = map.get(m[1]);
    return hit ? hit + (m[2] ?? '') : value;
  }
  if (Array.isArray(value)) return value.map((v) => mapLayoutStrings(v, map));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [mapLayoutStrings(k, map) as string, mapLayoutStrings(v, map)]));
  return value;
}
const SAVE_DELAY = 300; // 版面一有變動，停多久後才寫進 localStorage（毫秒）

interface EditorCtxValue {
  flash: { tabId: string; keys: string[] } | null; // 剛被外部改過的設定卡和欄位（亮一下）
  files: Record<string, { name: string; folder: string }>;
  contents: Record<string, string>;
  cards: Record<CardSectionId, Card[]>;
  schemas: Schemas;
  activePanelId: string | null; // 目前作用中的面板（狀態列和游標追蹤都跟著它）
  isDirty: (tabId: string) => boolean;
  tabLabel: (tabId: string) => string;
  tabIcon: (tabId: string) => IconDef | null;
  onFileChange: (id: string, text: string) => void;
  onCardChange: (section: CardSectionId, id: string, patch: Partial<Card>) => void;
  onCursor: (pos: { line: number; column: number }) => void;
  openTab: (tabId: string) => void; // 打開（或切到）某個劇本或設定卡的分頁
}
const EditorCtx = createContext<EditorCtxValue | null>(null);

function EditorPanel({ api, params }: IDockviewPanelProps<PanelParams>) {
  const ctx = useContext(EditorCtx)!;
  const settings = useSettings();
  const { tabId } = params;
  const cardRef = parseCardTab(tabId);
  if (cardRef) {
    const card = ctx.cards[cardRef.section].find((c) => c.id === cardRef.id);
    if (!card) return null;
    const memory: MemoryLinks | undefined = sectionDef(cardRef.section)?.memory
      ? {
          targetNames: [...new Set(Object.values(ctx.cards).flatMap((list) => list.map((c) => c.name)))].filter((n) => n !== card.name),
          scripts: Object.values(ctx.files)
            .map((f) => ({ path: scriptPath(f), label: scriptPath(f).replace(/\.[^./]+$/, '') }))
            .sort((a, b) => a.path.localeCompare(b.path, 'zh-Hant')),
          hasTarget: (name) => !!findTargetCard(ctx.cards, name, cardRef.section),
          targetIcon: (name) => targetIcon(ctx.cards, name, cardRef.section),
          onOpenTarget: (name) => {
            const hit = findTargetCard(ctx.cards, name, cardRef.section);
            if (hit) ctx.openTab(cardTabId(hit.section, hit.card.id));
          },
          onOpenSource: (path) => {
            const id = Object.keys(ctx.files).find((k) => scriptPath(ctx.files[k]) === path);
            if (id) ctx.openTab(id);
          },
        }
      : undefined;
    return (
      <CardEditor
        memory={memory}
        card={card}
        isCommand={cardRef.section === 'commands'}
        schemaFields={ctx.schemas[cardRef.section].fields}
        flashKeys={ctx.flash?.tabId === tabId ? ctx.flash.keys : undefined}
        markKey={tabId}
        onChange={(patch) => ctx.onCardChange(cardRef.section, card.id, patch)}
      />
    );
  }
  if (!ctx.files[tabId]) return null;
  if (settings.richScript && /\.vns$/i.test(ctx.files[tabId].name))
    return <VnsEditor fileId={tabId} text={ctx.contents[tabId] ?? ''} onChange={(text) => ctx.onFileChange(tabId, text)} onCursor={ctx.onCursor} active={ctx.activePanelId === api.id} />;
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

let requestClose: (tabId: string | undefined, close: () => void) => Promise<boolean> = async (_tabId, close) => {
  close();
  return true;
};

function EditorTab({ api, params }: IDockviewPanelHeaderProps<PanelParams>) {
  const ctx = useContext(EditorCtx)!;
  const { tabId } = params;
  const icon = ctx.tabIcon(tabId);
  return (
    <div className="dv-default-tab" onAuxClick={(e) => e.button === 1 && (e.preventDefault(), void requestClose(tabId, () => api.close()))}>
      <span className="dv-default-tab-content">
        {icon && <Icon icon={icon} className="tab-icon" />}
        {ctx.tabLabel(tabId)}
      </span>
      {ctx.isDirty(tabId) && <span className="tab-dirty" title="尚未儲存">●</span>}
      <button
        type="button"
        className="dv-default-tab-action"
        aria-label="關閉"
        onPointerDown={(e) => e.preventDefault()} // 避免按 × 時被當成開始拖曳分頁
        onClick={(e) => {
          e.preventDefault();
          void requestClose(tabId, () => api.close());
        }}
      >
        ×
      </button>
    </div>
  );
}

const Watermark = () => <div className="empty" style={{ height: '100%' }}>從左側開啟劇本或設定卡</div>;

const components = { [COMPONENT]: EditorPanel };

const vnTheme: DockviewTheme = { ...themeDark, name: 'vn', className: 'dockview-theme-dark dockview-theme-vn' };

const tabIdOf = (p: { params?: unknown }) => (p.params as Partial<PanelParams> | undefined)?.tabId;
const panelsOf = (api: DockviewApi, tabId: string) => api.panels.filter((p) => tabIdOf(p) === tabId);

function addPanel(api: DockviewApi, tabId: string, title: string, position?: { referencePanel: string; direction: 'right' | 'below' }) {
  let id = tabId;
  for (let n = 2; api.getPanel(id); n++) id = `${tabId}~${n}`;
  api.addPanel<PanelParams>({ id, component: COMPONENT, title, params: { tabId }, position });
}

function splitPanel(api: DockviewApi, panel: IDockviewPanel, direction: 'right' | 'below') {
  const tabId = tabIdOf(panel);
  if (tabId) addPanel(api, tabId, panel.title ?? '', { referencePanel: panel.id, direction });
}

function GroupActions({ containerApi, activePanel }: IDockviewHeaderActionsProps) {
  if (!activePanel) return null;
  return (
    <div className="group-actions">
      <button type="button" className="icon-btn" data-tip="向右分割：在右邊再開一個這個檔案的畫面 (Ctrl+\)" onClick={() => splitPanel(containerApi, activePanel, 'right')}>
        <Icon icon="split-horizontal" />
      </button>
      <button type="button" className="icon-btn" data-tip="向下分割：在下面再開一個這個檔案的畫面 (Ctrl+K Ctrl+\)" onClick={() => splitPanel(containerApi, activePanel, 'below')}>
        <Icon icon="split-vertical" />
      </button>
    </div>
  );
}

function tabMenu({ panel, group, api }: GetTabContextMenuItemsParams): (BuiltInContextMenuItem | ReactContextMenuItemConfig)[] {
  const tabId = tabIdOf(panel);
  const closeAll = (keep?: string) => async () => {
    for (const p of group.panels.filter((x) => x.id !== keep)) {
      if (!(await requestClose(tabIdOf(p), () => p.api.close()))) return;
    }
  };
  return [
    { label: '關閉', action: () => void requestClose(tabId, () => panel.api.close()) },
    { label: '關閉群組內全部', action: closeAll() },
    'separator',
    { label: '變成浮動視窗', action: () => api.addFloatingGroup(panel), disabled: group.api.location.type === 'floating' },
  ];
}

export interface EditorDockHandle {
  open: (tabId: string) => void; // 開啟分頁；已經開著就直接切過去，不重複開
  closeTabs: (tabIds: string[]) => void; // 關掉這些分頁（所有群組裡顯示它們的面板）
  saveLayout: () => void; // 立刻把版面存起來（離開專案前呼叫）
  closeActive: () => void; // 關掉目前作用中的分頁（Ctrl+W）；沒有分頁就什麼都不做
  splitActive: (direction: 'right' | 'below') => void; // 把目前的分頁在右邊／下面再開一個畫面（Ctrl+\、Ctrl+K Ctrl+\）
}

type Props = Omit<EditorCtxValue, 'activePanelId'> & {
  rootPath: string; // 專案資料夾路徑：版面以它為 key 記在 localStorage
  onActiveTabChange: (tabId: string | null) => void; // 作用中的面板換了（沒有任何面板時是 null）
  confirmClose: (tabId: string) => Promise<boolean>; // 要關掉有沒存內容的分頁：問完回傳要不要關
  bottom?: React.ReactNode; // 編輯區下方的面板（問題面板）
};

const EditorDock = forwardRef<EditorDockHandle, Props>(function EditorDock(props, ref) {
  const apiRef = useRef<DockviewApi | null>(null);
  const [activePanelId, setActivePanelId] = useState<string | null>(null);
  const propsRef = useLatest(props);
  requestClose = async (tabId, close) => {
    const api = apiRef.current;
    const last = !!tabId && !!api && panelsOf(api, tabId).length === 1;
    if (last && !(await propsRef.current.confirmClose(tabId!))) return false;
    close();
    return true;
  };
  const cleanups = useRef<(() => void)[]>([]);
  const readyRef = useRef(false); // 還原完成後才開始記，避免還原過程中的半成品蓋掉舊版面
  const timerRef = useRef<number | undefined>(undefined);
  const writeLayout = () => {
    const api = apiRef.current;
    if (!api || !readyRef.current) return;
    const { rootPath, files, cards } = propsRef.current;
    writeJSON(layoutKey(rootPath), mapLayoutStrings(api.toJSON(), tabPathKeys(files, cards)));
  };
  const syncActive = () => {
    const panel = apiRef.current?.activePanel;
    setActivePanelId(panel?.id ?? null);
    propsRef.current.onActiveTabChange((panel && tabIdOf(panel)) || null);
  };
  const open = (tabId: string) => {
    const api = apiRef.current;
    if (!api) return;
    const existing = panelsOf(api, tabId);
    if (existing.length > 0) (existing.find((p) => p.group === api.activeGroup) ?? existing[0]).api.setActive();
    else addPanel(api, tabId, propsRef.current.tabLabel(tabId));
  };
  useImperativeHandle(ref, () => ({
    open,
    closeTabs: (tabIds) => [...(apiRef.current?.panels ?? [])].filter((p) => tabIds.includes(tabIdOf(p) ?? '')).forEach((p) => p.api.close()),
    saveLayout: writeLayout,
    closeActive: () => {
      const panel = apiRef.current?.activePanel;
      if (panel) void requestClose(tabIdOf(panel), () => panel.api.close());
    },
    splitActive: (direction) => {
      const api = apiRef.current;
      if (api?.activePanel) splitPanel(api, api.activePanel, direction);
    },
  }));
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
        const back = new Map([...tabPathKeys(files, cards)].map(([id, key]) => [key, id]));
        api.fromJSON(mapLayoutStrings(JSON.parse(raw), back) as SerializedDockview);
        restored = true;
        for (const p of [...api.panels]) if (!exists(tabIdOf(p) ?? '')) p.api.close();
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
  useEffect(
    () => () => {
      readyRef.current = false;
      window.clearTimeout(timerRef.current);
      cleanups.current.forEach((fn) => fn());
      apiRef.current = null;
    },
    [],
  );
  const ctx: EditorCtxValue = { ...props, activePanelId };
  return (
    <section className="editor-area">
      <EditorCtx.Provider value={ctx}>
        <div className="dock-host">
          <DockviewReact
            components={components}
            defaultTabComponent={EditorTab}
            watermarkComponent={Watermark}
            getTabContextMenuItems={tabMenu}
            rightHeaderActionsComponent={GroupActions}
            theme={vnTheme}
            onReady={onReady}
          />
        </div>
      </EditorCtx.Provider>
      {props.bottom}
    </section>
  );
});

export default EditorDock;
