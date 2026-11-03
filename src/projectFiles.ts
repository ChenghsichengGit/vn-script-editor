// 專案資料夾的讀寫：透過 window.api（src/platform.ts → Tauri 主程式）存取使用者硬碟上的資料夾
//
// 資料夾結構：
//   <project>/project.json   {"name": "...", "version": 1, "schemas": {角色/世界觀/指令的欄位範本}}
//   <project>/劇本/**/*.vns|txt|md
//   <project>/角色/**/*.md  世界觀/**/*.md  指令/**/*.md   （設定卡：YAML front matter + Markdown 內文）
//   每個區塊底下可以有任意層的子資料夾；檔案／卡片屬於哪個資料夾由位置決定，不寫進 YAML

import { dump, load } from 'js-yaml';
import { Card, CardSectionId, Field, ItemOrder, SchemaField, Schemas, SectionId, defaultSchemas } from './model';

export interface ScriptFile {
  name: string; // 含副檔名，例如 "第一章.vns"
  content: string;
  folder: string; // 所在子資料夾（相對於「劇本」資料夾，用 "/" 分隔；'' = 區塊根目錄）
}

export interface ProjectData {
  name: string; // 取自 project.json，沒有就用資料夾名稱
  files: Record<string, ScriptFile>; // key = 記憶體中的 id
  cards: Record<CardSectionId, Card[]>; // card.id = 記憶體中的 id；card.folder = 所在子資料夾
  folders: Record<SectionId, string[]>; // 每個區塊裡所有的子資料夾（含空的、含巢狀的每一層），例如 "第一章"、"第一章/場景1"
  schemas: Schemas; // 每個設定卡區塊的欄位範本，取自 project.json
  order: ItemOrder; // 左側清單的自訂順序，取自 project.json
}

// project.json 裡的 order：只留「區塊 → 資料夾 → 名稱陣列」這個形狀的部分
function normalizeOrder(raw: unknown): ItemOrder {
  const out: ItemOrder = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [section, folders] of Object.entries(raw as Record<string, unknown>)) {
    if (!folders || typeof folders !== 'object') continue;
    const clean: Record<string, string[]> = {};
    for (const [folder, names] of Object.entries(folders as Record<string, unknown>)) {
      if (Array.isArray(names)) clean[folder] = names.filter((n): n is string => typeof n === 'string');
    }
    out[section as SectionId] = clean;
  }
  return out;
}

// 把 project.json 裡的 schemas 整理成合法的範本：認不得的丟掉、同名欄位只留第一個；整個沒有就用預設
// 舊格式（每個區塊直接是欄位陣列）也讀得懂，當成沒有設定名稱參數
function normalizeSchemas(raw: unknown): Schemas {
  const out = defaultSchemas();
  if (!raw || typeof raw !== 'object') return out;
  for (const section of Object.keys(out) as CardSectionId[]) {
    const entry = (raw as Record<string, unknown>)[section] as Record<string, unknown> | unknown[] | undefined;
    const list = Array.isArray(entry) ? entry : entry && typeof entry === 'object' ? entry.fields : undefined;
    if (!Array.isArray(list)) continue;
    const nameParam = !Array.isArray(entry) && typeof entry?.nameParam === 'string' ? entry.nameParam.trim() : '';
    const seen = new Set<string>();
    out[section] = { fields: [] };
    if (nameParam) out[section].nameParam = nameParam;
    out[section].fields = list.flatMap((f): SchemaField[] => {
      const key = typeof f?.key === 'string' ? f.key.trim() : '';
      if (!key || seen.has(key)) return [];
      seen.add(key);
      const param = typeof f.param === 'string' && f.param.trim() ? f.param.trim() : undefined;
      return [param ? { key, param } : { key }];
    });
  }
  return out;
}

// ───────────────────────── 路徑 ─────────────────────────
// 一律用 "/" 接路徑（Windows 也認得），主程式收到後會 resolve 成正規的絕對路徑

