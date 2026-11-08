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
import ImageViewerHost from './components/ImageViewer';
import MemoryViewerHost from './components/MemoryViewer';
import RubyPromptHost from './components/RubyPrompt';
import Icon, { fileIcon } from './components/Icon';
import QuickPick, { QuickPickItem } from './components/QuickPick';
import ProblemsPanel, { ProblemGroup } from './components/ProblemsPanel';
import BottomPanel, { PanelTab } from './components/BottomPanel';
import SearchPanel, { SearchState, emptySearch } from './components/SearchPanel';
import { SearchGroup, SearchHit, SearchMatch, SearchTarget, replaceAllInText, replaceOneInText } from './projectSearch';
import { playEdit } from './aiPlayback';
import { waitForPlayback } from './components/VnsPlayback';
import monaco from './monaco';
import type { DiskChanges } from './projectFiles';
import { dragWith, errorText, useKeys, useLatest, writeJSON } from './hooks';
import { AI_GUIDE_NAME, buildAiGuide } from './aiGuide';
import { buildProjectExport, exportFileName } from './exportProject';
import { FIXED_COMMAND_FIELDS, checkScript, migrateFormatField, revealInEditor, setScriptData } from './scriptLanguage';
import { SectionDef, SectionRemoval, cardSectionIds, getCardSections, sectionMeta, sectionOrder, setCardSections } from './sections';
import SectionsDialog from './components/SectionsDialog';
import { removeUnusedImages, setImageRoot } from './images';
import { remapMemories, scriptPath } from './memories';
import { applyTextMinimal, clearAllMarks, markCardChange, markFileChange, suspendMarks } from './changeMarks';
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
  assertProject,
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

const emptyCards = (): Record<CardSectionId, Card[]> => perSection(cardSectionIds(), () => [] as Card[]);
const emptyFolders = (): Record<SectionId, string[]> => ({ files: [], ...perSection(cardSectionIds(), () => [] as string[]) });

const fileKey = (id: string) => `file:${id}`;
const SAVE_DELAY = 1000; // 停止輸入多久後自動存檔（毫秒）

export interface FileOps {
  add: (folder: string, name: string) => string | null;
  rename: (id: string, name: string) => string | null;
  remove: (id: string) => void;
}

export interface FolderOps {
  create: (section: SectionId, parent: string, name: string) => Promise<string | null>;
  rename: (section: SectionId, folder: string, name: string) => Promise<string | null>;
  remove: (section: SectionId, folder: string) => Promise<void>;
}

