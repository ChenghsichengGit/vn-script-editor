// 「資源」區塊：仿 Unity Project 視窗的單欄樹（One Column Layout）
//   上面工具列：＋（新增）、搜尋、類型篩選；樹：資源（根） › 類別 › 資料夾 › 資源；最下面一條路徑列
//   點一下選取（Ctrl／Shift 多選），點兩下或 Enter 打開；←→ 收合、↑↓ 移動、F2 改名、Delete 刪除；Alt＋點箭頭 = 底下全部一起
//   名稱就是指令裡用的名字；類別名稱就是指令參數（[立繪]）
import { Fragment, useEffect, useMemo, useState } from 'react';
import type { SectionId } from '../model';
import { sectionMeta } from '../sections';
import {
  ASSET_DIR, Asset, AssetPlace, addAssetFiles, assetAt, assetMoved, createEmptyAsset, dropAssetInfo, moveAssetInfo, nameProblem, namesIn,
  openAsset, placeRel, removeAsset, renameAsset, requestAssetNameFocus, splitExt, useOpenAsset,
} from '../assets';
import { imageSrc } from '../images';
import { joinPath } from '../projectFiles';
import { errorText } from '../hooks';
import ContextMenu, { ContextMenuItem, SEP } from './ContextMenu';
import Icon from './Icon';
import NameInput from './NameInput';
import AssetImportDialog, { ImportItem } from './AssetImportDialog';
import { FoldButton, SectionTitle, TreeProps, folderKey } from './SectionPanel';
import { openImageViewer } from './ImageViewer';
import { openAssetViewer } from './AssetViewer';
import { PathBar, SearchHead, TreeArrow, TreeToolbar, useTreeNav } from './TreeKit';

interface Props extends TreeProps {
  id: SectionId;
  fill?: boolean;
  height?: number;
  floating?: boolean;
  short?: boolean;
  slot?: SectionId;
}

const INDENT = 14;
const baseOf = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const parentOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const DRAG_TYPE = 'application/x-vn-asset'; // 樹裡拖曳：內容是 JSON 陣列（相對專案的路徑）

// 依類型篩選
type Fav = 'image' | 'other' | 'missing' | 'duplicate';
const FAVS: { id: Fav; label: string; test: (a: Asset) => boolean }[] = [
  { id: 'image', label: '全部圖片', test: (a) => a.image },
  { id: 'other', label: '其他檔案', test: (a) => !a.image && !a.missing },
  { id: 'missing', label: '還沒有檔案', test: (a) => a.missing },
  { id: 'duplicate', label: '名稱重複', test: (a) => a.duplicate },
];

type Nav = { id: string; depth: number; kids?: boolean; open?: boolean; pick?: boolean };
type Row =
  | (Nav & { kind: 'root' })
  | (Nav & { kind: 'place'; place: AssetPlace; rel: string; isCat: boolean; hasKids: boolean; count: number })
  | (Nav & { kind: 'asset'; asset: Asset; flat?: boolean })
  | (Nav & { kind: 'create'; place: AssetPlace | null; what: 'folder' | 'asset' });

type Editing = { mode: 'create'; place: AssetPlace | null; kind: 'folder' | 'asset' } | { mode: 'rename'; rel: string; isFile: boolean };

const placeId = (rel: string) => `p:${rel}`;
const assetRowId = (path: string) => `a:${path}`;