export function joinPath(base: string, ...parts: string[]): string {
  return [base.replace(/[\\/]+$/, ''), ...parts].join('/');
}

// 路徑最後一段（資料夾名稱）
export function baseName(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, '');
  return trimmed.slice(Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\')) + 1) || trimmed;
}

// ───────────────────────── 資料夾選取與最近的專案 ─────────────────────────
// 最近的專案清單存在主程式的應用程式資料夾（recent.json），這裡只是轉接

// 開啟系統的資料夾選擇視窗；使用者取消時回傳 null
export function pickFolder(): Promise<string | null> {
  return window.api.pickFolder();
}

export function getRecentProjects(): Promise<{ name: string; path: string }[]> {
  return window.api.getRecent();
}

export function rememberProject(name: string, path: string): Promise<void> {
  return window.api.rememberProject(name, path);
}

export function forgetProject(path: string): Promise<void> {
  return window.api.forgetProject(path);
}

// 重新開啟最近的專案前，要先請主程式允許存取那個資料夾（資料夾不見了就丟錯）
export async function openRecent(path: string): Promise<void> {
  if (!(await window.api.allowRoot(path))) {
    throw new Error(`找不到資料夾「${path}」，可能已被移動或刪除`);
  }
}

// ───────────────────────── 檔名與格式處理 ─────────────────────────

const SCRIPT_DIR = '劇本';
const CARD_DIRS: Record<CardSectionId, string> = {
  characters: '角色',
  world: '世界觀',
  commands: '指令',
};
const SECTIONS = Object.keys(CARD_DIRS) as CardSectionId[];
const SCRIPT_EXT = /\.(vns|txt|md)$/i;

// 去掉 Windows 不允許的字元與控制字元，結尾的點與空白也不行；空字串給預設名稱
export function sanitizeName(raw: string): string {
  // eslint-disable-next-line no-control-regex
  const s = raw.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/[. ]+$/, '');
  return s.trim() === '' ? '未命名' : s;
}

