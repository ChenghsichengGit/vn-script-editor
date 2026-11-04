import { Fragment, useEffect, useRef, useState } from 'react';
import type { FileOps, FolderOps } from '../App';
import { Card, CardOps, CardSectionId, ItemOrder, Schemas, SectionId, cardTabId, folderOrderKey, orderEntries } from '../model';
import { fileIcon, sectionMeta } from '../sampleData';
import { folderBase, isInFolder, joinFolder, parentFolder } from '../projectFiles';
import CardItem from './CardItem';
import ContextMenu, { ContextMenuItem } from './ContextMenu';
import NameInput from './NameInput';
import Icon from './Icon';

const INDENT = 14; // 每深一層資料夾縮排多少像素
const EXPAND_DELAY = 600; // 拖著東西停在摺起來的資料夾上多久（毫秒）就自動展開

// 樹狀列的左邊距：資料夾和設定卡有 ▸ 箭頭；劇本檔案沒有，所以多推一個箭頭的寬度（18px），讓檔名和資料夾名對齊
const rowPad = (depth: number, hasChevron: boolean) => (hasChevron ? 6 : 24) + depth * INDENT;
const byName = (a: string, b: string) => a.localeCompare(b, 'zh-Hant');

// 右鍵選單對準的目標
type MenuTarget =
  | { kind: 'file'; id: string }
  | { kind: 'card'; section: CardSectionId; id: string }
  | { kind: 'folder'; section: SectionId; folder: string }
  | { kind: 'root' }; // 標題列或空白處：區塊的最上層

// 正在顯示輸入框的位置：新增（在 parent 資料夾底下新增項目或資料夾），或幫某個東西改名
type Editing =
  | { mode: 'create'; section: SectionId; parent: string; what: 'item' | 'folder' }
  | { mode: 'rename'; kind: 'file'; id: string }
  | { mode: 'rename'; kind: 'card'; section: CardSectionId; id: string }
  | { mode: 'rename'; kind: 'folder'; section: SectionId; folder: string };

// 拖曳搬移的對象：一個劇本檔案、一張設定卡，或一個資料夾（連同裡面的內容）
export type MoveItem = { kind: 'file'; id: string } | { kind: 'card'; id: string } | { kind: 'folder'; folder: string };

// 摺疊狀態的 key（預設全部展開，所以記的是「被摺起來」的資料夾）
export const folderKey = (section: SectionId, folder: string) => `${section}:${folder}`;

// 資料夾（和底下各層）換路徑後，摺疊記號跟著換成新路徑
export function remapFolderKeys(c: Set<string>, section: SectionId, oldPath: string, newPath: string): Set<string> {
  const oldKey = folderKey(section, oldPath);
  const newKey = folderKey(section, newPath);
  const next = new Set<string>();
  for (const key of c) {
    next.add(key === oldKey || key.startsWith(oldKey + '/') ? newKey + key.slice(oldKey.length) : key);
  }
  return next;
}

// 目前正被拖著的東西。放在模組層級：dragover 時瀏覽器不讓人讀 dataTransfer 的內容，所以自己記
let dragItem: { section: SectionId; item: MoveItem } | null = null;

// 每個區塊（面板）共用的東西：資料、操作、摺疊狀態、拖曳搬移，以及標題列的拖曳。
// 側邊欄和浮動視窗都從 App 拿到同一份，原封不動往下傳給 SectionPanel
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
  onMove: (section: SectionId, item: MoveItem, toFolder: string) => Promise<void>; // 拖曳放開時呼叫
  order: ItemOrder; // 自訂順序
  onReorder: (section: SectionId, folder: string, names: string[]) => void; // 某個資料夾裡的項目改成這個順序
  onHeaderDrag: (id: SectionId, e: React.MouseEvent) => void; // 按住標題列開始搬動整個區塊
  onEditSchema: (section: CardSectionId) => void; // 打開某個設定卡區塊的「欄位設定」
  schemas: Schemas; // 欄位範本：設定卡展開時，欄位名稱前面畫範本設定的圖示
}

interface Props extends TreeProps {
  id: SectionId;
  fill?: boolean; // 填滿剩下的空間（側邊欄最下面那塊、浮動視窗）
  height?: number; // 固定高度（fill 時不用）
  floating?: boolean; // 在浮動視窗裡：標題列就是視窗的標題列
}