export default function AssetPanel(props: Props) {
  const { id, assets, projectRoot, collapsed, setCollapsed } = props;
  const meta = sectionMeta(id);
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [importing, setImporting] = useState<{ place: AssetPlace; items: ImportItem[] } | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [types, setTypes] = useState<Set<Fav>>(new Set());
  const short = !!props.short && !props.floating && editing === null;
  const abs = (rel: string) => joinPath(projectRoot, ...rel.split('/'));
  const fail = (what: string) => (e: unknown) => window.alert(`${what}：${errorText(e)}`);
  const reveal = (rel: string) => void window.api.revealPath(abs(rel)).catch(fail('無法在檔案總管中顯示'));
  const done = () => props.onRescanAssets();
  const searching = query.trim() !== '' || types.size > 0;
  const allAssets = useMemo(() => assets.categories.flatMap((c) => c.assets), [assets]);

  // ───── 展開／收起：類別、根預設展開，子資料夾預設收起；collapsed 裡有 key = 和預設相反 ─────
  const keyOf = (p: AssetPlace) => folderKey(id, p.folder ? `${p.category}/${p.folder}` : p.category);
  const ROOT_KEY = folderKey(id, '\u0000root');
  const isOpenKey = (key: string, byDefault: boolean) => byDefault !== collapsed.has(key);
  const isOpen = (p: AssetPlace) => isOpenKey(keyOf(p), p.folder === '');
  const setKeys = (list: { key: string; byDefault: boolean }[], want: boolean | ((cur: boolean) => boolean)) =>
    setCollapsed((c) => {
      let next: Set<string> | null = null;
      for (const { key, byDefault } of list) {
        const cur = byDefault !== c.has(key);
        const w = typeof want === 'function' ? want(cur) : want;
        if (w === cur) continue;
        next ??= new Set(c);
        if (next.has(key)) next.delete(key);
        else next.add(key);
      }
      return next ?? c;
    });
  const placeKey = (p: AssetPlace) => ({ key: keyOf(p), byDefault: p.folder === '' });
  const setOpen = (p: AssetPlace, open?: boolean) => setKeys([placeKey(p)], open ?? ((cur) => !cur));
  // Alt＋點：這個位置和底下所有子資料夾一起
  const setOpenDeep = (p: AssetPlace, open: boolean) => {
    const cat = assets.categories.find((c) => c.name === p.category);
    const subs = (cat?.folders ?? []).filter((f) => !p.folder || f.startsWith(`${p.folder}/`));
    setKeys([placeKey(p), ...subs.map((f) => placeKey({ category: p.category, folder: f }))], open);
  };
  // 讓某個資源看得到：根、類別、每一層資料夾都展開
  const revealInTree = (a: Asset) => {
    const segs = a.folder.split('/').filter(Boolean);
    setKeys(
      [
        { key: ROOT_KEY, byDefault: true },
        placeKey({ category: a.category, folder: '' }),
        ...segs.map((_, i) => placeKey({ category: a.category, folder: segs.slice(0, i + 1).join('/') })),
      ],
      true,
    );
  };

  // ───── 要顯示的列 ─────
  const editingPlaceRel = editing?.mode === 'create' && editing.place ? placeRel(editing.place) : null;
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    if (searching) {
      const q = query.trim().toLowerCase();
      const want = [...types].map((t) => FAVS.find((f) => f.id === t)!.test);
      for (const a of allAssets) {
        if (want.length && !want.some((t) => t(a))) continue;
        if (q && !a.name.toLowerCase().includes(q) && !a.note.toLowerCase().includes(q) && !a.label.toLowerCase().includes(q)) continue;
        out.push({ kind: 'asset', id: assetRowId(a.path), depth: 0, asset: a, flat: true });
      }
      return out;
    }
    const rootOpen = isOpenKey(ROOT_KEY, true);
    out.push({ kind: 'root', id: 'root', depth: 0, kids: assets.categories.length > 0, open: rootOpen, pick: false });
    if (!rootOpen && !(editing?.mode === 'create')) return out;
    if (editing?.mode === 'create' && !editing.place) out.push({ kind: 'create', id: 'create', depth: 1, place: null, what: 'folder', pick: false });
    for (const cat of assets.categories) {
      const walk = (folder: string, depth: number) => {
        const place = { category: cat.name, folder };
        const rel = placeRel(place);
        if (editing?.mode === 'create' && editingPlaceRel === rel) out.push({ kind: 'create', id: 'create', depth, place, what: editing.kind, pick: false });
        for (const f of cat.folders.filter((x) => parentOf(x) === folder)) {
          const sub = { category: cat.name, folder: f };
          const subRel = placeRel(sub);
          const hasKids = cat.folders.some((x) => parentOf(x) === f) || cat.assets.some((a) => a.folder === f);
          const open = isOpen(sub);
          out.push({ kind: 'place', id: placeId(subRel), depth, place: sub, rel: subRel, isCat: false, hasKids, count: 0, kids: hasKids, open });
          if (open || editingPlaceRel === subRel) walk(f, depth + 1);
        }
        for (const a of cat.assets.filter((x) => x.folder === folder)) out.push({ kind: 'asset', id: assetRowId(a.path), depth, asset: a });
      };
      const place = { category: cat.name, folder: '' };
      const rel = placeRel(place);
      const hasKids = cat.folders.length + cat.assets.length > 0;
      const open = isOpen(place);
      out.push({ kind: 'place', id: placeId(rel), depth: 1, place, rel, isCat: true, hasKids, count: cat.assets.length, kids: hasKids, open });
      if (open || editingPlaceRel === rel) walk('', 2);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assets, allAssets, collapsed, searching, query, types, editing]);
  const rowById = (rid: string | null) => (rid ? rows.find((r) => r.id === rid) : undefined);
  const nav = useTreeNav(rows, {
    busy: editing !== null,
    toggle: (row, open, alt) => toggleRow(row, alt, open),
    activate: (row) => activate(row),
    rename: (row) => startRename(row),
    remove: (ids) => void removeRels(selectedRels(ids)),
    escape: () => {
      if (!searching) return false;
      setQuery('');
      setTypes(new Set());
      return true;
    },
  });
  const { selected, cursor } = nav;

  // 打開了資源視窗（樹、連結、放大檢視…）：樹裡選到它
  const openPath = useOpenAsset();
  useEffect(() => {
    const a = openPath ? assetAt(openPath) : undefined;
    if (!a) return;
    if (!searching) revealInTree(a);
    nav.selectOnly(assetRowId(a.path));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openPath]);

  // ───── 新增、改名、刪除、加入檔案、搬移 ─────
  const taken = (place: AssetPlace | null, name: string) =>
    place ? namesIn(assets, place).has(name.toLowerCase()) : assets.categories.some((c) => c.name.toLowerCase() === name.toLowerCase());
  const createDir = async () => {
    try {
      await window.api.mkdir(abs(ASSET_DIR));
      done();
      reveal(ASSET_DIR);
    } catch (e) {
      fail(`無法建立「${ASSET_DIR}」資料夾`)(e);
    }
  };
  const startCreate = async (place: AssetPlace | null, kind: 'folder' | 'asset' = 'folder') => {
    if (props.folded.includes(id)) props.onFold(id, false);
    if (!assets.exists) await window.api.mkdir(abs(ASSET_DIR)).catch(fail(`無法建立「${ASSET_DIR}」資料夾`));
    setQuery('');
    setTypes(new Set());
    setKeys([{ key: ROOT_KEY, byDefault: true }], true);
    if (place) setOpen(place, true);
    setEditing({ mode: 'create', place, kind });
  };
  const create = async (place: AssetPlace | null, raw: string) => {
    const name = raw.trim();
    const bad = nameProblem(name);
    if (bad) return bad;
    if (taken(place, name)) return '已經有同名的檔案或資料夾';
    try {
      await window.api.mkdir(abs(place ? `${placeRel(place)}/${name}` : `${ASSET_DIR}/${name}`));
      done();
      return null;
    } catch (e) {
      return errorText(e);
    }
  };
  const createAsset = async (place: AssetPlace, raw: string) => {
    const r = createEmptyAsset(place, raw);
    if ('error' in r) return r.error;
    openAsset(r.path);
    return null;
  };
  // 先給檔案、之後再取名：用原本的檔名加入，打開第一個並選取檔名欄
  const addFilesNow = async (place: AssetPlace) => {
    try {
      const paths = await window.api.pickAssetFiles();
      if (!paths.length) return;
      const { added, errors } = await addAssetFiles(place, paths.map((p) => ({ kind: 'path', path: p })));
      setOpen(place, true);
      if (added[0]) {
        requestAssetNameFocus(added[0]);
        openAsset(added[0]);
      }
      if (errors.length) window.alert(`有檔案沒有加入：\n${errors.join('\n')}`);
    } catch (e) {
      fail('無法加入檔案')(e);
    }
  };
  const pickFiles = async (place: AssetPlace) => {
    try {
      const paths = await window.api.pickAssetFiles();
      if (paths.length) setImporting({ place, items: paths.map((p) => ({ source: { kind: 'path', path: p }, original: baseOf(p.replace(/\\/g, '/')) })) });
    } catch (e) {
      fail('無法選擇檔案')(e);
    }
  };
  const confirmImport = async (names: string[]) => {
    if (!importing) return;
    const dir = placeRel(importing.place);
    const errors: string[] = [];
    for (let i = 0; i < importing.items.length; i++) {
      const it = importing.items[i];
      const target = abs(`${dir}/${names[i]}`);
      try {
        if (it.source.kind === 'path') await window.api.copyAssetFile(it.source.path, target);
        else await window.api.writeAssetFile(target, new Uint8Array(await it.source.file.arrayBuffer()));
      } catch (e) {
        errors.push(`${names[i]}：${errorText(e)}`);
      }
    }
    setOpen(importing.place, true);
    setImporting(null);
    done();
    if (errors.length) window.alert(`有檔案沒有加入：\n${errors.join('\n')}`);
  };
  // 選到的項目換成相對路徑（資料夾裡的東西不重複算）
  const selectedRels = (ids: Iterable<string>) => {
    const rels: string[] = [];
    for (const rid of ids) {
      if (rid.startsWith('p:')) rels.push(rid.slice(2));
      else if (rid.startsWith('a:')) rels.push(rid.slice(2));
    }
    return rels.filter((r) => !rels.some((o) => o !== r && r.startsWith(`${o}/`)));
  };
  const removeRels = async (rels: string[]) => {
    if (!rels.length) return;
    const label =
      rels.length === 1
        ? assetAt(rels[0])
          ? `「${baseOf(rels[0])}」`
          : `${rels[0].split('/').length === 2 ? '類別' : '資料夾'}「${baseOf(rels[0])}」以及裡面所有的檔案`
        : `這 ${rels.length} 個項目${rels.some((r) => !assetAt(r)) ? '（資料夾連同裡面的檔案）' : ''}`;
    const onlyMissing = rels.every((r) => assetAt(r)?.missing);
    if (!window.confirm(onlyMissing ? `要刪除${label}嗎？（還沒有檔案，只會刪掉記錄）` : `要刪除${label}嗎？\n會直接從硬碟刪除，無法復原。`)) return;
    const errors: string[] = [];
    for (const rel of rels) {
      try {
        if (assetAt(rel)) await removeAsset(rel);
        else {
          await window.api.remove(abs(rel), { recursive: true });
          dropAssetInfo(rel);
        }
      } catch (e) {
        errors.push(`${baseOf(rel)}：${errorText(e)}`);
      }
    }
    nav.clear();
    done();
    if (errors.length) window.alert(`刪除失敗：\n${errors.join('\n')}`);
  };
  const move = async (rels: string[], to: AssetPlace) => {
    const dest = placeRel(to);
    const errors: string[] = [];
    for (const rel of rels) {
      if (parentOf(rel) === dest) continue;
      if (rel.split('/').length === 2) {
        errors.push(`「${baseOf(rel)}」是類別，不能搬進別的資料夾`);
        continue;
      }
      if (dest === rel || dest.startsWith(`${rel}/`)) {
        errors.push(`「${baseOf(rel)}」不能搬進它自己裡面`);
        continue;
      }
      if (taken(to, baseOf(rel))) {
        errors.push(`「${baseOf(rel)}」那裡已經有同名的檔案或資料夾`);
        continue;
      }
      try {
        if (!assetAt(rel)?.missing) await window.api.rename(abs(rel), abs(`${dest}/${baseOf(rel)}`)); // 還沒有檔案的只搬記錄
        moveAssetInfo(rel, `${dest}/${baseOf(rel)}`);
        assetMoved(rel, `${dest}/${baseOf(rel)}`);
      } catch (e) {
        errors.push(`${baseOf(rel)}：${errorText(e)}`);
      }
    }
    setOpen(to, true);
    nav.clear();
    done();
    if (errors.length) window.alert(`有項目沒有搬移：\n${errors.join('\n')}`);
  };

  // ───── 選取、展開、打開 ─────
  const selectOnly = nav.selectOnly;
  const toggleRow = (row: Row, alt = false, want?: boolean) => {
    if (row.kind === 'place') {
      const open = want ?? !isOpen(row.place);
      if (alt) setOpenDeep(row.place, open);
      else setOpen(row.place, open);
    } else if (row.kind === 'root') {
      const open = want ?? !isOpenKey(ROOT_KEY, true);
      setKeys([{ key: ROOT_KEY, byDefault: true }], open);
      if (alt) for (const c of assets.categories) setOpenDeep({ category: c.name, folder: '' }, open);
    }
  };
  const activate = (row: Row) => {
    if (row.kind === 'asset') openAsset(row.asset.path);
    else toggleRow(row);
  };
  const startRename = (row: Row | undefined) => {
    if (row?.kind === 'asset') setEditing({ mode: 'rename', rel: row.asset.path, isFile: true });
    else if (row?.kind === 'place') setEditing({ mode: 'rename', rel: row.rel, isFile: false });
  };


  // ───── 拖曳 ─────
  const dropTarget = (place: AssetPlace, key: string) => ({
    onDragOver: (e: React.DragEvent) => {
      const t = e.dataTransfer.types;
      if (!t.includes(DRAG_TYPE) && !t.includes('Files')) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = t.includes('Files') ? 'copy' : 'move';
      if (dropKey !== key) setDropKey(key);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropKey((k) => (k === key ? null : k));
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDropKey(null);
      const data = e.dataTransfer.getData(DRAG_TYPE);
      if (data) return void move(JSON.parse(data) as string[], place);
      const files = [...e.dataTransfer.files];
      if (files.length) setImporting({ place, items: files.map((f) => ({ source: { kind: 'file', file: f }, original: f.name })) });
    },
  });
  const dragSource = (row: Row) => ({
    draggable: editing === null,
    onDragStart: (e: React.DragEvent) => {
      const ids = selected.has(row.id) ? [...selected] : [row.id];
      if (!selected.has(row.id)) selectOnly(row.id);
      e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(selectedRels(ids)));
      e.dataTransfer.effectAllowed = 'move';
    },
    onDragEnd: () => setDropKey(null),
  });

  // ───── 選單 ─────
  const openMenuAt = (x: number, y: number, items: ContextMenuItem[]) => setMenu({ x, y, items });
  const openMenu = (e: React.MouseEvent, items: ContextMenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    openMenuAt(e.clientX, e.clientY, items);
  };
  const createItems = (place: AssetPlace | null): ContextMenuItem[] =>
    place
      ? [
          { label: '資源（先取名，之後再給檔案）', onClick: () => void startCreate(place, 'asset') },
          { label: '加入檔案（之後再取名）…', onClick: () => void addFilesNow(place) },
          { label: '加入檔案並取名…', onClick: () => void pickFiles(place) },
          { label: '資料夾', onClick: () => void startCreate(place) },
        ]
      : [
          { label: '類別（例如 立繪、道具）', onClick: () => void startCreate(null) },
          ...(assets.categories.length ? [] : [{ label: '資源：先新增類別', disabled: true }]),
        ];
  // ＋ 和右鍵「建立」要加在哪裡：選到的資料夾／資源所在的資料夾 → 開著的資源 → 第一個類別
  const targetPlace = (): AssetPlace | null => {
    const r = rowById(cursor);
    if (r?.kind === 'place') return r.place;
    if (r?.kind === 'asset') return { category: r.asset.category, folder: r.asset.folder };
    const a = openPath ? assetAt(openPath) : undefined;
    if (a) return { category: a.category, folder: a.folder };
    return assets.categories[0] ? { category: assets.categories[0].name, folder: '' } : null;
  };
  const plusItems = (): ContextMenuItem[] => {
    const place = targetPlace();
    if (!place) return [{ label: '類別（例如 立繪、道具）', onClick: () => void startCreate(null) }, { label: '先新增類別，才能新增資源', disabled: true }];
    return [
      { label: `加在：${placeRel(place).slice(ASSET_DIR.length + 1).replace(/\//g, ' › ')}`, disabled: true },
      ...createItems(place),
      SEP,
      { label: '類別', onClick: () => void startCreate(null) },
    ];
  };
  const rowMenu = (e: React.MouseEvent, row: Row) => {
    const rels = selectedRels(nav.forMenu(row.id));
    if (rels.length > 1) {
      return openMenu(e, [
        { label: `刪除這 ${rels.length} 個項目`, onClick: () => void removeRels(rels) },
        { label: '複製名稱', onClick: () => void navigator.clipboard.writeText(rels.map((r) => assetAt(r)?.name ?? baseOf(r)).join('\n')) },
      ]);
    }
    if (row.kind === 'asset') {
      const a = row.asset;
      return openMenu(e, [
        { label: '開啟', onClick: () => openAsset(a.path) },
        SEP,
        { label: '建立', children: createItems({ category: a.category, folder: a.folder }) },
        SEP,
        { label: '複製名稱', onClick: () => void navigator.clipboard.writeText(a.name) },
        ...(a.image ? [{ label: '放大檢視圖片', onClick: () => openImageViewer(a.path) }] : []),
        ...(row.flat ? [{ label: '在樹裡顯示', onClick: () => (setQuery(''), setTypes(new Set()), revealInTree(a), selectOnly(row.id)) }] : []),
        ...(a.missing ? [] : [{ label: '在檔案總管中顯示', onClick: () => reveal(a.path) }]),
        SEP,
        { label: '重新命名', onClick: () => startRename(row) },
        { label: '刪除', onClick: () => void removeRels([a.path]) },
      ]);
    }
    if (row.kind === 'place') {
      return openMenu(e, [
        { label: '建立', children: createItems(row.place) },
        SEP,
        ...(row.isCat ? [{ label: '複製參數寫法', onClick: () => void navigator.clipboard.writeText(`[${row.place.category}]`) }] : []),
        { label: '在檔案總管中顯示', onClick: () => reveal(row.rel) },
        SEP,
        { label: '重新命名', onClick: () => startRename(row) },
        { label: '刪除', onClick: () => void removeRels([row.rel]) },
      ]);
    }
    if (row.kind === 'root') return openMenu(e, rootItems);
    e.preventDefault();
  };
  const rootItems: ContextMenuItem[] = assets.exists
    ? [
        { label: '放大檢視（整棵樹）', onClick: openAssetViewer },
        SEP,
        { label: '建立', children: [{ label: '類別（例如 立繪、道具）', onClick: () => void startCreate(null) }] },
        SEP,
        { label: `在檔案總管中開啟「${ASSET_DIR}」`, onClick: () => reveal(ASSET_DIR) },
        { label: '重新讀取', onClick: done },
      ]
    : [{ label: `建立「${ASSET_DIR}」資料夾`, onClick: () => void createDir() }];
  const typeItems = (): ContextMenuItem[] => [
    ...FAVS.map((f) => ({
      label: `${types.has(f.id) ? '✓ ' : '　 '}${f.label}`,
      onClick: () =>
        setTypes((t) => {
          const next = new Set(t);
          if (next.has(f.id)) next.delete(f.id);
          else next.add(f.id);
          return next;
        }),
    })),
    { label: '清除篩選', disabled: types.size === 0, onClick: () => setTypes(new Set()) },
  ];

  // ───── 畫出來 ─────
  const renamingRel = editing?.mode === 'rename' ? editing.rel : null;
  const renameInput = (rel: string, isFile: boolean) => (
    <NameInput
      initial={baseOf(rel)}
      selectTo={isFile && !assetAt(rel)?.missing ? splitExt(baseOf(rel))[0].length : undefined}
      onSubmit={(name) => renameAsset(rel, name.trim())}
      onClose={() => (setEditing(null), nav.focus())}
    />
  );
  const chevron = (row: Row) => <TreeArrow kids={row.kids} open={row.open} onToggle={(alt) => toggleRow(row, alt)} />;
  const assetIcon = (a: Asset) =>
    a.missing ? (
      <span className="asset-missing-icon"><Icon icon="file-media" /></span>
    ) : a.image ? (
      <img className="asset-thumb" src={imageSrc(a.path)} loading="lazy" alt="" draggable={false} onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
    ) : (
      <Icon icon="file" className="tree-icon" />
    );
  const renderRow = (row: Row) => {
    const pad = 4 + row.depth * INDENT;
    if (row.kind === 'create') {
      return (
        <div key="create" className="tree-row ap-row" style={{ paddingLeft: pad }}>
          <span className="ap-arrow" />
          {row.what === 'asset' && row.place ? (
            <>
              <span className="asset-missing-icon"><Icon icon="file-media" /></span>
              <NameInput onSubmit={(name) => createAsset(row.place!, name)} onClose={() => setEditing(null)} />
            </>
          ) : (
            <>
              <Icon icon="folder" className="tree-icon" />
              <NameInput onSubmit={(name) => create(row.place, name)} onClose={() => setEditing(null)} />
            </>
          )}
        </div>
      );
    }
    const cls = `tree-row ap-row${nav.rowCls(row.id)}`;
    const common = {
      'data-row': row.id,
      style: { paddingLeft: pad },
      onClick: (e: React.MouseEvent) => nav.click(e, row.id),
      onDoubleClick: () => activate(row),
      onContextMenu: (e: React.MouseEvent) => rowMenu(e, row),
    };
    if (row.kind === 'root')
      return (
        <div key={row.id} className={`${cls} ap-group`} {...common}>
          {chevron(row)}
          <Icon icon={row.open ? 'folder-opened' : 'folder'} className="tree-icon" />
          <span className="tree-label">{ASSET_DIR}</span>
        </div>
      );
    if (row.kind === 'place') {
      const open = row.open;
      return (
        <div
          key={row.id}
          className={`${cls}${dropKey === row.rel ? ' drop-target' : ''}`}
          title={row.isCat ? `類別 = 指令參數 [${row.place.category}]（${row.count} 個）` : row.rel}
          {...common}
          {...dragSource(row)}
          {...dropTarget(row.place, row.rel)}
        >
          {chevron(row)}
          <Icon icon={open && row.hasKids ? 'folder-opened' : 'folder'} className={`tree-icon${row.isCat ? ' ap-cat-icon' : ''}`} />
          {renamingRel === row.rel ? renameInput(row.rel, false) : <span className="tree-label">{baseOf(row.rel)}</span>}
          {row.isCat && <span className="asset-count">{row.count}</span>}
        </div>
      );
    }
    const a = row.asset;
    return (
      <div
        key={row.id}
        className={`${cls} asset-row${a.duplicate ? ' duplicate' : ''}${a.missing ? ' missing' : ''}`}
        title={`${a.note ? `${a.note}\n` : ''}${a.name}\n${a.missing ? '還沒有檔案（點兩下開啟，再選擇檔案）' : a.path}${a.duplicate ? '\n⚠ 有別的資源算出同一個名稱' : ''}`}
        {...common}
        {...dragSource(row)}
        {...dropTarget({ category: a.category, folder: a.folder }, row.id)}
      >
        {!row.flat && <span className="ap-arrow" />}
        {assetIcon(a)}
        {renamingRel === a.path ? (
          renameInput(a.path, true)
        ) : (
          <span className="tree-label">
            {a.label}
            {a.note && <span className="asset-note">{a.note}</span>}
            {row.flat && <span className="ap-where">{[a.category, ...a.folder.split('/').filter(Boolean)].join(' › ')}</span>}
          </span>
        )}
        {a.duplicate && <Icon icon="warning" className="asset-warn" />}
      </div>
    );
  };
  const cur = rowById(cursor);
  const pathText =
    cur?.kind === 'asset' ? `${cur.asset.path}${cur.asset.missing ? '（還沒有檔案）' : ''}` : cur?.kind === 'place' ? cur.rel : cur?.kind === 'root' ? ASSET_DIR : '';
  const empty = assets.categories.length === 0;
  return (
    <div
      className={`section asset-section${props.fill ? ' filler' : ''}${props.floating ? ' floating' : ''}${short ? ' short' : ''}`}
      data-section={id}
      data-slot={props.slot ?? id}
      style={!props.fill && !short ? { height: props.height } : undefined}
    >
      <div
        className="section-header"
        onMouseDown={(e) => {
          if (e.button === 0 && !(e.target as HTMLElement).closest('button')) props.onHeaderDrag(props.slot ?? id, e);
        }}
        onContextMenu={(e) => openMenu(e, rootItems)}
      >
        {!props.floating && <FoldButton id={id} folded={props.folded.includes(id)} onFold={props.onFold} />}
        <SectionTitle id={id} slot={props.slot ?? id} stacks={props.stacks} title={meta.title} tip={`專案的「${ASSET_DIR}」資料夾：第一層是類別，類別名稱就是指令參數（例如 [立繪]）`} />
        <span className="section-actions">
          <button className="icon-btn" data-tip="放大檢視：一次看到所有資源" onClick={openAssetViewer}>
            <Icon icon="screen-full" />
          </button>
          <button className="icon-btn" data-tip="重新讀取資源資料夾" onClick={done}>
            <Icon icon="refresh" />
          </button>
          <button className="icon-btn" data-tip={assets.exists ? `在檔案總管中開啟「${ASSET_DIR}」` : `建立「${ASSET_DIR}」資料夾`} onClick={() => (assets.exists ? reveal(ASSET_DIR) : void createDir())}>
            <Icon icon="folder-opened" />
          </button>
        </span>
      </div>
      {!assets.exists && editing === null ? (
        <div className="section-body" onContextMenu={(e) => openMenu(e, rootItems)}>
          <div className="scene-note">
            在專案資料夾建立「{ASSET_DIR}」資料夾，第一層放類別（例如 立繪、道具、序列圖），類別裡用資料夾分層放檔案。
            <br />
            例如 {ASSET_DIR}/立繪/桃花/常服/一般.png 的名稱是「桃花_常服_一般」，指令用法寫 [立繪] 就能選它。
            <div>
              <button type="button" className="link" onClick={() => void createDir()}>建立「{ASSET_DIR}」資料夾</button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <TreeToolbar
            plusTip="建立：資源、資料夾、類別（加在選到的位置）"
            onPlus={(x, y) => openMenuAt(x, y, plusItems())}
            query={query}
            setQuery={setQuery}
            placeholder="搜尋名稱或備註"
            onSearchDown={() => (nav.focus(), rows[0] && selectOnly(rows[0].id))}
          >
            <button
              type="button"
              className={`ap-filter${types.size ? ' on' : ''}`}
              data-tip="依類型篩選"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                openMenuAt(r.left, r.bottom + 2, typeItems());
              }}
            >
              <Icon icon="list-flat" />
              {types.size > 0 && <span className="ap-badge">{types.size}</span>}
            </button>
          </TreeToolbar>
          {searching && (
            <SearchHead
              text={
                <>
                  {types.size > 0 && [...types].map((t) => FAVS.find((f) => f.id === t)!.label).join('、')}
                  {types.size > 0 && query.trim() && '・'}
                  {query.trim() && `「${query.trim()}」`}　{rows.length} 個
                </>
              }
              onBack={() => (setQuery(''), setTypes(new Set()))}
            />
          )}
          <div className="section-body ap-tree" {...nav.treeProps} onContextMenu={(e) => openMenu(e, rootItems)}>
            {rows.map((r) => (
              <Fragment key={r.id}>{renderRow(r)}</Fragment>
            ))}
            {searching && rows.length === 0 && <div className="scene-note">沒有符合的資源。</div>}
            {!searching && empty && editing === null && (
              <div className="scene-note">還沒有類別。在「{ASSET_DIR}」上按右鍵 › 建立 › 類別（例如 立繪、道具），再把檔案拖進來。</div>
            )}
          </div>
          <PathBar icon={cur?.kind === 'asset' ? 'file-media' : 'folder'} text={pathText} count={selected.size} />
        </>
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={menu.items} />}
      {importing && (
        <AssetImportDialog
          place={importing.place}
          items={importing.items}
          existing={namesIn(assets, importing.place)}
          onConfirm={confirmImport}
          onCancel={() => setImporting(null)}
        />
      )}
    </div>
  );
}
