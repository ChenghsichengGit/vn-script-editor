import { Fragment, useEffect, useRef, useState } from 'react';
import type { FileOps, FolderOps } from '../App';
import { Card, CardOps, CardSectionId, ItemOrder, Schemas, SectionId, cardTabId, folderOrderKey, orderEntries } from '../model';
import { sectionMeta } from '../sections';
import { targetIcon } from '../memories';
import { folderBase, isInFolder, joinFolder, parentFolder } from '../projectFiles';
import CardItem from './CardItem';
import ContextMenu, { ContextMenuItem } from './ContextMenu';
import NameInput from './NameInput';
import Icon, { fileIcon } from './Icon';
import { hasMarks, useChangeMarks } from '../changeMarks';

const INDENT = 14; // 每深一層資料夾縮排多少像素
const EXPAND_DELAY = 600; // 拖著東西停在摺起來的資料夾上多久（毫秒）就自動展開

const rowPad = (depth: number, hasChevron: boolean) => (hasChevron ? 6 : 24) + depth * INDENT;
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

let dragItem: { section: SectionId; item: MoveItem } | null = null;

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

export default function SectionPanel(props: Props) {
  useChangeMarks(); // 「外部修改」的黃點一變就重畫
  const { id, collapsed, setCollapsed } = props;
  const meta = sectionMeta(id);
  const isFiles = id === 'files';
  const cards = isFiles ? [] : props.cards[id as CardSectionId];
  const [bulk, setBulk] = useState({ show: false, tick: 0 });
  const [menu, setMenu] = useState<{ x: number; y: number; target: MenuTarget } | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [dropFolder, setDropFolder] = useState<string | null>(null);
  const [dropLine, setDropLine] = useState<{ key: string; after: boolean } | null>(null);
  const hover = useRef<{ folder: string; timer: number } | null>(null);
  // 摺疊／展開資料夾（open 沒給 = 切換）
  const setFolderOpen = (folder: string, open?: boolean) =>
    setCollapsed((c) => {
      const next = new Set(c);
      const key = folderKey(id, folder);
      if (open ?? next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const expandFolder = (folder: string) => setFolderOpen(folder, true);
  const startCreate = (parent: string, what: 'item' | 'folder') => {
    expandFolder(parent);
    setEditing({ mode: 'create', section: id, parent, what });
  };
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
  // 拖曳中的東西現在在哪個資料夾、在順序清單裡叫什麼（資料夾是「名稱/」）
  const infoOf = (item: MoveItem) => {
    if (item.kind === 'folder') return { folder: parentFolder(item.folder), name: folderOrderKey(item.folder) };
    const it = item.kind === 'file' ? props.files[item.id] : cards.find((c) => c.id === item.id);
    return { folder: it?.folder ?? '', name: it?.name ?? '' };
  };
  const canPlaceIn = (item: MoveItem, folder: string) => !(item.kind === 'folder' && isInFolder(folder, item.folder));
  const canDropOn = (item: MoveItem, target: string) => canPlaceIn(item, target) && infoOf(item).folder !== target;
  const scheduleExpand = (folder: string | null) => {
    if (hover.current?.folder === folder) return;
    clearHover();
    if (folder === null || !collapsed.has(folderKey(id, folder))) return;
    const timer = window.setTimeout(() => ((hover.current = null), expandFolder(folder)), EXPAND_DELAY);
    hover.current = { folder, timer };
  };
  const dragSource = (item: MoveItem, label: string) => ({
    draggable: editing === null,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', label);
      dragItem = { section: id, item };
    },
    onDragEnd: endDrag,
  });
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
  const rowKeyOf = (item: MoveItem) => (item.kind === 'folder' ? `folder:${item.folder}` : item.id);
  type Item = [string, { name: string; folder: string }] | Card;
  const entriesIn = (folder: string) => {
    const subs = props.folders[id].filter((f) => parentFolder(f) === folder);
    const items: Item[] = isFiles ? Object.entries(props.files).filter(([, f]) => f.folder === folder) : cards.filter((c) => (c.folder ?? '') === folder);
    const nameOf = (it: Item) => (Array.isArray(it) ? it[1].name : it.name);
    return orderEntries(subs, items, nameOf, props.order[id]?.[folder]).map((e) =>
      e.kind === 'folder'
        ? { ...e, key: folderOrderKey(e.folder), rowKey: `folder:${e.folder}` }
        : { ...e, key: nameOf(e.item), rowKey: Array.isArray(e.item) ? e.item[0] : e.item.id },
    );
  };
  const namesIn = (folder: string) => entriesIn(folder).map((e) => e.key);
  const dropAt = (drag: MoveItem, folder: string, names: string[], anchor: string | null, after: boolean) => {
    const moving = infoOf(drag).name;
    const list = names.filter((n) => n !== moving);
    const at = anchor === null ? list.length : list.indexOf(anchor) + (after ? 1 : 0);
    list.splice(at, 0, moving);
    void (async () => {
      if (infoOf(drag).folder !== folder) await props.onMove(id, drag, folder);
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
  const blankDropTarget = () => ({
    onDragOver: (e: React.DragEvent) => {
      if (!dragItem || dragItem.section !== id) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      scheduleExpand(null);
      const entries = entriesIn('');
      const last = entries[entries.length - 1]?.rowKey;
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
  const sortedNames = (folder: string, desc: boolean) => {
    const names = namesIn(folder);
    const cmp = (a: string, b: string) => (desc ? byName(b, a) : byName(a, b));
    return [...names.filter((n) => n.endsWith('/')).sort(cmp), ...names.filter((n) => !n.endsWith('/')).sort(cmp)];
  };
  const toggleBulk = () => setBulk((b) => ({ show: !b.show, tick: b.tick + 1 }));
  const sortItem = (folder: string): ContextMenuItem => ({
    label: '排序',
    children: [false, true].map((desc) => ({ label: desc ? '名稱降序' : '名稱升序', onClick: () => props.onReorder(id, folder, sortedNames(folder, desc)) })),
  });
  const del = (label: string, run: () => void): ContextMenuItem => ({ label: '刪除', onClick: () => window.confirm(`要刪除${label}嗎？`) && run() });
  const create = (folder: string): ContextMenuItem[] => [
    { label: isFiles ? '新增檔案' : `新增${meta.title}`, onClick: () => startCreate(folder, 'item') },
    { label: '新增資料夾', onClick: () => startCreate(folder, 'folder') },
  ];
  const menuItems = (t: MenuTarget): ContextMenuItem[] => {
    if (t.kind === 'root')
      return [
        ...create(''),
        ...(isFiles ? [] : [{ label: bulk.show ? '全部收起' : '全部展開', onClick: toggleBulk }, { label: '欄位設定…', onClick: () => props.onEditSchema(id) }]),
        sortItem(''),
      ];
    if (t.kind === 'file')
      return [
        { label: '重新命名', onClick: () => setEditing({ mode: 'rename', kind: 'file', id: t.id }) },
        sortItem(props.files[t.id]?.folder ?? ''),
        del(`「${props.files[t.id]?.name}」`, () => props.fileOps.remove(t.id)),
      ];
    if (t.kind === 'card') {
      const card = cards.find((c) => c.id === t.id);
      return [
        { label: '編輯', onClick: () => props.cardOps.open(t.section, t.id) },
        { label: '重新命名', onClick: () => setEditing({ mode: 'rename', kind: 'card', section: t.section, id: t.id }) },
        sortItem(card?.folder ?? ''),
        del(`「${card?.name}」`, () => props.cardOps.remove(t.section, t.id)),
      ];
    }
    return [
      ...create(t.folder),
      sortItem(t.folder),
      { label: '重新命名', onClick: () => setEditing({ mode: 'rename', kind: 'folder', section: t.section, folder: t.folder }) },
      del(`資料夾「${folderBase(t.folder)}」以及裡面所有的內容`, () => void props.folderOps.remove(t.section, t.folder)),
    ];
  };
  const openMenu = (e: React.MouseEvent, target: MenuTarget) => {
    e.preventDefault();
    e.stopPropagation(); // 列上的右鍵不要再傳到外層空白處，否則會被換成「最上層」的選單
    setMenu({ x: e.clientX, y: e.clientY, target });
  };
  const hasChildren = (folder: string) => entriesIn(folder).length > 0 || (editing?.mode === 'create' && editing.parent === folder);
  const renderLevel = (folder: string, depth: number): React.ReactNode => {
    const section = id;
    const cardSection = id as CardSectionId;
    const creating = editing?.mode === 'create' && editing.section === section && editing.parent === folder ? editing : null;
    const createRow = (what: 'item' | 'folder') => {
      if (creating?.what !== what) return null;
      const chevron = what === 'folder' || !isFiles; // 劇本檔案的列沒有箭頭
      return (
        <div className="tree-row" style={{ paddingLeft: rowPad(depth, chevron) }}>
          {chevron && <Icon icon="chevron-right" className="chevron" />}
          <Icon icon={what === 'folder' ? 'folder' : isFiles ? fileIcon('.vns') : meta.icon} className="tree-icon" />
          <NameInput
            onSubmit={(name) =>
              what === 'folder' ? props.folderOps.create(section, folder, name) : isFiles ? props.fileOps.add(folder, name) : props.cardOps.add(cardSection, folder, name)
            }
            onClose={() => setEditing(null)}
          />
        </div>
      );
    };
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
          {hasMarks(fileId) && <span className="ext-dot" title="有其他人的修改" />}
        </div>
      );
    };
    const cardRow = (card: Card) => (
      <CardItem
        key={card.id}
        section={cardSection}
        card={card}
        ops={props.cardOps}
        bulk={bulk}
        selected={props.activeTab === cardTabId(cardSection, card.id)}
        depth={depth}
        onMenu={(e) => openMenu(e, { kind: 'card', section: cardSection, id: card.id })}
        renaming={editing?.mode === 'rename' && editing.kind === 'card' && editing.id === card.id}
        onRename={(name) => props.cardOps.rename(cardSection, card.id, name)}
        onRenameClose={() => setEditing(null)}
        rowProps={{ ...dragSource({ kind: 'card', id: card.id }, card.name), ...rowDropTarget(folder, card.id, card.name) }}
        rowClass={lineClass(card.id)}
        schemaFields={props.schemas[cardSection].fields}
        targetIcon={(name) => targetIcon(props.cards, name, cardSection)}
      />
    );
    const folderRow = (sub: string) => {
      const open = !collapsed.has(folderKey(section, sub));
      const renaming = editing?.mode === 'rename' && editing.kind === 'folder' && editing.section === section && editing.folder === sub;
      const rowKey = `folder:${sub}`;
      return (
        <Fragment key={rowKey}>
          <div
            className={`tree-row${dropFolder === sub ? ' drop-target' : ''}${lineClass(rowKey)}`}
            style={{ paddingLeft: rowPad(depth, true) }}
            onClick={() => setFolderOpen(sub)}
            onContextMenu={(e) => openMenu(e, { kind: 'folder', section, folder: sub })}
            {...dragSource({ kind: 'folder', folder: sub }, folderBase(sub))}
            {...rowDropTarget(folder, rowKey, folderOrderKey(sub), sub)}
          >
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
      <div
        className="section-header"
        onMouseDown={(e) => {
          if (e.button === 0 && !(e.target as HTMLElement).closest('button')) props.onHeaderDrag(id, e);
        }}
        onContextMenu={(e) => openMenu(e, { kind: 'root' })}
      >
        <span className="section-title">{meta.title}</span>
        <span className="section-actions">
          {!isFiles && (
            <button className="icon-btn" data-tip={bulk.show ? '全部收起：每張卡只顯示名稱' : '全部展開：顯示每張卡的欄位和詳細內容'} onClick={toggleBulk}>
              <Icon icon={bulk.show ? 'collapse-all' : 'expand-all'} />
            </button>
          )}
          <button className="icon-btn" data-tip={`新增${isFiles ? '劇本' : meta.title}（也可以從 Ctrl+Shift+P 新增）`} onClick={() => startCreate('', 'item')}>
            <Icon icon="new-file" />
          </button>
          <button className="icon-btn" data-tip="新增資料夾" onClick={() => startCreate('', 'folder')}><Icon icon="new-folder" /></button>
        </span>
      </div>
      <div
        className={`section-body${dropFolder === '' ? ' drop-target' : ''}`}
        {...blankDropTarget()}
        onContextMenu={(e) => openMenu(e, { kind: 'root' })}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
          setDropFolder(null);
          setDropLine(null);
          scheduleExpand(null);
        }}
      >
        {renderLevel('', 0)}
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={menuItems(menu.target)} />}
    </div>
  );
}
