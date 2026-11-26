// 資源：專案裡的「資源/」資料夾，檔案在檔案總管裡管理，這裡只負責讀出來
// 第一層資料夾是類別（立繪、道具、序列圖…），類別名稱也是指令參數的名稱：用法寫 [立繪] 就會列出立繪的名稱
// 類別下面的檔案就是資源，名稱 = 從類別下一層開始的路徑用 _ 接起來、去掉副檔名
//   資源/立繪/桃花/常服/一般.png → 桃花_常服_一般
//   檔名本身已經是完整名稱（資源/立繪/桃花/常服/桃花_常服_一般.png）就直接用
// 每個資源另外可以有備註名稱和說明，存在專案根目錄的「資源.json」（key = 相對專案的路徑）；備註名稱只用來顯示，劇本裡存的一律是名稱
// 也可以先新增還沒有檔案的資源：只記在資源.json（key = 不含副檔名的路徑，「待補檔案」: true），之後再給檔案
import { useSyncExternalStore } from 'react';
import { joinPath } from './projectFiles';

export const ASSET_DIR = '資源';
export const ASSET_META_FILE = '資源.json';
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif']);
const MAX_DEPTH = 12; // 資料夾最多往下讀幾層（避免捷徑繞圈）

export interface Asset {
  name: string; // 指令裡用的名稱，例如 桃花_常服_一般
  label: string; // 樹狀清單上顯示的短名稱（檔名去掉副檔名），例如 一般
  folder: string; // 類別裡的子資料夾（/ 分隔，類別本身 = 空字串），例如 桃花/常服
  path: string; // 相對專案資料夾的路徑，例如 資源/立繪/桃花/常服/一般.png
  image: boolean;
  duplicate: boolean; // 同一個類別裡有別的檔案算出同一個名稱
  category: string;
  note: string; // 備註名稱（資源.json；沒有 = 空字串）
  desc: string; // 說明（資源.json）
  missing: boolean; // 還沒有檔案（只登記在資源.json；path 沒有副檔名）
}

export interface AssetCategory {
  name: string; // 類別名稱 = 參數名稱
  folders: string[]; // 所有子資料夾（/ 分隔）
  assets: Asset[];
}

export interface AssetTree {
  exists: boolean; // 專案裡有沒有「資源/」資料夾
  categories: AssetCategory[];
}

export const EMPTY_ASSETS: AssetTree = { exists: false, categories: [] };

const byName = (a: string, b: string) => a.localeCompare(b, 'zh-Hant', { numeric: true });
const skipped = (name: string) => name.startsWith('.') || name.startsWith('~$') || /^(thumbs\.db|desktop\.ini)$/i.test(name);

export function assetName(folder: string, file: string): string {
  const dot = file.lastIndexOf('.');
  const base = dot > 0 ? file.slice(0, dot) : file;
  const prefix = folder.split('/').filter(Boolean).join('_');
  if (!prefix || base === prefix || base.startsWith(`${prefix}_`)) return base;
  return `${prefix}_${base}`;
}

async function scanCategory(root: string, category: string): Promise<AssetCategory> {
  const folders: string[] = [];
  const assets: Asset[] = [];
  const walk = async (folder: string, depth: number) => {
    const rel = [ASSET_DIR, category, ...folder.split('/').filter(Boolean)];
    let entries: DirEntry[];
    try {
      entries = await window.api.listDir(joinPath(root, ...rel));
    } catch {
      return;
    }
    for (const e of entries) {
      if (skipped(e.name)) continue;
      if (e.kind === 'directory') {
        if (depth >= MAX_DEPTH) continue;
        const sub = folder ? `${folder}/${e.name}` : e.name;
        folders.push(sub);
        await walk(sub, depth + 1);
      } else {
        const dot = e.name.lastIndexOf('.');
        const ext = dot > 0 ? e.name.slice(dot + 1).toLowerCase() : '';
        assets.push({
          name: assetName(folder, e.name),
          label: dot > 0 ? e.name.slice(0, dot) : e.name,
          folder,
          path: [...rel, e.name].join('/'),
          image: IMAGE_EXTS.has(ext),
          duplicate: false,
          category,
          note: '',
          desc: '',
          missing: false,
        });
      }
    }
  };
  await walk('', 0);
  const count = new Map<string, number>();
  for (const a of assets) count.set(a.name, (count.get(a.name) ?? 0) + 1);
  for (const a of assets) a.duplicate = (count.get(a.name) ?? 0) > 1;
  folders.sort(byName);
  assets.sort((a, b) => byName(a.label, b.label) || byName(a.path, b.path));
  return { name: category, folders, assets };
}