// 一個區塊：標題列 + 檔案／設定卡的樹。放在左右側邊欄或浮動視窗裡都是同一個元件
export default function SectionPanel(props: Props) {
  const { id, collapsed, setCollapsed } = props;
  const meta = sectionMeta[id];

  // 「全部展開／全部收起」訊號：tick 每按一次加 1，卡片看到變化就跟著切換
  const [bulk, setBulk] = useState({ show: false, tick: 0 });
  // 右鍵選單（記著位置和對象）、以及正在顯示的名稱輸入框（新增／改名）
  const [menu, setMenu] = useState<{ x: number; y: number; target: MenuTarget } | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  // 拖曳搬移：目前會放進哪個資料夾（'' = 區塊根目錄；null = 沒有），用來畫藍色高亮
  const [dropFolder, setDropFolder] = useState<string | null>(null);
  // 拖曳排序：藍線畫在哪一列的上面或下面（key = 那一列的項目 id）
  const [dropLine, setDropLine] = useState<{ key: string; after: boolean } | null>(null);
  const hover = useRef<{ folder: string; timer: number } | null>(null);

  const toggleFolder = (folder: string) =>
    setCollapsed((c) => {
      const next = new Set(c);
      const key = folderKey(id, folder);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const expandFolder = (folder: string) =>
    setCollapsed((c) => {
      const next = new Set(c);
      next.delete(folderKey(id, folder));
      return next;
    });

  // 開始新增：目標資料夾自動展開，並在那裡顯示輸入框
  const startCreate = (parent: string, what: 'item' | 'folder') => {
    expandFolder(parent);
    setEditing({ mode: 'create', section: id, parent, what });
  };

  // ── 拖曳搬移 ──────────────────────────────

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

  // 項目現在在哪個資料夾
  const folderOf = (item: MoveItem) => {
    if (item.kind === 'file') return props.files[item.id]?.folder ?? '';
    if (item.kind === 'card') return props.cards[id as CardSectionId].find((c) => c.id === item.id)?.folder ?? '';
    return parentFolder(item.folder);
  };

  // 能不能放進 target：資料夾不能放進自己或自己底下；已經在那個資料夾就不用動（同名衝突交給 App 檢查）
  const canDropOn = (item: MoveItem, target: string) => {
    if (item.kind === 'folder' && isInFolder(target, item.folder)) return false;
    return folderOf(item) !== target;
  };

  // 拖著的東西停在摺起來的資料夾上一小段時間，就自動展開
  const scheduleExpand = (folder: string | null) => {
    if (hover.current?.folder === folder) return;
    clearHover();
    if (folder === null || !collapsed.has(folderKey(id, folder))) return;
    hover.current = {
      folder,
      timer: window.setTimeout(() => {
        hover.current = null;
        expandFolder(folder);
      }, EXPAND_DELAY),
    };
  };

  // 拖曳的來源：這一列可以被拖。正在輸入名稱（新增或改名）時不能拖，否則沒辦法在輸入框裡選字
  const dragSource = (item: MoveItem, label: string) => ({
    draggable: editing === null,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', label);
      dragItem = { section: id, item };
    },
    onDragEnd: endDrag,
  });

  // 拖曳的目的地：target = 放開後會進入的資料夾。
  // 資料夾那一列的 target 是它自己；檔案／卡片那一列的 target 是它所在的資料夾；空白處是區塊根目錄
  // 不能放的時候不呼叫 preventDefault，游標就會顯示禁止符號
  const dropTarget = (target: string, expandable = false) => ({
    onDragOver: (e: React.DragEvent) => {
      e.stopPropagation(); // 不要讓外層的「空白處 = 根目錄」又蓋過去
      if (!dragItem || dragItem.section !== id || !canDropOn(dragItem.item, target)) {
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
      if (!drag || drag.section !== id || !canDropOn(drag.item, target)) return;
      e.preventDefault();
      void props.onMove(id, drag.item, target);
    },
  });

  // 自訂順序裡的名稱：劇本是檔名、設定卡是卡片名稱、資料夾是「名稱/」
  const nameOfItem = (item: MoveItem) => {
    if (item.kind === 'file') return props.files[item.id]?.name ?? '';
    if (item.kind === 'card') return props.cards[id as CardSectionId].find((c) => c.id === item.id)?.name ?? '';
    return folderOrderKey(item.folder);
  };
  // 每一列的 key（藍線畫在哪一列）：項目用 id，資料夾用 folder:路徑
  const rowKeyOf = (item: MoveItem) => (item.kind === 'folder' ? `folder:${item.folder}` : item.id);

  // 某個資料夾裡直接包含的東西（子資料夾和項目混排），照目前畫出來的順序
  type Item = [string, { name: string; folder: string }] | Card;
  const entriesIn = (folder: string) => {
    const subs = props.folders[id].filter((f) => parentFolder(f) === folder);
    const items: Item[] =
      id === 'files'
        ? Object.entries(props.files).filter(([, f]) => f.folder === folder)
        : props.cards[id as CardSectionId].filter((c) => (c.folder ?? '') === folder);
    const nameOf = (it: Item) => (Array.isArray(it) ? it[1].name : it.name);
    return orderEntries(subs, items, nameOf, props.order[id]?.[folder]).map((e) =>
      e.kind === 'folder'
        ? { ...e, key: folderOrderKey(e.folder), rowKey: `folder:${e.folder}` }
        : { ...e, key: nameOf(e.item), rowKey: Array.isArray(e.item) ? e.item[0] : e.item.id },
    );
  };
  // 順序清單用的名稱（照目前畫出來的順序）
  const namesIn = (folder: string) => entriesIn(folder).map((e) => e.key);

  // 把拖著的東西放進 folder，排在 names 裡 anchor 的前面或後面（anchor = null：放最後面）
  const dropAt = (drag: MoveItem, folder: string, names: string[], anchor: string | null, after: boolean) => {
    const moving = nameOfItem(drag);
    const list = names.filter((n) => n !== moving);
    const at = anchor === null ? list.length : list.indexOf(anchor) + (after ? 1 : 0);
    list.splice(at, 0, moving);
    void (async () => {
      // 從別的資料夾拖過來：先搬過來，再排位置
      if (folderOf(drag) !== folder) await props.onMove(id, drag, folder);
      props.onReorder(id, folder, list);
    })();
  };

  // 拖著的東西能不能排進 folder 這一層（資料夾不能排進自己或自己底下）
  const canPlaceIn = (item: MoveItem, folder: string) => !(item.kind === 'folder' && isInFolder(folder, item.folder));

  // 一列的拖曳目的地：放在這一列的上面或下面（插入位置，畫藍線）
  // 資料夾那一列多一個「中間」：放進這個資料夾（整列亮起來），上下各 1/4 才是插在它前後
  // folder = 這一列所在的資料夾；rowKey／name = 這一列的 key 和順序名稱；into = 資料夾那一列自己的路徑
  const rowDropTarget = (folder: string, rowKey: string, name: string, into?: string) => {
    const zone = (e: React.DragEvent): 'before' | 'after' | 'into' => {
      const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const y = (e.clientY - box.top) / box.height;
      if (into === undefined) return y > 0.5 ? 'after' : 'before';
      return y < 0.25 ? 'before' : y > 0.75 ? 'after' : 'into';
    };
    const asFolder = into === undefined ? null : dropTarget(into, true);
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
        if (rowKeyOf(dragItem.item) === rowKey || !canPlaceIn(dragItem.item, folder)) {
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
        if (rowKeyOf(drag.item) === rowKey || !canPlaceIn(drag.item, folder)) return;
        dropAt(drag.item, folder, namesIn(folder), name, z === 'after');
      },
    };
  };
  const lineClass = (key: string) => (dropLine?.key === key ? (dropLine.after ? ' drop-after' : ' drop-before') : '');

  // 區塊下方空白處的拖曳目的地：放到根目錄的最後面（在子資料夾裡的會一起搬出來）
  const blankDropTarget = () => ({
    onDragOver: (e: React.DragEvent) => {
      if (!dragItem || dragItem.section !== id) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      scheduleExpand(null);
      const entries = entriesIn('');
      const last = entries[entries.length - 1]?.rowKey;
      // 藍線畫在最後一列下面；根目錄是空的（或最後一個就是自己）時，改成整塊亮起來
      if (last && rowKeyOf(dragItem.item) !== last) {
        setDropFolder(null);
        if (dropLine?.key !== last || !dropLine.after) setDropLine({ key: last, after: true });
      } else {
        setDropLine(null);
        setDropFolder('');
      }
    },
    onDrop: (e: React.DragEvent) => {
      const drag = dragItem;
      if (!drag || drag.section !== id) return;
      e.preventDefault();
      endDrag();
      dropAt(drag.item, '', namesIn(''), null, true);
    },
  });

  // 右鍵的「排序 ▸ 名稱升序／降序」：把這個資料夾裡的東西照名稱排好（資料夾在前、項目在後），存成自訂順序
  const sortedNames = (folder: string, desc: boolean) => {
    const names = namesIn(folder);
    const cmp = (a: string, b: string) => (desc ? byName(b, a) : byName(a, b));
    return [...names.filter((n) => n.endsWith('/')).sort(cmp), ...names.filter((n) => !n.endsWith('/')).sort(cmp)];
  };
  const sortItem = (folder: string): ContextMenuItem => ({
    label: '排序',
    children: [
      { label: '名稱升序', onClick: () => props.onReorder(id, folder, sortedNames(folder, false)) },
      { label: '名稱降序', onClick: () => props.onReorder(id, folder, sortedNames(folder, true)) },
    ],
  });

  // ── 右鍵選單 ──────────────────────────────

  const menuItems = (t: MenuTarget): ContextMenuItem[] => {
    if (t.kind === 'root') {
      const items: ContextMenuItem[] = [
        { label: id === 'files' ? '新增檔案' : `新增${meta.title}`, onClick: () => startCreate('', 'item') },
        { label: '新增資料夾', onClick: () => startCreate('', 'folder') },
      ];
      if (id !== 'files') {
        items.push({
          label: bulk.show ? '全部收起' : '全部展開',
          onClick: () => setBulk((b) => ({ show: !b.show, tick: b.tick + 1 })),
        });
        items.push({ label: '欄位設定…', onClick: () => props.onEditSchema(id as CardSectionId) });
      }
      items.push(sortItem(''));
      return items;
    }
    if (t.kind === 'file') {
      return [
        { label: '重新命名', onClick: () => setEditing({ mode: 'rename', kind: 'file', id: t.id }) },
        sortItem(props.files[t.id]?.folder ?? ''),
        {
          label: '刪除',
          onClick: () => {
            if (window.confirm(`要刪除「${props.files[t.id].name}」嗎？`)) props.fileOps.remove(t.id);
          },
        },
      ];
    }
    if (t.kind === 'card') {
      return [
        { label: '編輯', onClick: () => props.cardOps.open(t.section, t.id) },
        { label: '重新命名', onClick: () => setEditing({ mode: 'rename', kind: 'card', section: t.section, id: t.id }) },
        sortItem(props.cards[t.section].find((c) => c.id === t.id)?.folder ?? ''),
        {
          label: '刪除',
          onClick: () => {
            const card = props.cards[t.section].find((c) => c.id === t.id);
            if (card && window.confirm(`要刪除「${card.name}」嗎？`)) props.cardOps.remove(t.section, t.id);
          },
        },
      ];
    }
    return [
      {
        label: t.section === 'files' ? '新增檔案' : `新增${sectionMeta[t.section].title}`,
        onClick: () => startCreate(t.folder, 'item'),
      },
      { label: '新增資料夾', onClick: () => startCreate(t.folder, 'folder') },
      sortItem(t.folder),
      {
        label: '重新命名',
        onClick: () => setEditing({ mode: 'rename', kind: 'folder', section: t.section, folder: t.folder }),
      },
      {
        label: '刪除',
        onClick: () => {
          if (window.confirm(`要刪除資料夾「${folderBase(t.folder)}」以及裡面所有的內容嗎？`)) {
            void props.folderOps.remove(t.section, t.folder);
          }
        },
      },
    ];
  };

  const openMenu = (e: React.MouseEvent, target: MenuTarget) => {
    e.preventDefault();
    e.stopPropagation(); // 列上的右鍵不要再傳到外層空白處，否則會被換成「最上層」的選單
    setMenu({ x: e.clientX, y: e.clientY, target });
  };

  // ── 畫樹 ──────────────────────────────

  // 資料夾裡有沒有東西（子資料夾、劇本或設定卡，或正在裡面新增）：空的就不畫摺疊箭頭
  const hasChildren = (folder: string) =>
    props.folders[id].some((f) => parentFolder(f) === folder) ||
    (id === 'files'
      ? Object.values(props.files).some((f) => f.folder === folder)
      : props.cards[id as CardSectionId].some((c) => (c.folder ?? '') === folder)) ||
    (editing?.mode === 'create' && editing.parent === folder);

  // 畫出某個資料夾裡的內容：子資料夾和項目照自訂順序混排；子資料夾遞迴處理
  const renderLevel = (folder: string, depth: number): React.ReactNode => {
    const section = id;
    const creating = editing?.mode === 'create' && editing.section === section && editing.parent === folder ? editing : null;

    // 新增用的輸入框：資料夾的排在子資料夾群的最上面，檔案／設定卡的排在項目群的最上面
    const createRow = (what: 'item' | 'folder') => {
      if (creating?.what !== what) return null;
      const chevron = what === 'folder' || section !== 'files'; // 劇本檔案的列沒有箭頭
      return (
        <div className="tree-row" style={{ paddingLeft: rowPad(depth, chevron) }}>
          {chevron && <Icon icon="chevron-right" className="chevron" />}
          <Icon icon={what === 'folder' ? 'folder' : section === 'files' ? fileIcon('.vns') : meta.icon} className="tree-icon" />
          <NameInput
            onSubmit={(name) => {
              if (what === 'folder') return props.folderOps.create(section, folder, name);
              return section === 'files' ? props.fileOps.add(folder, name) : props.cardOps.add(section, folder, name);
            }}
            onClose={() => setEditing(null)}
          />
        </div>
      );
    };

    // 一個劇本檔案的那一列
    const fileRow = (fileId: string, file: { name: string; folder: string }) => {
      const renaming = editing?.mode === 'rename' && editing.kind === 'file' && editing.id === fileId;
      const dot = file.name.lastIndexOf('.');
      return (
        <div
          key={fileId}
          className={`tree-row${props.activeTab === fileId ? ' selected' : ''}${lineClass(fileId)}`}
          style={{ paddingLeft: rowPad(depth, false) }}
          onClick={() => props.onOpenFile(fileId)}
          onContextMenu={(e) => openMenu(e, { kind: 'file', id: fileId })}
          {...dragSource({ kind: 'file', id: fileId }, file.name)}
          {...rowDropTarget(folder, fileId, file.name)}
        >
          <Icon icon={fileIcon(file.name)} className="tree-icon" />
          {renaming ? (
            <NameInput
              initial={file.name}
              selectTo={dot > 0 ? dot : undefined} // 一開始只選副檔名前面的部分
              onSubmit={(name) => props.fileOps.rename(fileId, name)}
              onClose={() => setEditing(null)}
            />
          ) : (
            <span className="tree-label">{file.name}</span>
          )}
        </div>
      );
    };

    // 一張設定卡
    const cardRow = (card: Card) => (
      <CardItem
        key={card.id}
        section={section as CardSectionId}
        card={card}
        ops={props.cardOps}
        bulk={bulk}
        selected={props.activeTab === cardTabId(section as CardSectionId, card.id)}
        depth={depth}
        onMenu={(e) => openMenu(e, { kind: 'card', section: section as CardSectionId, id: card.id })}
        renaming={editing?.mode === 'rename' && editing.kind === 'card' && editing.id === card.id}
        onRename={(name) => props.cardOps.rename(section as CardSectionId, card.id, name)}
        onRenameClose={() => setEditing(null)}
        rowProps={{ ...dragSource({ kind: 'card', id: card.id }, card.name), ...rowDropTarget(folder, card.id, card.name) }}
        rowClass={lineClass(card.id)}
        schemaFields={props.schemas[section as CardSectionId].fields}
      />
    );

    // 一個子資料夾：那一列，展開的話接著畫它裡面的東西
    const folderRow = (sub: string) => {
      const open = !collapsed.has(folderKey(section, sub));
      const renaming = editing?.mode === 'rename' && editing.kind === 'folder' && editing.section === section && editing.folder === sub;
      const rowKey = `folder:${sub}`;
      return (
        <Fragment key={rowKey}>
          <div
            className={`tree-row${dropFolder === sub ? ' drop-target' : ''}${lineClass(rowKey)}`}
            style={{ paddingLeft: rowPad(depth, true) }}
            onClick={() => toggleFolder(sub)}
            onContextMenu={(e) => openMenu(e, { kind: 'folder', section, folder: sub })}
            {...dragSource({ kind: 'folder', folder: sub }, folderBase(sub))}
            {...rowDropTarget(folder, rowKey, folderOrderKey(sub), sub)}
          >
            {/* 空資料夾不畫摺疊箭頭（留一樣寬的空位，名稱才會對齊） */}
            {hasChildren(sub) ? <Icon icon={open ? 'chevron-down' : 'chevron-right'} className="chevron" /> : <span className="chevron" />}
            <Icon icon={open && hasChildren(sub) ? 'folder-opened' : 'folder'} className="tree-icon" />
            {renaming ? (
              <NameInput
                initial={folderBase(sub)}
                onSubmit={async (name) => {
                  const err = await props.folderOps.rename(section, sub, name);
                  if (!err) setCollapsed((c) => remapFolderKeys(c, section, sub, joinFolder(parentFolder(sub), name.trim())));
                  return err;
                }}
                onClose={() => setEditing(null)}
              />
            ) : (
              <span className="tree-label">{folderBase(sub)}</span>
            )}
          </div>
          {open && renderLevel(sub, depth + 1)}
        </Fragment>
      );
    };

    // 子資料夾和項目照自訂順序混在一起畫（新增用的輸入框放最上面）
    return (
      <>
        {createRow('folder')}
        {createRow('item')}
        {entriesIn(folder).map((e) => {
          if (e.kind === 'folder') return folderRow(e.folder);
          const it = e.item;
          return Array.isArray(it) ? fileRow(it[0], it[1]) : cardRow(it);
        })}
      </>
    );
  };

  return (
    <div
      className={`section${props.fill ? ' filler' : ''}${props.floating ? ' floating' : ''}`}
      data-section={id}
      style={!props.fill ? { height: props.height } : undefined}
    >
      {/* 區塊標題列：新增檔案（設定卡）、新增資料夾；設定卡區塊還多一個全部展開／收起
          按住標題列（按鈕以外的地方）可以搬動整個區塊：換位置、換邊、或拉出去變浮動視窗 */}
      <div
        className="section-header"
        onMouseDown={(e) => {
          if (e.button === 0 && !(e.target as HTMLElement).closest('button')) props.onHeaderDrag(id, e);
        }}
        onContextMenu={(e) => openMenu(e, { kind: 'root' })}
      >
        <span className="section-title">{meta.title}</span>
        <span className="section-actions">
          {id !== 'files' && (
            <button
              className="icon-btn"
              data-tip={bulk.show ? '全部收起：每張卡只顯示名稱' : '全部展開：顯示每張卡的欄位和詳細內容'}
              onClick={() => setBulk({ show: !bulk.show, tick: bulk.tick + 1 })}
            >
              <Icon icon={bulk.show ? 'collapse-all' : 'expand-all'} />
            </button>
          )}
          <button
            className="icon-btn"
            data-tip={id === 'files' ? '新增劇本（也可以從 Ctrl+Shift+P 新增）' : `新增${meta.title}（也可以從 Ctrl+Shift+P 新增）`}
            onClick={() => startCreate('', 'item')}
          >
            <Icon icon="new-file" />
          </button>
          <button className="icon-btn" data-tip="新增資料夾" onClick={() => startCreate('', 'folder')}>
            <Icon icon="new-folder" />
          </button>
        </span>
      </div>

      {/* 空白處也是拖曳的目的地（放開 = 搬到區塊根目錄）；滑鼠完全離開本體才取消高亮 */}
      <div
        className={`section-body${dropFolder === '' ? ' drop-target' : ''}`}
        {...blankDropTarget()}
        onContextMenu={(e) => openMenu(e, { kind: 'root' })}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setDropFolder(null);
            setDropLine(null);
            scheduleExpand(null);
          }
        }}
      >
        {renderLevel('', 0)}
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={menuItems(menu.target)} />}
    </div>
  );
}
