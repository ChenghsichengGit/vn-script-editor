// 劇本、設定卡（角色、世界觀、指令…）區塊：和資源一樣的單欄樹（共用 TreeKit）
//   上面工具列：＋▾（新增，加在選到的位置）、搜尋；最下面一條路徑列
//   點一下選取（Ctrl／Shift 多選），點兩下或 Enter 打開分頁；←→ 收合（卡片先管欄位、再管子卡片）、↑↓ 移動、F2 改名、Delete 刪除、空白鍵 = 展開／收起卡片的欄位
//   拖曳：放在列的上半／下半 = 排在它前面／後面，放在資料夾（或有子卡片的卡）中間 = 放進去；選了好幾個可以一起拖
import { Fragment, useEffect, useRef, useState } from 'react';
import type { FileOps, FolderOps } from '../App';
import { Card, CardOps, CardSectionId, ItemOrder, Schemas, SectionId, folderOrderKey, orderEntries, parseCardTab } from '../model';
import { COMMANDS_ID, sectionMeta } from '../sections';
import type { SceneInfo } from '../scene';
import type { AssetTree } from '../assets';
import { targetIcon } from '../memories';
import { childFolderOf, findChildFolder, folderBase, isInFolder, joinFolder, parentFolder } from '../projectFiles';
import CardItem from './CardItem';
import ContextMenu, { ContextMenuItem, SEP } from './ContextMenu';
import NameInput from './NameInput';
import Icon, { fileIcon } from './Icon';
import { hasMarks, useChangeMarks } from '../changeMarks';
import { openCardViewer } from './MemoryViewer';
import { PathBar, SearchHead, TreeArrow, TreeToolbar, useTreeNav } from './TreeKit';

// 卡片右鍵：固定到本場／從本場移除（有打開劇本、不是指令卡才有）
export function pinItem(scene: SceneInfo, section: CardSectionId, name: string): ContextMenuItem[] {
  if (!scene.path || section === COMMANDS_ID || !name.trim()) return [];
  const pinned = scene.isPinned(name);
  return [{ label: pinned ? '從本場移除' : '固定到本場', onClick: () => scene.togglePin(name) }];
}

const INDENT = 14; // 每深一層資料夾縮排多少像素
const EXPAND_DELAY = 600; // 拖著東西停在摺起來的資料夾上多久（毫秒）就自動展開
const NO_BULK = { show: false, tick: 0 }; // 卡片的欄位由這裡管，CardItem 自己的「全部展開」不用

const rowPad = (depth: number) => 4 + depth * INDENT;
const byName = (a: string, b: string) => a.localeCompare(b, 'zh-Hant');

type MenuTarget =
  | { kind: 'file'; id: string }
  | { kind: 'card'; section: CardSectionId; id: string }
  | { kind: 'folder'; section: SectionId; folder: string }
  | { kind: 'root' }; // 標題列或空白處：區塊的最上層
type Editing =
  | { mode: 'create'; section: SectionId; parent: string; what: 'item' | 'folder' }
  | { mode: 'rename'; kind: 'file'; id: string }
  | { mode: 'rename'; kind: 'card'; section: CardSectionId; id: string }
  | { mode: 'rename'; kind: 'folder'; section: SectionId; folder: string };
export type MoveItem = { kind: 'file'; id: string } | { kind: 'card'; id: string } | { kind: 'folder'; folder: string };

export const folderKey = (section: SectionId, folder: string) => `${section}:${folder}`;

// 資料夾改名或搬走後，摺疊記號跟著換成新路徑（底下各層也是）
export function remapFolderKeys(c: Set<string>, section: SectionId, oldPath: string, newPath: string): Set<string> {
  const [oldKey, newKey] = [folderKey(section, oldPath), folderKey(section, newPath)];
  return new Set([...c].map((key) => (key === oldKey || key.startsWith(oldKey + '/') ? newKey + key.slice(oldKey.length) : key)));
}

let dragItem: { section: SectionId; items: MoveItem[] } | null = null;

export interface TreeProps {
  files: Record<string, { name: string; folder: string }>;
  fileOps: FileOps;
  folders: Record<SectionId, string[]>;
  folderOps: FolderOps;
  cards: Record<CardSectionId, Card[]>;
  cardOps: CardOps;
  activeTab: string | null;
  onOpenFile: (id: string) => void;
  collapsed: Set<string>; // 摺疊狀態放在 App：區塊搬到別處（畫面重建）時不會忘記
  setCollapsed: React.Dispatch<React.SetStateAction<Set<string>>>;
  onMove: (section: SectionId, item: MoveItem, toFolder: string) => Promise<unknown>; // 拖曳放開時呼叫
  order: ItemOrder; // 自訂順序
  onReorder: (section: SectionId, folder: string, names: string[]) => void; // 某個資料夾裡的項目改成這個順序
  onHeaderDrag: (id: SectionId, e: React.MouseEvent) => void; // 按住標題列開始搬動整個區塊
  onEditSchema: (section: CardSectionId) => void; // 打開某個設定卡區塊的「欄位設定」
  schemas: Schemas; // 欄位範本：設定卡展開時，欄位名稱前面畫範本設定的圖示
  folded: SectionId[]; // 摺疊成只剩標題列的區塊
  onFold: (id: SectionId, fold: boolean) => void;
  scene: SceneInfo; // 「本場」：目前劇本、列出的卡、手動固定
  stacks: StackOps; // 疊成標籤的區塊
  assets: AssetTree; // 「資源」：專案「資源/」資料夾讀出來的樹
  projectRoot: string;
  onRescanAssets: () => void;
}