export async function scanAssets(root: string): Promise<AssetTree> {
  const dir = joinPath(root, ASSET_DIR);
  if (!(await window.api.exists(dir))) return EMPTY_ASSETS;
  let entries: DirEntry[];
  try {
    entries = await window.api.listDir(dir);
  } catch {
    return EMPTY_ASSETS;
  }
  const names = entries.filter((e) => e.kind === 'directory' && !skipped(e.name)).map((e) => e.name).sort(byName);
  return { exists: true, categories: await Promise.all(names.map((n) => scanCategory(root, n))) };
}

// 位置：某個類別裡的某個資料夾（folder 空字串 = 類別本身）
export interface AssetPlace {
  category: string;
  folder: string;
}
export const placeRel = (p: AssetPlace) => [ASSET_DIR, p.category, ...p.folder.split('/').filter(Boolean)].join('/');

// 檔名拆成主檔名和副檔名（副檔名含點；沒有 = 空字串）
export function splitExt(file: string): [string, string] {
  const dot = file.lastIndexOf('.');
  return dot > 0 ? [file.slice(0, dot), file.slice(dot)] : [file, ''];
}

// 整理成可以用的檔名：去掉 Windows 不允許的字元、前後空白、結尾的點
export const cleanName = (name: string) => name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim().replace(/\.+$/, '');

