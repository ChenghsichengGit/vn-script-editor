// 專案資料夾的讀寫：用瀏覽器的 File System Access API 直接存取使用者硬碟上的資料夾
//
// 資料夾結構：
//   <project>/project.json   {"name": "...", "version": 1}
//   <project>/劇本/*.vns|txt|md
//   <project>/角色/*.md  世界觀/*.md  指令/*.md   （設定卡：YAML front matter + Markdown 內文）

import { dump, load } from 'js-yaml';
import { Card, CardSectionId, Field } from './model';

export interface ScriptFile {
  name: string; // 含副檔名，例如 "第一章.vns"
  content: string;
}

export interface ProjectData {
  name: string; // 取自 project.json，沒有就用資料夾名稱
  files: Record<string, ScriptFile>; // key = 記憶體中的 id
  cards: Record<CardSectionId, Card[]>; // card.id = 記憶體中的 id
}

export const fsSupported: boolean = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

// ───────────────────────── 資料夾選取與權限 ─────────────────────────

// 開啟系統的資料夾選擇視窗；使用者取消（AbortError）時回傳 null
export async function pickFolder(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await window.showDirectoryPicker({ mode: 'readwrite' });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return null;
    throw e;
  }
}

// 確認有讀寫權限；沒有就跳出請求（requestPermission 必須在使用者點擊的流程中呼叫）
export async function ensurePermission(dir: FileSystemDirectoryHandle): Promise<boolean> {
  const opts = { mode: 'readwrite' as const };
  if ((await dir.queryPermission(opts)) === 'granted') return true;
  return (await dir.requestPermission(opts)) === 'granted';
}

// ───────────────────────── 最近開啟的專案（IndexedDB） ─────────────────────────
// 資料夾 handle 可以被 structured clone，所以能直接存進 IndexedDB

const DB_NAME = 'vn-script-editor';
const STORE = 'recent';
const LIST_KEY = 'list';
const MAX_RECENT = 8;