// 新增／改名時檢查名稱能不能用（和 sanitizeName 不同：這裡直接拒絕，讓使用者自己改）
// 回傳錯誤訊息；沒問題回傳 null
export function validateName(raw: string): string | null {
  const s = raw.trim();
  if (s === '') return '請輸入名稱';
  // eslint-disable-next-line no-control-regex
  if (/[\\/:*?"<>|\u0000-\u001f]/.test(s)) return '名稱不能包含 \\ / : * ? " < > |';
  if (/[. ]+$/.test(s)) return '名稱結尾不能是點或空白';
  return null;
}

// 資料夾路徑（"A/B"）的上一層（"A"）、最後一段（"B"），以及接上新的一段
export const parentFolder = (folder: string) => folder.slice(0, Math.max(0, folder.lastIndexOf('/')));
export const folderBase = (folder: string) => folder.slice(folder.lastIndexOf('/') + 1);
export const joinFolder = (parent: string, name: string) => (parent ? `${parent}/${name}` : name);
// folder 是不是 ancestor 本身，或在它底下的任何一層
export const isInFolder = (folder: string, ancestor: string) => folder === ancestor || folder.startsWith(ancestor + '/');

// 劇本檔名沒有副檔名就補 .vns（有任何副檔名都照使用者打的）
export const withScriptExt = (name: string) => (/\.[^./\\]+$/.test(name) ? name : name + '.vns');

// 一個前後都有 "---" 的 YAML 區塊，後面可接內文
const FRONT_MATTER = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

function parseCard(id: string, fileName: string, text: string): Card {
  const baseName = fileName.replace(/\.md$/i, '');
  // 解析失敗時的退路：整份文字當成詳細內容
  const fallback: Card = { id, name: baseName, fields: [], detail: text };

  const m = FRONT_MATTER.exec(text);
  if (!m) return fallback;

  let meta: unknown;
  try {
    meta = load(m[1]);
  } catch {
    return fallback;
  }
  if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) return fallback;
  const obj = meta as Record<string, unknown>;

  const name = obj.name != null && String(obj.name).trim() !== '' ? String(obj.name) : baseName;

  const fields: Field[] = [];
  if (Array.isArray(obj.fields)) {
    for (const f of obj.fields) {
      if (f === null || typeof f !== 'object') continue;
      const r = f as Record<string, unknown>;
      // key / value 一律轉成字串（YAML 可能把 30 解析成數字）
      const field: Field = {
        key: r.key == null ? '' : String(r.key),
        value: r.value == null ? '' : String(r.value),
      };
      if (r.collapsed === true) field.collapsed = true;
      fields.push(field);
    }
  }

  // 前言與內文之間的那一個空行不屬於內文
  const detail = text.slice(m[0].length).replace(/^\r?\n/, '');
  return { id, name, fields, detail };
}

function serializeCard(card: Card): string {
  const fields = card.fields.map((f) => {
    const out: Record<string, unknown> = { key: f.key, value: f.value };
    if (f.collapsed) out.collapsed = true; // 沒摺疊就不寫
    return out;
  });
  const yaml = dump({ name: card.name, fields }, { lineWidth: -1 });
  return `---\n${yaml}---\n\n${card.detail}`;
}

// ───────────────────────── 低階檔案操作 ─────────────────────────

// 刪除檔案；檔案本來就不存在視為成功
async function removeFile(path: string): Promise<void> {
  if (await window.api.exists(path)) await window.api.remove(path);
}

// 遞迴讀一個區塊的資料夾：收集所有子資料夾（含空的）和符合條件的檔案（含內容）
// 以 "." 開頭的資料夾（例如 .git）略過；找不到區塊資料夾就是空的
async function scanTree(
  dirPath: string,
  accept: (name: string) => boolean,
): Promise<{ folders: string[]; files: { folder: string; name: string; text: string }[] }> {
  const out = { folders: [] as string[], files: [] as { folder: string; name: string; text: string }[] };
  if (!(await window.api.exists(dirPath))) return out;

  const walk = async (abs: string, rel: string) => {
    const entries = await window.api.listDir(abs);
    // 依名稱排序，讓每次開啟的順序固定
    entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
    for (const entry of entries) {
      if (entry.kind === 'directory') {
        if (entry.name.startsWith('.')) continue;
        const sub = joinFolder(rel, entry.name);
        out.folders.push(sub);
        await walk(joinPath(abs, entry.name), sub);
      } else if (accept(entry.name)) {
        out.files.push({ folder: rel, name: entry.name, text: await window.api.readText(joinPath(abs, entry.name)) });
      }
    }
  };
  await walk(dirPath, '');
  return out;
}

let idCounter = 0;
const newId = () => `${Date.now().toString(36)}${(idCounter++).toString(36)}`;

// 每個區塊在專案資料夾底下的資料夾名稱
const sectionDir = (section: SectionId) => (section === 'files' ? SCRIPT_DIR : CARD_DIRS[section]);

// 搬移時目標已有同名項目的錯誤訊息
const MOVE_CONFLICT = '目標資料夾裡已經有同名的項目';

// 記憶體 id → 目前在硬碟上的位置（所在子資料夾 + 檔名）
interface Loc {
  folder: string;
  name: string;
}

// ───────────────────────── ProjectStore ─────────────────────────

export class ProjectStore {
  readonly root: string; // 專案資料夾的絕對路徑

  // 每個區塊的 id → 硬碟位置；只有這裡登記過的檔案，我們才會去刪／搬
  private locs: Record<SectionId, Map<string, Loc>> = {
    files: new Map(),
    characters: new Map(),
    world: new Map(),
    commands: new Map(),
  };

  // 所有寫入都排進同一條佇列，自動存檔連續觸發時不會讓寫入與刪除交錯
  private queue: Promise<unknown> = Promise.resolve();

  // project.json 的完整內容：改範本時只換掉 schemas，其他欄位（含以後新增的）原封不動寫回
  private meta: Record<string, unknown> = {};

  private constructor(root: string) {
    this.root = root;
  }

  // 某區塊某個子資料夾的絕對路徑（folder = '' 就是區塊根目錄）
  private dirPath(section: SectionId, folder: string): string {
    return folder ? joinPath(this.root, sectionDir(section), folder) : joinPath(this.root, sectionDir(section));
  }

  static async open(root: string): Promise<{ store: ProjectStore; data: ProjectData }> {
    const store = new ProjectStore(root);

    // 專案名稱：project.json 的 name，讀不到就用資料夾名稱
    let name = baseName(root);
    try {
      const meta = JSON.parse(await window.api.readText(joinPath(root, 'project.json')));
      if (meta && typeof meta === 'object' && !Array.isArray(meta)) store.meta = meta;
      if (meta && typeof meta.name === 'string' && meta.name.trim() !== '') name = meta.name;
    } catch {
      // 沒有或壞掉的 project.json：沿用資料夾名稱
    }

    const folders = { files: [], characters: [], world: [], commands: [] } as ProjectData['folders'];

    // 劇本
    const files: Record<string, ScriptFile> = {};
    const scripts = await scanTree(joinPath(root, SCRIPT_DIR), (n) => SCRIPT_EXT.test(n));
    folders.files = scripts.folders;
    for (const f of scripts.files) {
      const id = newId();
      files[id] = { name: f.name, content: f.text, folder: f.folder };
      store.locs.files.set(id, { folder: f.folder, name: f.name });
    }

    // 三種設定卡
    const cards = { characters: [], world: [], commands: [] } as ProjectData['cards'];
    for (const section of SECTIONS) {
      const tree = await scanTree(joinPath(root, CARD_DIRS[section]), (n) => /\.md$/i.test(n));
      folders[section] = tree.folders;
      for (const f of tree.files) {
        const id = newId();
        cards[section].push({ ...parseCard(id, f.name, f.text), folder: f.folder });
        store.locs[section].set(id, { folder: f.folder, name: f.name });
      }
    }

    return { store, data: { name, files, cards, folders, schemas: normalizeSchemas(store.meta.schemas), order: normalizeOrder(store.meta.order) } };
  }

  static async create(root: string, name: string): Promise<{ store: ProjectStore; data: ProjectData }> {
    const meta = { name, version: 1, schemas: defaultSchemas() };
    await window.api.writeText(joinPath(root, 'project.json'), JSON.stringify(meta, null, 2) + '\n');
    // 四個子資料夾 + 一個空白的起始劇本
    for (const section of SECTIONS) await window.api.mkdir(joinPath(root, CARD_DIRS[section]));
    await window.api.writeText(joinPath(root, SCRIPT_DIR, '第一章.vns'), '');
    return ProjectStore.open(root);
  }

  // 存欄位範本：寫回 project.json（只換 schemas）
  saveSchemas(schemas: Schemas): Promise<void> {
    return this.enqueue(async () => {
      this.meta = { ...this.meta, schemas };
      await window.api.writeText(joinPath(this.root, 'project.json'), JSON.stringify(this.meta, null, 2) + '\n');
    });
  }

  // 存左側清單的自訂順序：寫回 project.json（只換 order）
  saveOrder(order: ItemOrder): Promise<void> {
    return this.enqueue(async () => {
      this.meta = { ...this.meta, order };
      await window.api.writeText(joinPath(this.root, 'project.json'), JSON.stringify(this.meta, null, 2) + '\n');
    });
  }

  // 把一個動作排到佇列尾端；前一個失敗不會卡住後面的，但錯誤仍會回傳給該次呼叫者
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  // 在「同一個資料夾」裡找一個不與其他項目衝突的檔名，衝突就加 " 2"、" 3"…
  // Windows 檔名不分大小寫，所以比對時一律轉小寫
  private uniqueName(section: SectionId, selfId: string, folder: string, wanted: string, ext: string): string {
    const taken = new Set<string>();
    for (const [id, loc] of this.locs[section]) {
      if (id !== selfId && loc.folder === folder) taken.add(loc.name.toLowerCase());
    }
    if (!taken.has(wanted.toLowerCase())) return wanted;
    const stem = ext && wanted.toLowerCase().endsWith(ext.toLowerCase()) ? wanted.slice(0, -ext.length) : wanted;
    for (let i = 2; ; i++) {
      const candidate = `${stem} ${i}${ext}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  }

  // 寫入檔案；位置（資料夾或檔名）有變就搬／改名：優先用真正的 rename（保留檔案本身），
  // 失敗（例如舊檔其實已不在）就退回「先寫新檔、再刪舊檔」，中途失敗也不會丟資料
  private async writeAndRename(
    section: SectionId,
    id: string,
    folder: string,
    newName: string,
    text: string,
  ): Promise<void> {
    const locs = this.locs[section];
    const old = locs.get(id);
    const newPath = joinPath(this.dirPath(section, folder), newName);

    if (old === undefined || (old.folder === folder && old.name === newName)) {
      await window.api.writeText(newPath, text);
      locs.set(id, { folder, name: newName });
      return;
    }

    const oldPath = joinPath(this.dirPath(section, old.folder), old.name);
    let renamed = false;
    try {
      await window.api.rename(oldPath, newPath);
      renamed = true;
    } catch {
      // 改名失敗：下面退回寫新檔再刪舊檔
    }
    await window.api.writeText(newPath, text);
    locs.set(id, { folder, name: newName });
    // 只差大小寫時在 Windows 是同一個檔案，刪掉舊名等於刪掉剛寫的，所以跳過
    if (!renamed && oldPath.toLowerCase() !== newPath.toLowerCase()) await removeFile(oldPath);
  }

  saveFile(id: string, file: ScriptFile): Promise<void> {
    return this.enqueue(async () => {
      const wanted = sanitizeName(file.name);
      // 撞名時把 " 2" 插在副檔名前面
      const name = this.uniqueName('files', id, file.folder, wanted, /\.[^.]*$/.exec(wanted)?.[0] ?? '');
      await this.writeAndRename('files', id, file.folder, name, file.content);
    });
  }

  deleteFile(id: string): Promise<void> {
    return this.enqueue(async () => {
      const old = this.locs.files.get(id);
      if (old === undefined) return; // 從沒存過也沒載入過：硬碟上沒有對應檔案
      await removeFile(joinPath(this.dirPath('files', old.folder), old.name));
      this.locs.files.delete(id);
    });
  }

  saveCard(section: CardSectionId, card: Card): Promise<void> {
    return this.enqueue(async () => {
      const folder = card.folder ?? '';
      const name = this.uniqueName(section, card.id, folder, sanitizeName(card.name) + '.md', '.md');
      await this.writeAndRename(section, card.id, folder, name, serializeCard(card));
    });
  }

  deleteCard(section: CardSectionId, id: string): Promise<void> {
    return this.enqueue(async () => {
      const old = this.locs[section].get(id);
      if (old === undefined) return;
      await removeFile(joinPath(this.dirPath(section, old.folder), old.name));
      this.locs[section].delete(id);
    });
  }

  // ── 搬移（拖曳到別的資料夾；立即執行，不經過自動存檔）──

  // 把單一檔案／卡片搬到 toFolder，檔名不變（沿用硬碟上現在的檔名）
  // 目標已有同名項目就丟錯；還沒存過的（沒登記位置）不用搬，之後存檔自然會存到新資料夾
  private moveItem(section: SectionId, id: string, toFolder: string): Promise<void> {
    return this.enqueue(async () => {
      const old = this.locs[section].get(id);
      if (old === undefined || old.folder === toFolder) return;
      const newPath = joinPath(this.dirPath(section, toFolder), old.name);
      if (await window.api.exists(newPath)) throw new Error(MOVE_CONFLICT);
      await window.api.rename(joinPath(this.dirPath(section, old.folder), old.name), newPath);
      this.locs[section].set(id, { folder: toFolder, name: old.name });
    });
  }

  moveFile(id: string, toFolder: string): Promise<void> {
    return this.moveItem('files', id, toFolder);
  }

  moveCard(section: CardSectionId, id: string, toFolder: string): Promise<void> {
    return this.moveItem(section, id, toFolder);
  }

  // 把資料夾連同裡面所有內容搬到 toParent 底下（名稱不變），回傳新路徑
  // 不能搬進自己或自己的子資料夾；目標已有同名項目也會丟錯。裡面每個登記過的檔案位置一併更新
  moveFolder(section: SectionId, folder: string, toParent: string): Promise<string> {
    return this.enqueue(async () => {
      if (folder === '') throw new Error('不能移動區塊的根目錄');
      if (isInFolder(toParent, folder)) throw new Error('不能把資料夾移到它自己或它的子資料夾裡');
      const newRel = joinFolder(toParent, folderBase(folder));
      if (newRel === folder) return folder; // 本來就在那裡
      const newAbs = this.dirPath(section, newRel);
      if (await window.api.exists(newAbs)) throw new Error(MOVE_CONFLICT);
      await window.api.rename(this.dirPath(section, folder), newAbs);
      for (const loc of this.locs[section].values()) {
        if (isInFolder(loc.folder, folder)) loc.folder = newRel + loc.folder.slice(folder.length);
      }
      return newRel;
    });
  }

  // ── 資料夾（立即執行，不經過自動存檔）──

  // 在 parent 底下建立子資料夾 name，回傳新資料夾的路徑；已經存在就丟錯
  createFolder(section: SectionId, parent: string, name: string): Promise<string> {
    return this.enqueue(async () => {
      const rel = joinFolder(parent, name);
      const abs = this.dirPath(section, rel);
      if (await window.api.exists(abs)) throw new Error('已經有同名的項目');
      await window.api.mkdir(abs);
      return rel;
    });
  }

  // 資料夾改名，回傳新路徑；裡面所有檔案／卡片的位置一併更新，之後存檔就會存到新位置
  renameFolder(section: SectionId, folder: string, newName: string): Promise<string> {
    return this.enqueue(async () => {
      const newRel = joinFolder(parentFolder(folder), newName);
      const oldAbs = this.dirPath(section, folder);
      const newAbs = this.dirPath(section, newRel);
      // 只差大小寫時 exists 會回報「有」（其實是自己），這種情況直接改
      if (folder.toLowerCase() !== newRel.toLowerCase() && (await window.api.exists(newAbs))) {
        throw new Error('已經有同名的項目');
      }
      await window.api.rename(oldAbs, newAbs);
      for (const loc of this.locs[section].values()) {
        if (isInFolder(loc.folder, folder)) loc.folder = newRel + loc.folder.slice(folder.length);
      }
      return newRel;
    });
  }

  // 連同裡面所有內容一起刪除，並把裡面的檔案從登記中拿掉
  deleteFolder(section: SectionId, folder: string): Promise<void> {
    return this.enqueue(async () => {
      if (folder === '') throw new Error('不能刪除區塊的根目錄');
      const abs = this.dirPath(section, folder);
      if (await window.api.exists(abs)) await window.api.remove(abs, { recursive: true });
      for (const [id, loc] of [...this.locs[section]]) {
        if (isInFolder(loc.folder, folder)) this.locs[section].delete(id);
      }
    });
  }
}