// 名稱不能用時回傳原因
export function nameProblem(name: string): string | null {
  const n = name.trim();
  if (!n) return '名稱不能是空的';
  if (/[\\/:*?"<>|\u0000-\u001f]/.test(n)) return '名稱不能有 \\ / : * ? " < > |';
  if (/\.$/.test(n)) return '名稱不能用「.」結尾';
  return null;
}

// 某個位置裡已經有的名稱（檔案和子資料夾，小寫）：新增、加入、搬移時檢查重複
export function namesIn(tree: AssetTree, place: AssetPlace): Set<string> {
  const cat = tree.categories.find((c) => c.name === place.category);
  const out = new Set<string>();
  if (!cat) return out;
  for (const a of cat.assets) if (a.folder === place.folder) out.add(a.path.slice(a.path.lastIndexOf('/') + 1).toLowerCase());
  for (const f of cat.folders) {
    const parent = f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '';
    if (parent === place.folder) out.add(f.slice(f.lastIndexOf('/') + 1).toLowerCase());
  }
  return out;
}

// 檔案監看通知的路徑裡有沒有「資源/」底下的（有才需要重新讀）
export function touchesAssets(root: string, paths: string[]): boolean {
  const base = `${root.replace(/\\/g, '/').replace(/\/+$/, '')}/${ASSET_DIR}`.toLowerCase();
  return paths.some((p) => {
    const q = p.replace(/\\/g, '/').toLowerCase();
    return q === base || q.startsWith(`${base}/`);
  });
}

// ───── 目前專案的資源（App 讀資料夾、讀資源.json 後放進來，編輯器、側邊欄、補全都從這裡拿） ─────

export interface AssetInfo {
  備註?: string;
  說明?: string;
  待補檔案?: boolean; // 還沒有檔案的資源（key 是不含副檔名的路徑）
}

let root = '';
let scanned: AssetTree = EMPTY_ASSETS;
let meta: Record<string, AssetInfo> = {};
let merged: AssetTree = EMPTY_ASSETS;
let byPath = new Map<string, Asset>();
let lastWritten: string | null = null; // 最後一次自己寫出去的內容：監看通知讀回來一樣就不用重讀
let writeTimer: number | undefined;
const listeners = new Set<() => void>();

const metaPath = () => joinPath(root, ASSET_META_FILE);
export const assetAbsPath = (rel: string) => joinPath(root, ...rel.split('/'));
const normPath = (p: string) => p.replace(/\\/g, '/');

// 資源.json 裡還沒有檔案的資源 → 資源/類別/資料夾…/名稱
function placeholderOf(key: string): { category: string; folder: string; label: string } | null {
  const parts = key.split('/');
  if (parts.length < 3 || parts[0] !== ASSET_DIR) return null;
  return { category: parts[1], folder: parts.slice(2, -1).join('/'), label: parts[parts.length - 1] };
}

function rebuild() {
  byPath = new Map();
  const categories = scanned.categories.map((c) => ({ ...c, folders: [...c.folders], assets: [...c.assets] }));
  for (const [key, info] of Object.entries(meta)) {
    if (!info.待補檔案) continue;
    const at = placeholderOf(key);
    if (!at) continue;
    let cat = categories.find((c) => c.name === at.category);
    if (!cat) {
      if (!scanned.exists) continue;
      cat = { name: at.category, folders: [], assets: [] };
      categories.push(cat);
      categories.sort((a, b) => byName(a.name, b.name));
    }
    const segs = at.folder.split('/').filter(Boolean);
    for (let i = 1; i <= segs.length; i++) {
      const f = segs.slice(0, i).join('/');
      if (!cat.folders.includes(f)) cat.folders.push(f), cat.folders.sort(byName);
    }
    // 同一個資料夾裡已經有同名的檔案：就是那個檔案（setScannedAssets 會把記錄搬過去）
    if (cat.assets.some((a) => a.folder === at.folder && a.label.toLowerCase() === at.label.toLowerCase())) continue;
    cat.assets.push({ name: assetName(at.folder, at.label), label: at.label, folder: at.folder, path: key, image: false, duplicate: false, category: at.category, note: '', desc: '', missing: true });
  }
  merged = {
    exists: scanned.exists,
    categories: categories.map((c) => {
      const count = new Map<string, number>();
      for (const a of c.assets) count.set(a.name, (count.get(a.name) ?? 0) + 1);
      const assets = c.assets
        .map((a) => {
          const info = meta[a.path];
          const out = { ...a, note: info?.備註?.trim() ?? '', desc: info?.說明 ?? '', duplicate: (count.get(a.name) ?? 0) > 1 };
          byPath.set(a.path, out);
          return out;
        })
        .sort((a, b) => byName(a.label, b.label) || byName(a.path, b.path));
      return { ...c, assets };
    }),
  };
  listeners.forEach((f) => f());
}

// 還沒有檔案的資源，資料夾裡出現了同名的檔案（例如在檔案總管放進去）：備註、說明搬給那個檔案
function adoptFiles() {
  let next: Record<string, AssetInfo> | null = null;
  const moves: [string, string][] = [];
  for (const [key, info] of Object.entries(meta)) {
    if (!info.待補檔案) continue;
    const at = placeholderOf(key);
    const file = at && scanned.categories.find((c) => c.name === at.category)?.assets.find((a) => a.folder === at.folder && a.label.toLowerCase() === at.label.toLowerCase());
    if (!file) continue;
    next ??= { ...meta };
    delete next[key];
    const { 待補檔案: _, ...rest } = info;
    next[file.path] = { ...rest, ...next[file.path] };
    moves.push([key, file.path]);
  }
  if (!next) return;
  meta = next;
  scheduleWrite();
  for (const [from, to] of moves) assetMoved(from, to);
}

export function onAssetsChange(f: () => void) {
  listeners.add(f);
  return () => void listeners.delete(f);
}
export const getAssets = () => merged;
export const useAssets = () => useSyncExternalStore(onAssetsChange, getAssets);

// 換專案（root 空字串 = 關閉專案）
export function resetAssets(next: string) {
  window.clearTimeout(writeTimer);
  writeTimer = undefined;
  root = next;
  scanned = EMPTY_ASSETS;
  meta = {};
  lastWritten = null;
  rebuild();
  setOpenPath(null);
}

export function setScannedAssets(forRoot: string, tree: AssetTree) {
  if (forRoot !== root) return;
  scanned = tree;
  adoptFiles();
  rebuild();
}

function parseMeta(text: string): Record<string, AssetInfo> {
  try {
    const data = JSON.parse(text) as unknown;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    const out: Record<string, AssetInfo> = {};
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue;
      const { 備註, 說明, 待補檔案 } = v as Record<string, unknown>;
      const info: AssetInfo = {};
      if (typeof 備註 === 'string') info.備註 = 備註;
      if (typeof 說明 === 'string') info.說明 = 說明;
      if (待補檔案 === true) info.待補檔案 = true;
      out[normPath(k)] = info;
    }
    return out;
  } catch {
    return {};
  }
}

// 讀資源.json（打開專案、檔案監看說它變了的時候）；自己還有沒寫出去的修改就先不讀
export async function loadAssetMeta(forRoot: string) {
  if (forRoot !== root || writeTimer !== undefined) return;
  const path = metaPath();
  const text = (await window.api.exists(path)) ? await window.api.readText(path).catch(() => null) : '';
  if (text === null || forRoot !== root || writeTimer !== undefined || text === lastWritten) return;
  meta = text.trim() ? parseMeta(text) : {};
  adoptFiles();
  rebuild();
}

export const isAssetMetaPath = (forRoot: string, paths: string[]) => {
  const target = normPath(joinPath(forRoot, ASSET_META_FILE)).toLowerCase();
  return paths.some((p) => normPath(p).toLowerCase() === target);
};

function serialize() {
  const out: Record<string, AssetInfo> = {};
  for (const key of Object.keys(meta).sort((a, b) => a.localeCompare(b, 'zh-Hant', { numeric: true }))) {
    const info: AssetInfo = {};
    if (meta[key].備註?.trim()) info.備註 = meta[key].備註;
    if (meta[key].說明?.trim()) info.說明 = meta[key].說明;
    if (meta[key].待補檔案) info.待補檔案 = true;
    if (Object.keys(info).length) out[key] = info;
  }
  return JSON.stringify(out, null, 2) + '\n';
}

// 修改先反映在畫面上，停一下才寫檔（打字時不會每個字寫一次）
function scheduleWrite() {
  window.clearTimeout(writeTimer);
  const forRoot = root;
  writeTimer = window.setTimeout(() => void flushAssetMeta(forRoot), 400);
}
export async function flushAssetMeta(forRoot = root) {
  if (writeTimer === undefined || forRoot !== root) return;
  window.clearTimeout(writeTimer);
  writeTimer = undefined;
  const text = serialize();
  lastWritten = text;
  const exists = await window.api.exists(metaPath()).catch(() => false);
  if (!exists && text.trim() === '{}') return; // 沒有任何備註：不用特地建檔
  await window.api.writeText(metaPath(), text).catch((e) => window.alert(`無法儲存「${ASSET_META_FILE}」：${e instanceof Error ? e.message : String(e)}`));
}

export function updateAssetInfo(path: string, patch: AssetInfo) {
  meta = { ...meta, [path]: { ...meta[path], ...patch } };
  rebuild();
  scheduleWrite();
}

// 在編輯器裡改名／搬移：備註跟著搬（資料夾 = 裡面所有的檔案）
export function moveAssetInfo(from: string, to: string) {
  let changed = false;
  const next: Record<string, AssetInfo> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (k === from || k.startsWith(`${from}/`)) {
      next[to + k.slice(from.length)] = v;
      changed = true;
    } else next[k] = v;
  }
  if (!changed) return;
  meta = next;
  rebuild();
  scheduleWrite();
}