interface RecentEntry {
  name: string;
  handle: FileSystemDirectoryHandle;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      // 第一次建立：整份清單用同一個 key 存成陣列
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readRecent(): Promise<RecentEntry[]> {
  const db = await openDb();
  try {
    return await new Promise<RecentEntry[]>((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(LIST_KEY);
      req.onsuccess = () => resolve((req.result as RecentEntry[] | undefined) ?? []);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function writeRecent(list: RecentEntry[]): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(list, LIST_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

// 讀改寫是多步驟，用佇列串起來避免兩次呼叫互相覆蓋
let recentQueue: Promise<unknown> = Promise.resolve();
function withRecent<T>(fn: () => Promise<T>): Promise<T> {
  const run = recentQueue.then(fn);
  recentQueue = run.catch(() => undefined);
  return run;
}

// 把清單中與 dir 指向同一個資料夾的項目濾掉
async function withoutSame(list: RecentEntry[], dir: FileSystemDirectoryHandle): Promise<RecentEntry[]> {
  const keep: RecentEntry[] = [];
  for (const e of list) {
    if (!(await e.handle.isSameEntry(dir))) keep.push(e);
  }
  return keep;
}

export function getRecentProjects(): Promise<{ name: string; handle: FileSystemDirectoryHandle }[]> {
  return withRecent(readRecent);
}

export function rememberProject(name: string, dir: FileSystemDirectoryHandle): Promise<void> {
  return withRecent(async () => {
    const rest = await withoutSame(await readRecent(), dir);
    // 最新的放最前面，最多保留 8 筆
    await writeRecent([{ name, handle: dir }, ...rest].slice(0, MAX_RECENT));
  });
}

export function forgetProject(dir: FileSystemDirectoryHandle): Promise<void> {
  return withRecent(async () => {
    await writeRecent(await withoutSame(await readRecent(), dir));
  });
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
function sanitizeName(raw: string): string {
  // eslint-disable-next-line no-control-regex
  const s = raw.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/[. ]+$/, '');
  return s.trim() === '' ? '未命名' : s;
}

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

async function readText(handle: FileSystemFileHandle): Promise<string> {
  return (await handle.getFile()).text();
}

async function writeText(dir: FileSystemDirectoryHandle, name: string, text: string): Promise<void> {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  try {
    await w.write(text);
  } finally {
    await w.close();
  }
}

// 刪除檔案；檔案或資料夾本來就不存在視為成功
async function removeFile(dir: FileSystemDirectoryHandle, name: string): Promise<void> {
  try {
    await dir.removeEntry(name);
  } catch (e) {
    if (e instanceof DOMException && e.name === 'NotFoundError') return;
    throw e;
  }
}

// 取得子資料夾；create=false 且不存在時回傳 null（代表空清單）
async function getSubDir(
  root: FileSystemDirectoryHandle,
  name: string,
  create: boolean,
): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await root.getDirectoryHandle(name, { create });
  } catch (e) {
    if (!create && e instanceof DOMException && e.name === 'NotFoundError') return null;
    throw e;
  }
}

// 列出資料夾內符合條件的檔案（忽略子資料夾）
async function listFiles(
  dir: FileSystemDirectoryHandle | null,
  accept: (name: string) => boolean,
): Promise<{ name: string; text: string }[]> {
  const out: { name: string; text: string }[] = [];
  if (!dir) return out;
  for await (const entry of dir.values()) {
    if (entry.kind !== 'file' || !accept(entry.name)) continue;
    out.push({ name: entry.name, text: await readText(entry as FileSystemFileHandle) });
  }
  // 依檔名排序，讓每次開啟的順序固定
  out.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
  return out;
}

let idCounter = 0;
const newId = () => `${Date.now().toString(36)}${(idCounter++).toString(36)}`;

// ───────────────────────── ProjectStore ─────────────────────────

export class ProjectStore {
  readonly dir: FileSystemDirectoryHandle;

  // 記憶體 id → 目前在硬碟上的檔名；只有這裡登記過的檔案，我們才會去刪
  private fileNames = new Map<string, string>();
  private cardNames: Record<CardSectionId, Map<string, string>> = {
    characters: new Map(),
    world: new Map(),
    commands: new Map(),
  };

  // 所有寫入都排進同一條佇列，自動存檔連續觸發時不會讓寫入與刪除交錯
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(dir: FileSystemDirectoryHandle) {
    this.dir = dir;
  }

  static async open(dir: FileSystemDirectoryHandle): Promise<{ store: ProjectStore; data: ProjectData }> {
    const store = new ProjectStore(dir);

    // 專案名稱：project.json 的 name，讀不到就用資料夾名稱
    let name = dir.name;
    try {
      const meta = JSON.parse(await readText(await dir.getFileHandle('project.json')));
      if (meta && typeof meta.name === 'string' && meta.name.trim() !== '') name = meta.name;
    } catch {
      // 沒有或壞掉的 project.json：沿用資料夾名稱
    }

    // 劇本
    const files: Record<string, ScriptFile> = {};
    for (const f of await listFiles(await getSubDir(dir, SCRIPT_DIR, false), (n) => SCRIPT_EXT.test(n))) {
      const id = newId();
      files[id] = { name: f.name, content: f.text };
      store.fileNames.set(id, f.name);
    }

    // 三種設定卡
    const cards = { characters: [], world: [], commands: [] } as ProjectData['cards'];
    for (const section of SECTIONS) {
      const sub = await getSubDir(dir, CARD_DIRS[section], false);
      for (const f of await listFiles(sub, (n) => /\.md$/i.test(n))) {
        const id = newId();
        cards[section].push(parseCard(id, f.name, f.text));
        store.cardNames[section].set(id, f.name);
      }
    }

    return { store, data: { name, files, cards } };
  }

  static async create(
    dir: FileSystemDirectoryHandle,
    name: string,
  ): Promise<{ store: ProjectStore; data: ProjectData }> {
    await writeText(dir, 'project.json', JSON.stringify({ name, version: 1 }, null, 2) + '\n');
    // 四個子資料夾 + 一個空白的起始劇本
    const scriptDir = await dir.getDirectoryHandle(SCRIPT_DIR, { create: true });
    for (const section of SECTIONS) await dir.getDirectoryHandle(CARD_DIRS[section], { create: true });
    await writeText(scriptDir, '第一章.vns', '');
    return ProjectStore.open(dir);
  }

  // 把一個動作排到佇列尾端；前一個失敗不會卡住後面的，但錯誤仍會回傳給該次呼叫者
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  // 在 names 裡找一個不與「其他項目」衝突的檔名，衝突就加 " 2"、" 3"…
  // Windows 檔名不分大小寫，所以比對時一律轉小寫
  private uniqueName(names: Map<string, string>, selfId: string, wanted: string, ext: string): string {
    const taken = new Set<string>();
    for (const [id, n] of names) if (id !== selfId) taken.add(n.toLowerCase());
    if (!taken.has(wanted.toLowerCase())) return wanted;
    const stem = ext && wanted.toLowerCase().endsWith(ext.toLowerCase()) ? wanted.slice(0, -ext.length) : wanted;
    for (let i = 2; ; i++) {
      const candidate = `${stem} ${i}${ext}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  }

  // 寫入新檔名，成功後再刪掉舊檔名（先寫後刪，中途失敗也不會丟資料）
  private async writeAndRename(
    dir: FileSystemDirectoryHandle,
    names: Map<string, string>,
    id: string,
    newName: string,
    text: string,
  ): Promise<void> {
    const oldName = names.get(id);
    await writeText(dir, newName, text);
    names.set(id, newName);
    // 只差大小寫時在 Windows 是同一個檔案，刪掉舊名等於刪掉剛寫的，所以跳過
    if (oldName !== undefined && oldName.toLowerCase() !== newName.toLowerCase()) {
      await removeFile(dir, oldName);
    }
  }

  saveFile(id: string, file: ScriptFile): Promise<void> {
    return this.enqueue(async () => {
      const dir = (await getSubDir(this.dir, SCRIPT_DIR, true))!;
      const wanted = sanitizeName(file.name);
      // 撞名時把 " 2" 插在副檔名前面
      const name = this.uniqueName(this.fileNames, id, wanted, /\.[^.]*$/.exec(wanted)?.[0] ?? '');
      await this.writeAndRename(dir, this.fileNames, id, name, file.content);
    });
  }

  deleteFile(id: string): Promise<void> {
    return this.enqueue(async () => {
      const old = this.fileNames.get(id);
      if (old === undefined) return; // 從沒存過也沒載入過：硬碟上沒有對應檔案
      const dir = await getSubDir(this.dir, SCRIPT_DIR, false);
      if (dir) await removeFile(dir, old);
      this.fileNames.delete(id);
    });
  }

  saveCard(section: CardSectionId, card: Card): Promise<void> {
    return this.enqueue(async () => {
      const dir = (await getSubDir(this.dir, CARD_DIRS[section], true))!;
      const names = this.cardNames[section];
      const name = this.uniqueName(names, card.id, sanitizeName(card.name) + '.md', '.md');
      await this.writeAndRename(dir, names, card.id, name, serializeCard(card));
    });
  }

  deleteCard(section: CardSectionId, id: string): Promise<void> {
    return this.enqueue(async () => {
      const names = this.cardNames[section];
      const old = names.get(id);
      if (old === undefined) return;
      const dir = await getSubDir(this.dir, CARD_DIRS[section], false);
      if (dir) await removeFile(dir, old);
      names.delete(id);
    });
  }
}