export interface StackOps {
  members: (host: SectionId) => SectionId[]; // 這一疊要顯示的標籤（已經排除被隱藏的）
  shown: (host: SectionId) => SectionId; // 這一疊現在顯示的區塊
  pick: (host: SectionId, id: SectionId) => void; // 點標籤切換
  onTabDrag: (id: SectionId, e: React.MouseEvent) => void; // 按住標籤拖：只拖這一個區塊
}

// 標題列：疊了好幾個區塊就畫成一排標籤，只有一個就照舊畫標題
export function SectionTitle({ id, slot, stacks, title, tip }: { id: SectionId; slot: SectionId; stacks: StackOps; title: React.ReactNode; tip?: string }) {
  const members = stacks.members(slot);
  if (members.length < 2) return <span className="section-title" title={tip}>{title}</span>;
  return (
    <span className="section-tabs">
      {members.map((m) => (
        <span
          key={m}
          className={`section-tab${m === id ? ' on' : ''}`}
          data-tab={m}
          title={m === id ? tip : `切換到「${sectionMeta(m).title}」（按住可以拖曳）`}
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            e.stopPropagation(); // 不要變成拖整疊
            stacks.onTabDrag(m, e);
          }}
          onClick={() => m !== id && stacks.pick(slot, m)}
        >
          {sectionMeta(m).title}
        </span>
      ))}
    </span>
  );
}

interface Props extends TreeProps {
  id: SectionId;
  fill?: boolean; // 填滿剩下的空間（側邊欄最下面那塊、浮動視窗）
  height?: number; // 固定高度（fill 時不用）
  floating?: boolean; // 在浮動視窗裡：標題列就是視窗的標題列
  short?: boolean; // 摺疊：只剩標題列
  slot?: SectionId; // 疊成標籤時佔位的區塊（拖標題列空白處 = 拖整疊）；沒疊 = 自己
}

// 標題列最前面的摺疊鈕（浮動視窗裡沒有）
export function FoldButton({ id, folded, onFold }: { id: SectionId; folded: boolean; onFold: (id: SectionId, fold: boolean) => void }) {
  return (
    <button className="icon-btn section-fold" data-tip={folded ? '展開這個區塊' : '摺疊成只剩標題列'} onClick={() => onFold(id, !folded)}>
      <Icon icon={folded ? 'chevron-right' : 'chevron-down'} />
    </button>
  );
}

// 樹裡的一列（鍵盤移動、選取用）；id：資料夾 = folder:路徑，劇本 = 檔案 id，卡片 = 卡片 id
type Nav = { id: string; depth: number; kids?: boolean; open?: boolean };
type Row =
  | (Nav & { kind: 'folder'; folder: string })
  | (Nav & { kind: 'file'; fileId: string; file: { name: string; folder: string } })
  | (Nav & { kind: 'card'; card: Card; kidsFolder: string });