// 在編輯器裡刪除：備註一起刪掉
export function dropAssetInfo(rel: string) {
  const keys = Object.keys(meta).filter((k) => k === rel || k.startsWith(`${rel}/`));
  if (!keys.length) return;
  meta = { ...meta };
  for (const k of keys) delete meta[k];
  rebuild();
  scheduleWrite();
}

export const assetAt = (path: string) => byPath.get(path);
export const findAsset = (category: string, name: string) => merged.categories.find((c) => c.name === category)?.assets.find((a) => a.name === name);
// 詳細內容的 [[名稱]]：卡片找不到時看看是不是資源（第一個同名的）
export function assetNamed(name: string) {
  for (const c of merged.categories) {
    const hit = c.assets.find((a) => a.name === name);
    if (hit) return hit;
  }
  return undefined;
}
export const assetTitle = (a: Asset) => a.note || a.name;

// App 提供的動作：打開資源視窗前（關掉卡片的放大檢視）、重新讀資料夾
type AssetActions = { beforeOpen: () => void; rescan: () => void };
let actions: AssetActions = { beforeOpen: () => undefined, rescan: () => undefined };
export const setAssetActions = (a: AssetActions) => void (actions = a);
export const rescanAssetFolder = () => actions.rescan();

// 開著的資源編輯視窗（null = 關著）
let openPath: string | null = null;
const openListeners = new Set<() => void>();
function setOpenPath(p: string | null) {
  openPath = p;
  openListeners.forEach((f) => f());
}
export const useOpenAsset = () =>
  useSyncExternalStore(
    (f) => (openListeners.add(f), () => void openListeners.delete(f)),
    () => openPath,
  );