export default function App() {
  const [layout, setLayout] = useState<Layout>(loadLayout);
  const leftVisible = !layout.leftCollapsed;
  const setLeftVisible = (v: boolean | ((visible: boolean) => boolean)) =>
    setLayout((l) => ({ ...l, leftCollapsed: !(typeof v === 'function' ? v(!l.leftCollapsed) : v) }));
  const settings = useSettings();
  const [showSettings, setShowSettings] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set()); // 被摺起來的資料夾（所有區塊共用，key 含區塊名）
  const [project, setProject] = useState<{ store: ProjectStore; name: string } | null>(null); // null = 顯示開始畫面
  const [cards, setCards] = useState(emptyCards);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const dockRef = useRef<EditorDockHandle>(null);
  const [contents, setContents] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<Record<string, { name: string; folder: string }>>({});
  const [folders, setFolders] = useState(emptyFolders);
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const [schemas, setSchemas] = useState<Schemas>(() => defaultSchemas(cardSectionIds()));
  const [, setSections] = useState<SectionDef[]>([]);
  const [schemaDialog, setSchemaDialog] = useState<CardSectionId | null>(null);
  const [sectionsDialog, setSectionsDialog] = useState(false);
  const [order, setOrder] = useState<ItemOrder>({});
  useEffect(() => setScriptData(cards, schemas), [cards, schemas]);
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
  const latest = useLatest({ project, files, contents, cards, dirty, activeTab });
  const flush = async (only?: string[]): Promise<string | null> => {
    const { project, files, contents, cards, dirty } = latest.current;
    const keys = [...dirty].filter((k) => !only || only.includes(k));
    if (!project || keys.length === 0) return null;
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
      const message = errorText(e);
      setDirty((d) => new Set([...d, ...keys]));
      setSaveState('error');
      setSaveError(message);
      return message;
    }
  };
  const flushRef = useLatest(flush);
  const saveActive = () => {
    const tab = latest.current.activeTab;
    if (tab) void flushRef.current([parseCardTab(tab) ? tab : fileKey(tab)]);
  };
  const saveActiveRef = useLatest(saveActive);
  useEffect(() => {
    const onSaveAll = () => void flushRef.current();
    window.addEventListener(SAVE_ALL_EVENT, onSaveAll);
    return () => window.removeEventListener(SAVE_ALL_EVENT, onSaveAll);
  }, []);
  const [help, setHelp] = useState<HelpTopic | null>(null);
  const [updateCheck, setUpdateCheck] = useState(0);
  const [quickPick, setQuickPick] = useState<string | null>(null);
  const [closePrompt, setClosePrompt] = useState(false);
  const [tabClose, setTabClose] = useState<{ tabId: string; resolve: (close: boolean) => void } | null>(null);
  const [conflict, setConflict] = useState<{ label: string; resolve: (takeTheirs: boolean) => void } | null>(null);
  useEffect(() => {
    if (dirty.size === 0 || !settings.autoSave || closePrompt || tabClose || conflict) return;
    const timer = setTimeout(() => flushRef.current(), SAVE_DELAY);
    return () => clearTimeout(timer);
  }, [dirty, contents, cards, files, settings.autoSave, closePrompt, tabClose, conflict]);
  useEffect(() => void window.api.setZoom(settings.uiZoom), [settings.uiZoom]);
  useEffect(() => {
    if (settings.theme === 'dark') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);
  useEffect(() => {
    document.documentElement.style.setProperty('--card-font-size', `${settings.cardFontSize}px`);
  }, [settings.cardFontSize]);
  const dirtyKeyOf = (tabId: string) => (parseCardTab(tabId) ? tabId : fileKey(tabId));
  const confirmTabClose = (tabId: string) =>
    latest.current.dirty.has(dirtyKeyOf(tabId))
      ? new Promise<boolean>((resolve) => setTabClose({ tabId, resolve }))
      : Promise.resolve(true);
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
  const playingRef = useRef(new Set<string>());
  const [flash, setFlash] = useState<{ tabId: string; keys: string[] } | null>(null);
  const askConflict = (label: string) => new Promise<boolean>((resolve) => setConflict({ label, resolve }));
  const setModelText = (fileId: string, text: string) => {
    const model = monaco.editor.getModels().find((m) => m.uri.path.replace(/^\//, '') === fileId);
    if (model) applyTextMinimal(model, text);
  };
  const applyFile = async (id: string, text: string) => {
    const { aiPlayback, aiSpeed } = getSettings();
    const oldText = latest.current.contents[id] ?? '';
    if (aiPlayback) {
      openTab(id);
      const target = await waitForPlayback(id);
      if (target) {
        playingRef.current.add(id);
        const resumeMarks = suspendMarks(id); // 播放中先不追蹤標記，播完由 markFileChange 重新算位置
        try {
          if (target.player) await target.player.play(text, aiSpeed);
          else await playEdit(target.editor!, target.editor!.getValue(), text, aiSpeed);
        } finally {
          playingRef.current.delete(id);
          resumeMarks();
        }
      }
    } else setModelText(id, text);
    setContents((c) => ({ ...c, [id]: text }));
    markFileChange(id, oldText, text);
  };
  const applyCard = async (section: CardSectionId, card: Card, isNew: boolean) => {
    const before = latest.current.cards[section].find((c) => c.id === card.id);
    markCardChange(cardTabId(section, card.id), before, card);
    setCards((all) => ({ ...all, [section]: isNew ? [...all[section], card] : all[section].map((c) => (c.id === card.id ? card : c)) }));
    if (!getSettings().aiPlayback) return;
    const keys = card.fields
      .filter((f) => before?.fields.find((b) => b.key === f.key)?.value !== f.value)
      .map((f) => f.key);
    if (!before || before.name !== card.name) keys.push('__name');
    if (!before || before.detail !== card.detail) keys.push('__detail');
    if (JSON.stringify(before?.memories ?? []) !== JSON.stringify(card.memories ?? [])) keys.push('__memories');
    const tabId = cardTabId(section, card.id);
    openTab(tabId);
    setFlash({ tabId, keys });
    await new Promise((r) => setTimeout(r, 1800));
    setFlash((f) => (f?.tabId === tabId ? null : f));
  };
  const applyChanges = async (ch: DiskChanges) => {
    const { dirty } = latest.current;
    setFolders(ch.folders);
    if (ch.meta) {
      setSchemas(ch.meta.schemas);
      setOrder(ch.meta.order);
    }
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
  const syncRef = useLatest(syncFromDisk);
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
          {(['用外面改的版本', '保留我的版本'] as const).map((label, i) => (
            <button key={label} type="button" className={`close-btn${i ? '' : ' primary'}`} onClick={() => (conflict.resolve(!i), setConflict(null))}>
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
  const cleanupImages = async () => {
    const { project, contents, cards, dirty } = latest.current;
    if (!project || dirty.size > 0) return;
    await removeUnusedImages(project.store.root, [JSON.stringify(cards), ...Object.values(contents)]);
  };
  const cleanupImagesRef = useLatest(cleanupImages);
  useEffect(() => {
    return window.api.onAppClosing(async () => {
      if (latest.current.dirty.size > 0) return setClosePrompt(true);
      await cleanupImagesRef.current();
      window.api.readyToClose();
    });
  }, []);
  const closeDialog = closePrompt && (
    <CloseDialog
      onSave={async () => {
        const error = await flushRef.current();
        if (!error) {
          await cleanupImages();
          window.api.readyToClose();
        }
        return error;
      }}
      onDiscard={() => window.api.readyToClose()}
      onCancel={() => setClosePrompt(false)}
    />
  );
  const togglePanel = (tab: PanelTab) =>
    setLayout((l) => (l.problemsOpen && l.panelTab === tab ? { ...l, problemsOpen: false } : { ...l, problemsOpen: true, panelTab: tab }));
  const togglePanelRef = useLatest(togglePanel);
  const [search, setSearch] = useState<SearchState>(emptySearch);
  const [searchFocus, setSearchFocus] = useState(0);
  const openSearch = () => {
    if (!latest.current.project) return;
    const editor = monaco.editor.getEditors().find((e) => e.hasTextFocus());
    const sel = editor?.getSelection();
    const picked = sel && !sel.isEmpty() && sel.startLineNumber === sel.endLineNumber ? editor?.getModel()?.getValueInRange(sel) : '';
    if (picked) setSearch((s) => ({ ...s, query: picked, regex: false }));
    setLayout((l) => ({ ...l, problemsOpen: true, panelTab: 'search' }));
    setSearchFocus((n) => n + 1);
  };
  const openSearchRef = useLatest(openSearch);
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
  const chord = useRef(0); // 按了 Ctrl+K 的時間：之後 1.5 秒內按 S = 全部存檔、按 Ctrl+\ = 向下分割
  useKeys((e) => {
    const key = e.key.toLowerCase();
    const inChord = Date.now() - chord.current < 1500;
    if (!e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && key === 's' && inChord) {
      chord.current = 0;
      return !(e.target as HTMLElement | null)?.closest?.('.monaco-editor') && (void flushRef.current(), true);
    }
    if (import.meta.env.PROD && (key === 'f5' || (e.ctrlKey && key === 'r'))) return true; // 正式版不能重新載入
    if (['control', 'shift', 'alt'].includes(key)) return false;
    chord.current = 0;
    if (!e.ctrlKey || e.altKey || e.metaKey) return false;
    if (!e.shiftKey && key === 'k') return void (chord.current = Date.now());
    const keys: Record<string, () => void> = e.shiftKey
      ? { m: () => togglePanelRef.current('problems'), f: () => openSearchRef.current(), p: () => setQuickPick('>'), n: () => void window.api.newWindow() }
      : {
          '\\': () => dockRef.current?.splitActive(inChord ? 'below' : 'right'),
          p: () => setQuickPick(''),
          b: () => setLeftVisible((v) => !v),
          s: () => saveActiveRef.current(),
          o: menu('open-project'),
          w: menu('close-tab'),
          ',': menu('open-settings'),
        };
    return keys[key] ? (keys[key](), true) : false;
  }, []);
  const reportError = (e: unknown) => {
    setSaveState('error');
    setSaveError(errorText(e));
  };
  const loadProject = (store: ProjectStore, data: ProjectData) => {
    dockRef.current?.saveLayout(); // 從別的專案切過來時，先把舊專案的版面存起來
    setCardSections(data.sections);
    setSections(data.sections);
    setLayout((l) => reconcileLayout(l, sectionOrder()));
    const ids = Object.keys(data.files);
    setFiles(Object.fromEntries(ids.map((id) => [id, { name: data.files[id].name, folder: data.files[id].folder }])));
    setFolders(data.folders);
    setContents(Object.fromEntries(ids.map((id) => [id, data.files[id].content])));
    const migrated: string[] = [];
    const commands = data.cards.commands.map((card) => {
      const next = migrateFormatField(card);
      if (!next) return card;
      migrated.push(cardTabId('commands', card.id));
      return next;
    });
    setCards({ ...data.cards, commands });
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
    setImageRoot(store.root); // 圖片的相對路徑都接在這個資料夾後面
    clearAllMarks(); // 上一個專案的「外部修改」標記不要帶過來
    window.api.watchProject(store.root).catch(reportError);
  };
  const [createKey, setCreateKey] = useState(0);
  const [startInCreate, setStartInCreate] = useState(false);
  const flushBeforeLeave = async (question: string) => {
    await flushRef.current();
    return !(latest.current.dirty.size > 0 && !window.confirm(question));
  };
  const closeProject = async (): Promise<boolean> => {
    if (!(await flushBeforeLeave('有內容存檔失敗，確定要關閉專案嗎？'))) return false;
    await cleanupImages();
    setStartInCreate(false);
    dockRef.current?.saveLayout(); // 編輯區即將卸載，先把版面存起來
    setProject(null);
    setImageRoot(null);
    clearAllMarks();
    setFiles({});
    setFolders(emptyFolders);
    setContents({});
    setCards(emptyCards);
    setActiveTab(null);
    setDirty(new Set());
    void window.api.releaseProject(); // 別的視窗就可以開這個專案了
    return true;
  };
  const openOpened = async ({ store, data }: { store: ProjectStore; data: ProjectData }) => {
    await rememberProject(data.name, store.root);
    loadProject(store, data);
  };
  const [statusNote, setStatusNote] = useState<string | null>(null);
  useEffect(() => {
    if (!statusNote) return;
    const timer = setTimeout(() => setStatusNote(null), 3000);
    return () => clearTimeout(timer);
  }, [statusNote]);
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
      window.alert(`打包失敗：${errorText(e)}`);
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
      window.alert(`匯出失敗：${errorText(e)}`);
    }
  };
  const onMenu = async (ev: MenuEvent) => {
    const leave = () => flushBeforeLeave('有內容存檔失敗，確定要離開目前的專案嗎？');
    const open = async (root: string | null) => root && (await window.api.claimProject(root)) && (await openOpened(await ProjectStore.open(root)));
    try {
      switch (ev.type) {
        case 'open-settings': return setShowSettings(true);
        case 'close-tab': return dockRef.current?.closeActive();
        case 'show-shortcuts': return setHelp('shortcuts');
        case 'show-syntax': return setHelp('syntax');
        case 'show-about': return setHelp('about');
        case 'check-update': return setUpdateCheck((n) => n + 1);
        case 'copy-for-ai': return void exportProject('copy');
        case 'export-project': return void exportProject('file');
        case 'pack-project': return void (await packProject());
        case 'close-project': return void (await closeProject());
        case 'new-project':
          if (!(await leave())) return;
          await closeProject();
          setStartInCreate(true);
          return setCreateKey((k) => k + 1);
        case 'open-project': {
          if (!(await leave())) return;
          const root = await pickFolder();
          if (root) await assertProject(root); // 不是專案的資料夾：不打開（錯誤訊息在下面的 catch 顯示）
          return void (await open(root));
        }
        case 'open-recent':
          if (!(await leave())) return;
          await openRecent(ev.path);
          await assertProject(ev.path);
          return void (await open(ev.path));
        case 'import-project':
          if (!(await leave())) return;
          return void (await open(await window.api.unpackProject()));
      }
    } catch (e) {
      window.alert(`發生錯誤：${errorText(e)}`);
    }
  };
  const onMenuRef = useLatest(onMenu);
  useEffect(() => window.api.onMenu((ev) => void onMenuRef.current(ev)), []);
  useEffect(() => writeJSON(LAYOUT_KEY, layout), [layout]);
  const existing = new Set(sectionOrder());
  const visibleIds = (ids: SectionId[]) => ids.filter((s) => existing.has(s) && !layout.hidden.includes(s));
  const leftSections = visibleIds(layout.left.sections);
  const rightSections = visibleIds(layout.right.sections);
  const floatPanels = layout.floating.filter((f) => existing.has(f.id) && !layout.hidden.includes(f.id));
  const showLeft = leftVisible && leftSections.length > 0;
  const showRight = rightSections.length > 0;
  const activeSections = sectionOrder().filter((s) => !layout.hidden.includes(s) && (layout.left.sections.includes(s) ? leftVisible : true));
  const toggleSection = (id: SectionId) => {
    if (activeSections.includes(id)) {
      setLayout((l) => ({ ...l, hidden: [...l.hidden, id] }));
    } else {
      setLayout((l) => ({ ...l, hidden: l.hidden.filter((s) => s !== id) }));
      if (layout.left.sections.includes(id)) setLeftVisible(true);
    }
  };
  const startWidthResize = (side: Side, e: React.MouseEvent) => {
    e.preventDefault();
    dragWith((ev) => {
      const w = side === 'left' ? ev.clientX - 48 : window.innerWidth - ev.clientX;
      setLayout((l) => ({ ...l, [side]: { ...l[side], width: Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, w)) } }));
    });
  };
  const patchFloat = (id: SectionId, patch: Partial<Layout['floating'][number]>) =>
    setLayout((l) => ({ ...l, floating: l.floating.map((f) => (f.id === id ? { ...f, ...patch } : f)) }));
  const bringToFront = (id: SectionId) =>
    setLayout((l) => {
      const z = Math.max(0, ...l.floating.map((f) => f.z)) + 1;
      return { ...l, floating: l.floating.map((f) => (f.id === id ? { ...f, z } : f)) };
    });
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
        if (!started && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return;
        started = true;
        hit = hitTestPanel(ev.clientX, ev.clientY, id, !float);
        if (float) {
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
          const w = Math.min(FLOAT_DEFAULT_W, layerRect.width);
          const h = Math.min(FLOAT_DEFAULT_H, layerRect.height);
          const x = Math.min(Math.max(0, ev.clientX - layerRect.left - 40), Math.max(0, layerRect.width - w));
          const y = Math.min(Math.max(0, ev.clientY - layerRect.top - 12), Math.max(0, layerRect.height - h));
          setLayout((l) => floatSection(l, id, { x, y, w: Math.max(FLOAT_MIN_W, w), h: Math.max(FLOAT_MIN_H, h) }));
        }
      },
    );
  };
  const openTab = (id: string) => dockRef.current?.open(id);
  const closeTabs = (ids: string[]) => dockRef.current?.closeTabs(ids);
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
  const nameError = (
    section: SectionId,
    folder: string,
    raw: string,
    candidate: string,
    dupMessage: string,
    except?: { id?: string; folder?: string },
  ) => validateName(raw) ?? (takenNames(section, folder, except).has(candidate.toLowerCase()) ? dupMessage : null);
  const cardNameError = (section: CardSectionId, folder: string, name: string, id?: string) => {
    if (name === '') return '請輸入名稱';
    return takenNames(section, folder, { id }).has((sanitizeName(name) + '.md').toLowerCase()) ? '已經有同名的項目' : null;
  };
  const saveSchema = (section: CardSectionId, nameParam: string, edits: SchemaEdit[], removals: FieldRemoval[] = []) => {
    const schema = edits.map(({ key, param, icon, color, type }) => ({
      key,
      ...(param && { param }),
      ...(icon && { icon }),
      ...(icon && color && { color }),
      ...(type && { type }),
    }));
    const renames = new Map(edits.filter((e) => e.from && e.from !== e.key).map((e) => [e.from!, e.key]));
    const removeMode = new Map(removals.map((r) => [r.key, r.mode]));
    const adjust = (fields: Card['fields']) => {
      const kept = fields.filter((f) => {
        const mode = removeMode.get(f.key);
        return !(mode === 'all' || (mode === 'empty' && f.value.trim() === ''));
      });
      return applySchema(kept.map((f) => (renames.has(f.key) ? { ...f, key: renames.get(f.key)! } : f)), schema);
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
  const saveSections = async (next: SectionDef[], removals: SectionRemoval[]) => {
    const store = latest.current.project?.store;
    if (!store) return;
    await flushRef.current();
    let loaded: Awaited<ReturnType<ProjectStore['updateSections']>>;
    try {
      loaded = await store.updateSections(next, removals);
    } catch (e) {
      window.alert(`區塊設定失敗：${errorText(e)}`);
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
  const remapAllMemories = (change: Parameters<typeof remapMemories>[1]) =>
    setCards((all) => {
      const r = remapMemories(all, change);
      for (const c of r.changed) markDirty(cardTabId(c.section, c.id));
      return r.changed.length ? r.cards : all;
    });
  const remapSources = (from: string, to: string, isFolder: boolean) =>
    remapAllMemories((m) => {
      if (m.source === from && !isFolder) return { ...m, source: to };
      if (isFolder && isInFolder(m.source, from)) return { ...m, source: to + m.source.slice(from.length) };
      return m;
    });
  const cardOps: CardOps = {
    open: (section, id) => openTab(cardTabId(section, id)),
    add: (section, folder, rawName) => {
      const name = rawName.trim();
      const err = cardNameError(section, folder, name);
      if (err) return err;
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
      const stillUsed = Object.values(cards).some((list) => list.some((c) => c.id !== id && c.name === card.name));
      if (!stillUsed) remapAllMemories((m) => (m.target === card.name ? { ...m, target: name } : m));
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
  const orderRef = useLatest(order);
  const commitOrder = (next: ItemOrder) => {
    orderRef.current = next;
    setOrder(next);
    latest.current.project?.store.saveOrder(next).catch(reportError);
  };
  const reorder = (section: SectionId, folder: string, names: string[]) => {
    const cur = orderRef.current;
    commitOrder({ ...cur, [section]: { ...cur[section], [folder]: names } });
  };
  const renameInOrder = (section: SectionId, folder: string, from: string, to: string) => {
    const list = orderRef.current[section]?.[folder];
    if (list?.includes(from)) reorder(section, folder, list.map((n) => (n === from ? to : n)));
  };
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
  const remapFolder = (section: SectionId, oldPath: string, newPath: string) => {
    const remap = (p: string) => (isInFolder(p, oldPath) ? newPath + p.slice(oldPath.length) : p);
    setFolders((f) => ({ ...f, [section]: f[section].map(remap) }));
    renameFolderInOrder(section, oldPath, newPath);
    if (section !== 'files') return setCards((all) => ({ ...all, [section]: all[section].map((c) => ({ ...c, folder: remap(c.folder ?? '') })) }));
    setFiles((all) => Object.fromEntries(Object.entries(all).map(([id, f]) => [id, { ...f, folder: remap(f.folder) }])));
    remapSources(oldPath, newPath, true);
  };
  const fileOps: FileOps = {
    add: (folder, rawName) => {
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
      remapSources(scriptPath(file), scriptPath({ ...file, name }), false);
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
  const showFolderError = (action: string, e: unknown) =>
    window.alert(`${action}失敗：${errorText(e)}`);
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
      await flushRef.current();
      try {
        remapFolder(section, folder, await latest.current.project!.store.renameFolder(section, folder, name));
      } catch (e) {
        showFolderError('重新命名資料夾', e);
      }
      return null;
    },
    remove: async (section, folder) => {
      const inside =
        section === 'files'
          ? Object.keys(files).filter((id) => isInFolder(files[id].folder, folder))
          : cards[section].filter((c) => isInFolder(c.folder ?? '', folder)).map((c) => c.id);
      const keys = inside.map((id) => (section === 'files' ? fileKey(id) : cardTabId(section, id)));
      const tabIds = inside.map((id) => (section === 'files' ? id : cardTabId(section, id)));
      const wasDirty = keys.filter((k) => dirty.has(k));
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
  const moveItem = async (section: SectionId, item: MoveItem, toFolder: string) => {
    const store = latest.current.project?.store;
    if (!store) return;
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
    await flushRef.current();
    try {
      if (item.kind === 'file') {
        await store.moveFile(item.id, toFolder);
        setFiles((all) => ({ ...all, [item.id]: { ...all[item.id], folder: toFolder } }));
        remapSources(scriptPath(files[item.id]), scriptPath({ ...files[item.id], folder: toFolder }), false);
      } else if (item.kind === 'card') {
        await store.moveCard(section as CardSectionId, item.id, toFolder);
        setCards((all) => ({ ...all, [section]: all[section as CardSectionId].map((c) => (c.id === item.id ? { ...c, folder: toFolder } : c)) }));
      } else {
        const newRel = await store.moveFolder(section, item.folder, toFolder);
        remapFolder(section, item.folder, newRel);
        setCollapsed((c) => remapFolderKeys(c, section, item.folder, newRel));
      }
      const targetKey = folderKey(section, toFolder);
      setCollapsed((c) => (c.has(targetKey) ? new Set([...c].filter((k) => k !== targetKey)) : c));
    } catch (e) {
      showFolderError('移動', e);
    }
  };
  const tabLabel = (tabId: string) => {
    const ref = parseCardTab(tabId);
    if (!ref) return files[tabId]?.name ?? '';
    return findCard(ref.section, ref.id)?.name || '（未命名）';
  };
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
    status = { left: files[activeTab]?.name ?? '', right: `行 ${cursor.line}，欄 ${cursor.column}　｜　字數 ${countChars(contents[activeTab])}` };
  }
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
          { id: 'toggle-problems', label: '打開／收起問題面板', keybinding: 'Ctrl+Shift+M', icon: 'error', run: () => togglePanel('problems') },
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
  // 有沒有開專案都會用到的對話框
  const common = (
    <>
      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
      {closeDialog}
      <UpdateDialog beforeInstall={() => flushRef.current()} manualCheck={updateCheck} />
      {help && <HelpDialog topic={help} onClose={() => setHelp(null)} />}
      <Tooltip />
      <ImageViewerHost />
      {quickPick !== null && <QuickPick key={quickPick} initial={quickPick} files={quickFiles} commands={quickCommands} onClose={() => setQuickPick(null)} />}
    </>
  );
  if (!project) {
    return (
      <>
        <WelcomeScreen key={createKey} startInCreateMode={startInCreate} onOpen={loadProject} />
        {common}
      </>
    );
  }
  const saveLabel = statusNote ??
    (saveState === 'error' ? `⚠ 存檔失敗：${saveError}` : saveState === 'saving' ? '儲存中…' : dirty.size > 0 ? '尚未儲存' : '已儲存');
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
  const dockZones: Side[] = panelDrag ? (['left', 'right'] as Side[]).filter((s) => !(s === 'left' ? showLeft : showRight)) : [];
  return (
    <div className="app">
      <div className="main" ref={mainRef}>
        <ActivityBar active={activeSections} onToggle={toggleSection} leftOpen={leftVisible} onToggleLeft={() => setLeftVisible((v) => !v)} />
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
            if (!playingRef.current.has(id)) markDirty(fileKey(id));
          }}
          onCardChange={cardOps.update}
          onCursor={setCursor}
          openTab={openTab}
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
        {dockZones.map((side) => (
          <div
            key={side}
            className={`dock-zone ${side}${panelDrag?.hit?.kind === 'dock' && panelDrag.hit.side === side ? ' hot' : ''}`}
            data-dock-zone={side}
          />
        ))}
      </div>
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
      {common}
      <MemoryViewerHost cards={cards} files={files} openTab={openTab} />
      <RubyPromptHost />
      {tabCloseDialog()}
      {conflictDialog}
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

const countChars = (text: string) => text.replace(/\s/g, '').length.toLocaleString();

type Box = { left: number; top: number; width: number; height: number };
type PanelHit =
  | { kind: 'dock'; side: Side; before: SectionId | null; mark: 'line' | 'zone'; rect: Box } // 放進側邊欄，插在 before 前面（null = 最後）
  | { kind: 'float'; mark: 'zone'; rect: Box }; // 變成浮動視窗
const boxOf = (r: DOMRect): Box => ({ left: r.left, top: r.top, width: r.width, height: r.height });

function hitTestPanel(x: number, y: number, dragId: SectionId, allowFloat: boolean): PanelHit | null {
  const inside = (r: DOMRect) => x >= r.left && x < r.right && y >= r.top && y < r.bottom;
  for (const side of ['left', 'right'] as Side[]) {
    const bar = document.querySelector<HTMLElement>(`.sidebar[data-side="${side}"]`);
    if (bar) {
      const r = bar.getBoundingClientRect();
      if (!inside(r)) continue;
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