export default function SectionPanel(props: Props) {
  useChangeMarks(); // 「外部修改」的黃點一變就重畫
  const { id, collapsed, setCollapsed } = props;
  const meta = sectionMeta(id);
  const isFiles = id === 'files';
  const cardSection = id as CardSectionId;
  const cards = isFiles ? [] : props.cards[cardSection];
  const [bulk, setBulk] = useState(false); // 「全部展開」按過了
  const [bodies, setBodies] = useState<Set<string>>(new Set()); // 欄位展開著的卡片
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [dropFolder, setDropFolder] = useState<string | null>(null);
  const [dropLine, setDropLine] = useState<{ key: string; after: boolean } | null>(null);
  const hover = useRef<{ folder: string; timer: number } | null>(null);
  const q = query.trim().toLowerCase();
  const searching = q !== '';

  // ───── 展開／收起（collapsed 裡有 key = 收起來） ─────
  const setFolderOpen = (folder: string, open?: boolean) =>
    setCollapsed((c) => {
      const key = folderKey(id, folder);
      const want = open ?? c.has(key);
      if (want !== c.has(key)) return c;
      const next = new Set(c);
      if (want) next.delete(key);
      else next.add(key);
      return next;
    });
  const expandFolder = (folder: string) => setFolderOpen(folder, true);
  // 一次設定很多資料夾（Alt＋點：底下全部一起；顯示某一項：一路展開上去）
  const setFoldersOpen = (list: string[], open: boolean) =>
    setCollapsed((c) => {
      let next: Set<string> | null = null;
      for (const f of list) {
        const key = folderKey(id, f);
        if (open !== c.has(key)) continue;
        next ??= new Set(c);
        if (open) next.delete(key);
        else next.add(key);
      }
      return next ?? c;
    });
  const setOpenDeep = (folder: string, open: boolean) =>
    setFoldersOpen([folder, ...props.folders[id].filter((f) => f !== folder && isInFolder(f, folder))], open);
  const revealFolder = (folder: string) => {
    const segs = folder.split('/').filter(Boolean);
    setFoldersOpen(segs.map((_, i) => segs.slice(0, i + 1).join('/')), true);
  };
  const toggleBody = (cardId: string, open?: boolean) =>
    setBodies((b) => {
      const want = open ?? !b.has(cardId);
      if (want === b.has(cardId)) return b;
      const next = new Set(b);
      if (want) next.add(cardId);
      else next.delete(cardId);
      return next;
    });
  const toggleBulk = () => {
    const show = !bulk;
    setBulk(show);
    setBodies(show ? new Set(cards.map((c) => c.id)) : new Set());
  };
  const startCreate = (parent: string, what: 'item' | 'folder') => {
    if (props.folded.includes(id)) props.onFold(id, false);
    setQuery('');
    revealFolder(parent);
    setEditing({ mode: 'create', section: id, parent, what });
  };

  // ───── 樹的內容 ─────
  type Item = [string, { name: string; folder: string }] | Card;
  const owned = new Set(cards.map((c) => childFolderOf(c).toLowerCase())); // 卡片的子卡片資料夾：畫在卡片底下，不當成資料夾列出
  const entriesIn = (folder: string) => {
    const subs = props.folders[id].filter((f) => parentFolder(f) === folder && !owned.has(f.toLowerCase()));
    const items: Item[] = isFiles ? Object.entries(props.files).filter(([, f]) => f.folder === folder) : cards.filter((c) => (c.folder ?? '') === folder);
    const nameOf = (it: Item) => (Array.isArray(it) ? it[1].name : it.name);
    return orderEntries(subs, items, nameOf, props.order[id]?.[folder]).map((e) =>
      e.kind === 'folder'
        ? { ...e, key: folderOrderKey(e.folder), rowKey: `folder:${e.folder}` }
        : { ...e, key: nameOf(e.item), rowKey: Array.isArray(e.item) ? e.item[0] : e.item.id },
    );
  };
  const namesIn = (folder: string) => entriesIn(folder).map((e) => e.key);
  const hasChildren = (folder: string) => entriesIn(folder).length > 0 || (editing?.mode === 'create' && editing.parent === folder);
  const kidsFolderOf = (card: Card) => findChildFolder(props.folders[id], card) ?? childFolderOf(card); // 還沒有子卡片時是「將來會建的」資料夾
  const rows: Row[] = [];
  if (searching) {
    const where = (folder: string, name: string) => `${folder}/${name}`;
    if (isFiles) {
      for (const [fileId, file] of Object.entries(props.files)) {
        if (file.name.toLowerCase().includes(q)) rows.push({ kind: 'file', id: fileId, depth: 0, fileId, file });
      }
      rows.sort((a, b) => (a.kind === 'file' && b.kind === 'file' ? byName(where(a.file.folder, a.file.name), where(b.file.folder, b.file.name)) : 0));
    } else {
      for (const card of cards) {
        if (card.name.toLowerCase().includes(q)) rows.push({ kind: 'card', id: card.id, depth: 0, card, kidsFolder: kidsFolderOf(card) });
      }
      rows.sort((a, b) => (a.kind === 'card' && b.kind === 'card' ? byName(where(a.card.folder ?? '', a.card.name), where(b.card.folder ?? '', b.card.name)) : 0));
    }
  } else {
    const walk = (folder: string, depth: number) => {
      for (const e of entriesIn(folder)) {
        if (e.kind === 'folder') {
          const open = !collapsed.has(folderKey(id, e.folder));
          rows.push({ kind: 'folder', id: `folder:${e.folder}`, depth, folder: e.folder, kids: hasChildren(e.folder), open });
          if (open) walk(e.folder, depth + 1);
        } else if (Array.isArray(e.item)) {
          rows.push({ kind: 'file', id: e.item[0], depth, fileId: e.item[0], file: e.item[1] });
        } else {
          const card = e.item;
          const kidsFolder = kidsFolderOf(card);
          const kids = hasChildren(kidsFolder);
          const open = !collapsed.has(folderKey(id, kidsFolder));
          rows.push({ kind: 'card', id: card.id, depth, card, kidsFolder, kids, open });
          if (kids && open) walk(kidsFolder, depth + 1);
        }
      }
    };
    walk('', 0);
  }
  const rowMap = new Map(rows.map((r) => [r.id, r]));
  const rowById = (rid: string | null) => (rid ? rowMap.get(rid) : undefined);
  const folderOfRow = (r: Row) => (r.kind === 'folder' ? parentFolder(r.folder) : r.kind === 'file' ? r.file.folder : r.card.folder ?? '');
  const nameOfRow = (r: Row) => (r.kind === 'folder' ? folderBase(r.folder) : r.kind === 'file' ? r.file.name : r.card.name || '（未命名）');

  // ───── 打開、改名、刪除 ─────
  const toggleRow = (row: Row, open: boolean, alt: boolean) => {
    const folder = row.kind === 'folder' ? row.folder : row.kind === 'card' ? row.kidsFolder : null;
    if (folder === null) return;
    if (alt) setOpenDeep(folder, open);
    else setFolderOpen(folder, open);
  };
  const activate = (row: Row) => {
    if (row.kind === 'file') props.onOpenFile(row.fileId);
    else if (row.kind === 'card') props.cardOps.open(cardSection, row.card.id);
    else toggleRow(row, !row.open, false);
  };
  const startRename = (row: Row) => {
    if (row.kind === 'file') setEditing({ mode: 'rename', kind: 'file', id: row.fileId });
    else if (row.kind === 'card') setEditing({ mode: 'rename', kind: 'card', section: cardSection, id: row.card.id });
    else setEditing({ mode: 'rename', kind: 'folder', section: id, folder: row.folder });
  };
  const itemOf = (rid: string): MoveItem => (rid.startsWith('folder:') ? { kind: 'folder', folder: rid.slice(7) } : isFiles ? { kind: 'file', id: rid } : { kind: 'card', id: rid });
  // 拖曳中的東西現在在哪個資料夾、在順序清單裡叫什麼（資料夾是「名稱/」）
  const infoOf = (item: MoveItem) => {
    if (item.kind === 'folder') return { folder: parentFolder(item.folder), name: folderOrderKey(item.folder) };
    const it = item.kind === 'file' ? props.files[item.id] : cards.find((c) => c.id === item.id);
    return { folder: it?.folder ?? '', name: it?.name ?? '' };
  };
  // 選到的東西（照樹上的順序），已經包在選到的資料夾／卡片底下的不重複算
  const topItems = (ids: Iterable<string>) => {
    const set = new Set(ids);
    const items = rows.filter((r) => set.has(r.id)).map((r) => itemOf(r.id));
    const holders = items.flatMap((i) => {
      if (i.kind === 'folder') return [i.folder];
      const card = i.kind === 'card' ? cards.find((c) => c.id === i.id) : undefined;
      return card ? [kidsFolderOf(card)] : [];
    });
    return items.filter((i) => {
      const at = i.kind === 'folder' ? i.folder : infoOf(i).folder;
      return !holders.some((h) => (i.kind === 'folder' ? at !== h && isInFolder(at, h) : isInFolder(at, h)));
    });
  };
  const removeItems = async (items: MoveItem[]) => {
    if (!items.length) return;
    const label =
      items.length === 1
        ? items[0].kind === 'folder'
          ? `資料夾「${folderBase(items[0].folder)}」以及裡面所有的內容`
          : `「${infoOf(items[0]).name}」`
        : `這 ${items.length} 個項目${items.some((i) => i.kind === 'folder') ? '（資料夾連同裡面的內容）' : ''}`;
    if (!window.confirm(`要刪除${label}嗎？`)) return;
    for (const it of items) {
      if (it.kind === 'folder') await props.folderOps.remove(id, it.folder);
      else if (it.kind === 'file') props.fileOps.remove(it.id);
      else props.cardOps.remove(cardSection, it.id);
    }
    nav.clear();
  };

  const nav = useTreeNav(rows, {
    busy: editing !== null,
    toggle: toggleRow,
    activate,
    rename: startRename,
    remove: (ids) => void removeItems(topItems(ids)),
    escape: () => (searching ? (setQuery(''), true) : false),
    // 卡片：空白鍵 = 展開／收起欄位；→ 先展開欄位、再展開子卡片、再進到第一張子卡片；← 反過來
    // 回傳 false 的交給 TreeKit 原本的處理（子卡片的展開收起、移動）
    key: (e, row) => {
      if (row?.kind !== 'card' || e.shiftKey || e.ctrlKey || e.metaKey) return false;
      const id = row.card.id;
      if (e.key === ' ') return toggleBody(id), true;
      if (e.key === 'ArrowRight' && !bodies.has(id)) return toggleBody(id, true), true;
      if (e.key === 'ArrowLeft' && !(row.kids && row.open) && bodies.has(id)) return toggleBody(id, false), true;
      return false;
    },
  });

  // 別的地方打開了這個區塊的劇本或卡片：樹裡展開到那裡並選取它
  useEffect(() => {
    const tab = props.activeTab;
    if (!tab) return;
    let rid: string | null = null;
    let folder = '';
    if (isFiles) {
      const f = props.files[tab];
      if (f) [rid, folder] = [tab, f.folder];
    } else {
      const ref = parseCardTab(tab);
      const card = ref && ref.section === id ? cards.find((c) => c.id === ref.id) : undefined;
      if (card) [rid, folder] = [card.id, card.folder ?? ''];
    }
    if (!rid) return;
    if (!searching) revealFolder(folder);
    nav.selectOnly(rid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.activeTab]);

  // ───── 拖曳 ─────
  const clearHover = () => {
    if (hover.current) window.clearTimeout(hover.current.timer);
    hover.current = null;
  };
  useEffect(() => clearHover, []);
  const endDrag = () => {
    dragItem = null;
    clearHover();
    setDropFolder(null);
    setDropLine(null);
  };
  // 資料夾不能放進自己底下；卡片不能放進自己的子卡片裡
  const canPlaceIn = (item: MoveItem, folder: string) => {
    if (item.kind === 'folder') return !isInFolder(folder, item.folder);
    const card = item.kind === 'card' ? cards.find((c) => c.id === item.id) : undefined;
    return !card || !isInFolder(folder.toLowerCase(), childFolderOf(card).toLowerCase());
  };
  const canPlaceAll = (items: MoveItem[], folder: string) => items.every((i) => canPlaceIn(i, folder));
  const canDropOn = (items: MoveItem[], target: string) => canPlaceAll(items, target) && items.some((i) => infoOf(i).folder !== target);
  const scheduleExpand = (folder: string | null) => {
    if (hover.current?.folder === folder) return;
    clearHover();
    if (folder === null || !collapsed.has(folderKey(id, folder))) return;
    const timer = window.setTimeout(() => ((hover.current = null), expandFolder(folder)), EXPAND_DELAY);
    hover.current = { folder, timer };
  };
  const moveAll = async (items: MoveItem[], folder: string) => {
    for (const it of items) if (infoOf(it).folder !== folder) await props.onMove(id, it, folder);
  };
  const dragSource = (rid: string, label: string) => ({
    draggable: editing === null,
    onDragStart: (e: React.DragEvent) => {
      const ids = nav.selected.has(rid) ? nav.selected : new Set([rid]);
      if (!nav.selected.has(rid)) nav.selectOnly(rid);
      const items = topItems(ids);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', items.length > 1 ? `${items.length} 個項目` : label);
      dragItem = { section: id, items };
    },
    onDragEnd: endDrag,
  });
  const dropTarget = (target: string, expandable = false) => ({
    onDragOver: (e: React.DragEvent) => {
      e.stopPropagation(); // 不要讓外層的「空白處 = 根目錄」又蓋過去
      if (!dragItem || dragItem.section !== id || !canDropOn(dragItem.items, target)) {
        setDropFolder(null);
        scheduleExpand(null);
        return;
      }
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDropFolder(target);
      scheduleExpand(expandable ? target : null);
    },
    onDrop: (e: React.DragEvent) => {
      e.stopPropagation();
      const drag = dragItem;
      endDrag();
      if (!drag || drag.section !== id || !canDropOn(drag.items, target)) return;
      e.preventDefault();
      void moveAll(drag.items, target);
    },
  });
  const rowKeyOf = (item: MoveItem) => (item.kind === 'folder' ? `folder:${item.folder}` : item.id);
  const dropAt = (items: MoveItem[], folder: string, names: string[], anchor: string | null, after: boolean) => {
    const moving = items.map((i) => infoOf(i).name);
    const list = names.filter((n) => !moving.includes(n));
    const at = anchor === null ? list.length : list.indexOf(anchor) + (after ? 1 : 0);
    list.splice(at, 0, ...moving);
    void (async () => {
      await moveAll(items, folder);
      props.onReorder(id, folder, list);
    })();
  };
  const rowDropTarget = (folder: string, rowKey: string, name: string, into?: string) => {
    const zone = (e: React.DragEvent): 'before' | 'after' | 'into' => {
      const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const y = (e.clientY - box.top) / box.height;
      if (into === undefined) return y > 0.5 ? 'after' : 'before';
      return y < 0.25 ? 'before' : y > 0.75 ? 'after' : 'into';
    };
    const asFolder = into === undefined ? null : dropTarget(into, true);
    const onSelf = (items: MoveItem[]) => items.some((i) => rowKeyOf(i) === rowKey);
    return {
      onDragOver: (e: React.DragEvent) => {
        e.stopPropagation();
        if (!dragItem || dragItem.section !== id) return;
        const z = zone(e);
        if (z === 'into' && asFolder) {
          setDropLine(null);
          return asFolder.onDragOver(e);
        }
        setDropFolder(null);
        scheduleExpand(null);
        if (onSelf(dragItem.items) || !canPlaceAll(dragItem.items, folder)) {
          setDropLine(null);
          return; // 拖到自己身上、或資料夾拖進自己底下：不能放
        }
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const after = z === 'after';
        if (dropLine?.key !== rowKey || dropLine.after !== after) setDropLine({ key: rowKey, after });
      },
      onDrop: (e: React.DragEvent) => {
        e.stopPropagation();
        const drag = dragItem;
        if (!drag || drag.section !== id) return;
        const z = zone(e);
        if (z === 'into' && asFolder) return asFolder.onDrop(e);
        e.preventDefault();
        endDrag();
        if (onSelf(drag.items) || !canPlaceAll(drag.items, folder)) return;
        dropAt(drag.items, folder, namesIn(folder), name, z === 'after');
      },
    };
  };
  const lineClass = (key: string) => (dropLine?.key === key ? (dropLine.after ? ' drop-after' : ' drop-before') : '');
  const blankDropTarget = () => ({
    onDragOver: (e: React.DragEvent) => {
      if (!dragItem || dragItem.section !== id || searching) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      scheduleExpand(null);
      const entries = entriesIn('');
      const last = entries[entries.length - 1]?.rowKey;
      if (last && !dragItem.items.some((i) => rowKeyOf(i) === last)) {
        setDropFolder(null);
        if (dropLine?.key !== last || !dropLine.after) setDropLine({ key: last, after: true });
      } else {
        setDropLine(null);
        setDropFolder('');
      }
    },
    onDrop: (e: React.DragEvent) => {
      const drag = dragItem;
      if (!drag || drag.section !== id || searching) return;
      e.preventDefault();
      endDrag();
      dropAt(drag.items, '', namesIn(''), null, true);
    },
  });

  // ───── 選單 ─────
  const sortedNames = (folder: string, desc: boolean) => {
    const names = namesIn(folder);
    const cmp = (a: string, b: string) => (desc ? byName(b, a) : byName(a, b));
    return [...names.filter((n) => n.endsWith('/')).sort(cmp), ...names.filter((n) => !n.endsWith('/')).sort(cmp)];
  };
  const sortItem = (folder: string): ContextMenuItem => ({
    label: '排序',
    children: [false, true].map((desc) => ({ label: desc ? '名稱降序' : '名稱升序', onClick: () => props.onReorder(id, folder, sortedNames(folder, desc)) })),
  });
  const del = (item: MoveItem): ContextMenuItem => ({ label: '刪除', onClick: () => void removeItems([item]) });
  const itemWord = isFiles ? '劇本' : meta.title;
  // 建立的項目（右鍵「建立 ▸」和＋▾ 共用）；選到卡片時多一個子卡片
  const createItems = (folder: string, card?: Card): ContextMenuItem[] => [
    { label: itemWord, onClick: () => startCreate(folder, 'item') },
    ...(card ? [{ label: `子卡片（在「${card.name}」底下）`, onClick: () => startCreate(kidsFolderOf(card), 'item') }] : []),
    { label: '資料夾', onClick: () => startCreate(folder, 'folder') },
  ];
  const createMenu = (folder: string, card?: Card): ContextMenuItem => ({ label: '建立', children: createItems(folder, card) });
  const copyName = (name: string): ContextMenuItem => ({ label: '複製名稱', onClick: () => void navigator.clipboard.writeText(name) });
  const revealItem = (row: Row): ContextMenuItem[] =>
    searching
      ? [
          {
            label: '在樹裡顯示',
            onClick: () => {
              setQuery('');
              revealFolder(folderOfRow(row));
              nav.selectOnly(row.id);
            },
          },
        ]
      : [];
  // 右鍵選單：打開／看 → 建立 → 複製／找 → 改名／排序／刪除（分隔線隔開）
  const menuItems = (t: MenuTarget, row?: Row): ContextMenuItem[] => {
    const flat = row ? revealItem(row) : [];
    if (t.kind === 'root')
      return [
        createMenu(''),
        SEP,
        ...(isFiles ? [] : [{ label: bulk ? '全部收起欄位' : '全部展開欄位', onClick: toggleBulk }, { label: '欄位設定…', onClick: () => props.onEditSchema(cardSection) }]),
        SEP,
        sortItem(''),
      ];
    if (t.kind === 'file') {
      const file = props.files[t.id];
      return [
        { label: '開啟', onClick: () => props.onOpenFile(t.id) },
        SEP,
        createMenu(file?.folder ?? ''),
        SEP,
        copyName(file?.name ?? ''),
        ...flat,
        SEP,
        { label: '重新命名', onClick: () => setEditing({ mode: 'rename', kind: 'file', id: t.id }) },
        sortItem(file?.folder ?? ''),
        del({ kind: 'file', id: t.id }),
      ];
    }
    if (t.kind === 'card') {
      const card = cards.find((c) => c.id === t.id);
      return [
        { label: '編輯（開分頁）', onClick: () => props.cardOps.open(t.section, t.id) },
        { label: '放大檢視', onClick: () => openCardViewer(t.section, t.id) },
        { label: bodies.has(t.id) ? '收起欄位（空白鍵）' : '展開欄位（空白鍵）', onClick: () => toggleBody(t.id) },
        SEP,
        createMenu(card?.folder ?? '', card),
        SEP,
        copyName(card?.name ?? ''),
        ...(card ? pinItem(props.scene, t.section, card.name) : []),
        ...flat,
        SEP,
        { label: '重新命名', onClick: () => setEditing({ mode: 'rename', kind: 'card', section: t.section, id: t.id }) },
        sortItem(card?.folder ?? ''),
        del({ kind: 'card', id: t.id }),
      ];
    }
    return [
      createMenu(t.folder),
      SEP,
      { label: '全部展開（底下所有層）', onClick: () => setOpenDeep(t.folder, true) },
      { label: '全部收起（底下所有層）', onClick: () => setOpenDeep(t.folder, false) },
      SEP,
      { label: '重新命名', onClick: () => setEditing({ mode: 'rename', kind: 'folder', section: t.section, folder: t.folder }) },
      sortItem(t.folder),
      del({ kind: 'folder', folder: t.folder }),
    ];
  };
  const openMenuAt = (x: number, y: number, items: ContextMenuItem[]) => setMenu({ x, y, items });
  const openMenu = (e: React.MouseEvent, items: ContextMenuItem[]) => {
    e.preventDefault();
    e.stopPropagation(); // 列上的右鍵不要再傳到外層空白處，否則會被換成「最上層」的選單
    openMenuAt(e.clientX, e.clientY, items);
  };
  const targetOf = (row: Row): MenuTarget =>
    row.kind === 'file' ? { kind: 'file', id: row.fileId } : row.kind === 'card' ? { kind: 'card', section: cardSection, id: row.card.id } : { kind: 'folder', section: id, folder: row.folder };
  const rowMenu = (e: React.MouseEvent, row: Row) => {
    const ids = nav.forMenu(row.id);
    const items = topItems(ids);
    if (items.length > 1) {
      const names = rows.filter((r) => ids.has(r.id)).map(nameOfRow);
      return openMenu(e, [{ label: `刪除這 ${items.length} 個項目`, onClick: () => void removeItems(items) }, copyName(names.join('\n'))]);
    }
    openMenu(e, menuItems(targetOf(row), row));
  };
  // ＋：和「建立 ▸」一樣，加在選到的資料夾／選到的東西所在的資料夾；選到卡片時可以加子卡片
  const plusItems = (): ContextMenuItem[] => {
    const r = rowById(nav.cursor);
    const folder = !r ? '' : r.kind === 'folder' ? r.folder : folderOfRow(r);
    const card = r?.kind === 'card' ? r.card : undefined;
    return [
      { label: `加在：${[meta.title, ...folder.split('/').filter(Boolean)].join(' › ')}`, disabled: true },
      ...createItems(folder, card),
      ...(folder ? [SEP, { label: '加在最上層', children: createItems('') }] : []),
    ];
  };

  // ───── 畫出來 ─────
  const rowEvents = (row: Row) => ({
    'data-row': row.id,
    onClick: (e: React.MouseEvent) => nav.click(e, row.id),
    onDoubleClick: () => activate(row),
  });
  const renderLevel = (folder: string, depth: number): React.ReactNode => {
    const section = id;
    const creating = editing?.mode === 'create' && editing.section === section && editing.parent === folder ? editing : null;
    const createRow = (what: 'item' | 'folder') => {
      if (creating?.what !== what) return null;
      return (
        <div className="tree-row ap-row" style={{ paddingLeft: rowPad(depth) }}>
          <span className="ap-arrow" />
          <Icon icon={what === 'folder' ? 'folder' : isFiles ? fileIcon('.vns') : meta.icon} className="tree-icon" />
          <NameInput
            onSubmit={async (name) => {
              if (what === 'folder') return props.folderOps.create(section, folder, name);
              if (isFiles) return props.fileOps.add(folder, name);
              // 第一張子卡片：先建出和卡片同名的資料夾
              if (folder && !props.folders[section].includes(folder)) {
                const err = await props.folderOps.create(section, parentFolder(folder), folderBase(folder));
                if (err) return err;
              }
              return props.cardOps.add(cardSection, folder, name);
            }}
            onClose={() => setEditing(null)}
          />
        </div>
      );
    };
    return (
      <>
        {createRow('folder')}
        {createRow('item')}
        {entriesIn(folder).map((e) => {
          const row = rowById(e.rowKey);
          if (!row) return null;
          if (row.kind === 'folder') return folderRow(row, depth);
          if (row.kind === 'file') return fileRow(row, depth);
          return cardRow(row, depth);
        })}
      </>
    );
  };
  const fileRow = (row: Extract<Row, { kind: 'file' }>, depth: number, flat = false) => {
    const { fileId, file } = row;
    const renaming = editing?.mode === 'rename' && editing.kind === 'file' && editing.id === fileId;
    const dot = file.name.lastIndexOf('.');
    return (
      <div
        key={fileId}
        className={`tree-row ap-row${nav.rowCls(fileId)}${lineClass(fileId)}`}
        style={{ paddingLeft: rowPad(depth) }}
        {...rowEvents(row)}
        onContextMenu={(e) => rowMenu(e, row)}
        {...(flat ? {} : { ...dragSource(fileId, file.name), ...rowDropTarget(file.folder, fileId, file.name) })}
      >
        {!flat && <span className="ap-arrow" />}
        <Icon icon={fileIcon(file.name)} className="tree-icon" />
        {renaming ? (
          <NameInput
            initial={file.name}
            selectTo={dot > 0 ? dot : undefined} // 一開始只選副檔名前面的部分
            onSubmit={(name) => props.fileOps.rename(fileId, name)}
            onClose={() => (setEditing(null), nav.focus())}
          />
        ) : (
          <span className="tree-label">
            {file.name}
            {flat && file.folder && <span className="ap-where">{file.folder.split('/').join(' › ')}</span>}
          </span>
        )}
        {hasMarks(fileId) && <span className="ext-dot" title="有其他人的修改" />}
      </div>
    );
  };
  const cardRow = (row: Extract<Row, { kind: 'card' }>, depth: number, flat = false) => {
    const { card, kidsFolder } = row;
    const folder = card.folder ?? '';
    return (
      <CardItem
        key={card.id}
        section={cardSection}
        card={card}
        ops={props.cardOps}
        bulk={NO_BULK}
        selected={false}
        depth={depth}
        pad={rowPad(depth)}
        bodyOpen={bodies.has(card.id)}
        onBodyToggle={() => toggleBody(card.id)}
        onMenu={(e) => rowMenu(e, row)}
        renaming={editing?.mode === 'rename' && editing.kind === 'card' && editing.id === card.id}
        onRename={(name) => props.cardOps.rename(cardSection, card.id, name)}
        onRenameClose={() => (setEditing(null), nav.focus())}
        rowProps={{
          ...rowEvents(row),
          ...(flat ? {} : { ...dragSource(card.id, card.name), ...rowDropTarget(folder, card.id, card.name, kidsFolder) }),
          title: flat && folder ? `${meta.title}／${folder}` : undefined,
        }}
        rowClass={` ap-row${nav.rowCls(card.id)}${lineClass(card.id)}${dropFolder === kidsFolder ? ' drop-target' : ''}`}
        schemaFields={props.schemas[cardSection].fields}
        targetIcon={(name) => targetIcon(props.cards, name, cardSection)}
        kids={!flat && row.kids ? { open: !!row.open, onToggle: (alt) => toggleRow(row, !row.open, alt) } : undefined}
        badge={flat && folder ? <span className="ap-where">{folder.split('/').join(' › ')}</span> : undefined}
      >
        {!flat && row.kids && row.open && renderLevel(kidsFolder, depth + 1)}
      </CardItem>
    );
  };
  const folderRow = (row: Extract<Row, { kind: 'folder' }>, depth: number) => {
    const sub = row.folder;
    const renaming = editing?.mode === 'rename' && editing.kind === 'folder' && editing.section === id && editing.folder === sub;
    return (
      <Fragment key={row.id}>
        <div
          className={`tree-row ap-row${nav.rowCls(row.id)}${dropFolder === sub ? ' drop-target' : ''}${lineClass(row.id)}`}
          style={{ paddingLeft: rowPad(depth) }}
          {...rowEvents(row)}
          onContextMenu={(e) => rowMenu(e, row)}
          {...dragSource(row.id, folderBase(sub))}
          {...rowDropTarget(parentFolder(sub), row.id, folderOrderKey(sub), sub)}
        >
          <TreeArrow kids={row.kids} open={row.open} onToggle={(alt) => toggleRow(row, !row.open, alt)} />
          <Icon icon={row.open && row.kids ? 'folder-opened' : 'folder'} className="tree-icon" />
          {renaming ? (
            <NameInput
              initial={folderBase(sub)}
              onSubmit={async (name) => {
                const err = await props.folderOps.rename(id, sub, name);
                if (!err) setCollapsed((c) => remapFolderKeys(c, id, sub, joinFolder(parentFolder(sub), name.trim())));
                return err;
              }}
              onClose={() => (setEditing(null), nav.focus())}
            />
          ) : (
            <span className="tree-label">{folderBase(sub)}</span>
          )}
        </div>
        {row.open && renderLevel(sub, depth + 1)}
      </Fragment>
    );
  };

  const short = !!props.short && !props.floating && editing === null;
  const cur = rowById(nav.cursor);
  const pathText = cur ? [meta.title, ...folderOfRow(cur).split('/').filter(Boolean), nameOfRow(cur)].join('／') : '';
  const pathIcon = !cur ? undefined : cur.kind === 'folder' ? 'folder' : cur.kind === 'file' ? fileIcon(cur.file.name) : meta.icon;
  return (
    <div
      className={`section${props.fill ? ' filler' : ''}${props.floating ? ' floating' : ''}${short ? ' short' : ''}`}
      data-section={id}
      data-slot={props.slot ?? id}
      style={!props.fill && !short ? { height: props.height } : undefined}
    >
      <div
        className="section-header"
        onMouseDown={(e) => {
          if (e.button === 0 && !(e.target as HTMLElement).closest('button')) props.onHeaderDrag(props.slot ?? id, e);
        }}
        onContextMenu={(e) => openMenu(e, menuItems({ kind: 'root' }))}
      >
        {!props.floating && <FoldButton id={id} folded={props.folded.includes(id)} onFold={props.onFold} />}
        <SectionTitle id={id} slot={props.slot ?? id} stacks={props.stacks} title={meta.title} />
        <span className="section-actions">
          {!isFiles && (
            <button className="icon-btn" data-tip={bulk ? '全部收起：每張卡只顯示名稱' : '全部展開：顯示每張卡的欄位和詳細內容'} onClick={toggleBulk}>
              <Icon icon={bulk ? 'collapse-all' : 'expand-all'} />
            </button>
          )}
        </span>
      </div>
      <TreeToolbar
        plusTip={`新增${itemWord}、資料夾（加在選到的位置；也可以從 Ctrl+Shift+P 新增）`}
        onPlus={(x, y) => openMenuAt(x, y, plusItems())}
        query={query}
        setQuery={setQuery}
        placeholder="搜尋名稱"
        onSearchDown={() => (nav.focus(), rows[0] && nav.selectOnly(rows[0].id))}
      />
      {searching && <SearchHead text={`「${query.trim()}」　${rows.length} 個`} onBack={() => setQuery('')} />}
      <div
        className={`section-body ap-tree${dropFolder === '' ? ' drop-target' : ''}`}
        {...nav.treeProps}
        {...blankDropTarget()}
        onContextMenu={(e) => openMenu(e, menuItems({ kind: 'root' }))}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
          setDropFolder(null);
          setDropLine(null);
          scheduleExpand(null);
        }}
      >
        {searching
          ? rows.map((r) => (r.kind === 'file' ? fileRow(r, 0, true) : r.kind === 'card' ? cardRow(r, 0, true) : null))
          : renderLevel('', 0)}
        {searching && rows.length === 0 && <div className="scene-note">沒有符合的{itemWord}。</div>}
      </div>
      <PathBar icon={pathIcon} text={pathText} count={nav.selected.size} />
      {menu && <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={menu.items} />}
    </div>
  );
}