export const openAsset = (path: string) => (actions.beforeOpen(), setOpenPath(path));
export const closeAsset = () => setOpenPath(null);
// 改名或搬移：開著的視窗跟著換到新路徑
export function assetMoved(from: string, to: string) {
  if (openPath && (openPath === from || openPath.startsWith(`${from}/`))) setOpenPath(to + openPath.slice(from.length));
}

// 打開視窗時要不要直接選取檔名欄（先給檔案、之後再取名）
let focusName: string | null = null;
export const requestAssetNameFocus = (path: string) => void (focusName = path);
export function takeAssetNameFocus(path: string) {
  if (focusName !== path) return false;
  focusName = null;
  return true;
}

// 某個位置裡有沒有同名（不看副檔名）的資源或資料夾；except = 自己（改名時）
export function stemTaken(place: AssetPlace, stem: string, except?: string) {
  const cat = merged.categories.find((c) => c.name === place.category);
  const s = stem.toLowerCase();
  if (!cat) return false;
  if (cat.assets.some((a) => a.folder === place.folder && a.path !== except && a.label.toLowerCase() === s)) return true;
  return cat.folders.some((f) => (f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '') === place.folder && f.slice(f.lastIndexOf('/') + 1).toLowerCase() === s);
}

// 新增還沒有檔案的資源（只記在資源.json）；回傳路徑或錯誤
export function createEmptyAsset(place: AssetPlace, raw: string): { path: string } | { error: string } {
  const stem = raw.trim();
  const bad = nameProblem(stem);
  if (bad) return { error: bad };
  if (stemTaken(place, stem)) return { error: '這裡已經有同名的資源或資料夾' };
  const path = `${placeRel(place)}/${stem}`;
  meta = { ...meta, [path]: { 待補檔案: true } };
  rebuild();
  scheduleWrite();
  return { path };
}

export type AssetSource = { kind: 'path'; path: string } | { kind: 'file'; file: File };
const sourceName = (s: AssetSource) => (s.kind === 'path' ? s.path.replace(/\\/g, '/').split('/').pop() ?? '' : s.file.name);
async function writeSource(s: AssetSource, target: string) {
  if (s.kind === 'path') await window.api.copyAssetFile(s.path, target);
  else await window.api.writeAssetFile(target, new Uint8Array(await s.file.arrayBuffer()));
}

// 給檔案（還沒有檔案的資源）或更換檔案：名稱不變，副檔名跟著新檔案
export async function attachAssetFile(rel: string, source: AssetSource): Promise<string | null> {
  const asset = byPath.get(rel);
  if (!asset) return '找不到這個資源';
  const ext = splitExt(sourceName(source))[1].toLowerCase();
  const dir = rel.slice(0, rel.lastIndexOf('/'));
  const target = `${dir}/${asset.label}${ext}`;
  const abs = (p: string) => joinPath(root, ...p.split('/'));
  try {
    if (asset.missing) {
      if (await window.api.exists(abs(target))) return `「${asset.label}${ext}」已經存在`;
      await writeSource(source, abs(target));
    } else {
      // 先寫到暫存檔（. 開頭不會列出來），成功才換掉舊檔
      const temp = `${dir}/.替換中-${Date.now()}${ext}`;
      await writeSource(source, abs(temp));
      await window.api.remove(abs(rel), { recursive: false });
      if (target.toLowerCase() !== rel.toLowerCase() && (await window.api.exists(abs(target)))) await window.api.remove(abs(target), { recursive: false });
      await window.api.rename(abs(temp), abs(target));
    }
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  const info = meta[rel];
  if (info || target !== rel) {
    const next = { ...meta };
    delete next[rel];
    if (info) {
      const { 待補檔案: _, ...rest } = info;
      next[target] = rest;
    }
    meta = next;
    rebuild();
    scheduleWrite();
  }
  if (target !== rel) assetMoved(rel, target);
  rescanAssetFolder();
  return null;
}

// 先給檔案、之後再取名：用原本的檔名加入（重複就加 (2)），回傳加入後的路徑
export async function addAssetFiles(place: AssetPlace, sources: AssetSource[]): Promise<{ added: string[]; errors: string[] }> {
  const added: string[] = [];
  const errors: string[] = [];
  const used = new Set<string>();
  for (const s of sources) {
    const [rawStem, rawExt] = splitExt(sourceName(s));
    const stem0 = cleanName(rawStem) || '未命名';
    let stem = stem0;
    for (let i = 2; stemTaken(place, stem) || used.has(stem.toLowerCase()); i++) stem = `${stem0} (${i})`;
    used.add(stem.toLowerCase());
    const path = `${placeRel(place)}/${stem}${rawExt.toLowerCase()}`;
    try {
      await writeSource(s, joinPath(root, ...path.split('/')));
      added.push(path);
    } catch (e) {
      errors.push(`${sourceName(s)}：${e instanceof Error ? e.message : String(e)}`);
    }
  }
  rescanAssetFolder();
  return { added, errors };
}

// 刪除資源：有檔案就刪檔，備註一起刪
export async function removeAsset(rel: string) {
  if (!byPath.get(rel)?.missing) await window.api.remove(joinPath(root, ...rel.split('/')), { recursive: true });
  dropAssetInfo(rel);
}

// 改名（只改檔名，副檔名不變；name 含副檔名）：檢查、備註跟著搬、通知分頁
export async function renameAsset(rel: string, name: string): Promise<string | null> {
  const bad = nameProblem(name);
  if (bad) return bad;
  const base = rel.slice(rel.lastIndexOf('/') + 1);
  if (name === base) return null;
  const target = `${rel.slice(0, rel.lastIndexOf('/'))}/${name}`;
  const abs = (p: string) => joinPath(root, ...p.split('/'));
  const asset = byPath.get(rel);
  if (asset) {
    const place = { category: asset.category, folder: asset.folder };
    if (stemTaken(place, asset.missing ? name : splitExt(name)[0], rel)) return '這裡已經有同名的資源或資料夾';
  }
  if (asset?.missing) {
    // 還沒有檔案：只改資源.json 裡的記錄
    moveAssetInfo(rel, target);
    assetMoved(rel, target);
    return null;
  }
  if (name.toLowerCase() !== base.toLowerCase() && (await window.api.exists(abs(target)))) return '已經有同名的檔案或資料夾';
  try {
    await window.api.rename(abs(rel), abs(target));
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  moveAssetInfo(rel, target);
  assetMoved(rel, target);
  rescanAssetFolder();
  return null;
}

// 開發時改了這個檔案（熱更新）：讀過的資源、備註、開著的視窗留著，不然畫面會以為沒有資源
if (import.meta.hot) {
  const saved = import.meta.hot.data.assets as
    | { root: string; scanned: AssetTree; meta: Record<string, AssetInfo>; lastWritten: string | null; openPath: string | null; actions: AssetActions }
    | undefined;
  if (saved) {
    ({ root, scanned, meta, lastWritten, openPath, actions } = saved);
    rebuild();
  }
  import.meta.hot.dispose((data) => {
    void flushAssetMeta();
    data.assets = { root, scanned, meta, lastWritten, openPath, actions };
  });
}
