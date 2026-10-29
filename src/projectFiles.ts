// 專案資料夾的讀寫：透過 Electron 的 window.api（主程序用 Node 的 fs）存取使用者硬碟上的資料夾
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

// ───────────────────────── 路徑 ─────────────────────────
// 一律用 "/" 接路徑（Windows 也認得），主程序收到後會 resolve 成正規的絕對路徑

export function joinPath(base: string, ...parts: string[]): string {
  return [base.replace(/[\\/]+$/, ''), ...parts].join('/');
}

// 路徑最後一段（資料夾名稱）
export function baseName(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, '');
  return trimmed.slice(Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\')) + 1) || trimmed;
}

// ───────────────────────── 資料夾選取與最近的專案 ─────────────────────────
// 最近的專案清單存在主程序的 userData/recent.json，這裡只是轉接

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

// 重新開啟最近的專案前，要先請主程序允許存取那個資料夾（資料夾不見了就丟錯）
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

// 刪除檔案；檔案本來就不存在視為成功
async function removeFile(path: string): Promise<void> {
  if (await window.api.exists(path)) await window.api.remove(path);
}

// 列出資料夾內符合條件的檔案（忽略子資料夾）；資料夾不存在就是空清單
async function listFiles(
  dirPath: string,
  accept: (name: string) => boolean,
): Promise<{ name: string; text: string }[]> {
  const out: { name: string; text: string }[] = [];
  if (!(await window.api.exists(dirPath))) return out;
  for (const entry of await window.api.listDir(dirPath)) {
    if (entry.kind !== 'file' || !accept(entry.name)) continue;
    out.push({ name: entry.name, text: await window.api.readText(joinPath(dirPath, entry.name)) });
  }
  // 依檔名排序，讓每次開啟的順序固定
  out.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
  return out;
}

let idCounter = 0;
const newId = () => `${Date.now().toString(36)}${(idCounter++).toString(36)}`;

// ───────────────────────── ProjectStore ─────────────────────────

export class ProjectStore {
  readonly root: string; // 專案資料夾的絕對路徑

  // 記憶體 id → 目前在硬碟上的檔名；只有這裡登記過的檔案，我們才會去刪
  private fileNames = new Map<string, string>();
  private cardNames: Record<CardSectionId, Map<string, string>> = {
    characters: new Map(),
    world: new Map(),
    commands: new Map(),
  };

  // 所有寫入都排進同一條佇列，自動存檔連續觸發時不會讓寫入與刪除交錯
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(root: string) {
    this.root = root;
  }

  static async open(root: string): Promise<{ store: ProjectStore; data: ProjectData }> {
    const store = new ProjectStore(root);

    // 專案名稱：project.json 的 name，讀不到就用資料夾名稱
    let name = baseName(root);
    try {
      const meta = JSON.parse(await window.api.readText(joinPath(root, 'project.json')));
      if (meta && typeof meta.name === 'string' && meta.name.trim() !== '') name = meta.name;
    } catch {
      // 沒有或壞掉的 project.json：沿用資料夾名稱
    }

    // 劇本
    const files: Record<string, ScriptFile> = {};
    for (const f of await listFiles(joinPath(root, SCRIPT_DIR), (n) => SCRIPT_EXT.test(n))) {
      const id = newId();
      files[id] = { name: f.name, content: f.text };
      store.fileNames.set(id, f.name);
    }

    // 三種設定卡
    const cards = { characters: [], world: [], commands: [] } as ProjectData['cards'];
    for (const section of SECTIONS) {
      for (const f of await listFiles(joinPath(root, CARD_DIRS[section]), (n) => /\.md$/i.test(n))) {
        const id = newId();
        cards[section].push(parseCard(id, f.name, f.text));
        store.cardNames[section].set(id, f.name);
      }
    }

    return { store, data: { name, files, cards } };
  }

  static async create(root: string, name: string): Promise<{ store: ProjectStore; data: ProjectData }> {
    await window.api.writeText(joinPath(root, 'project.json'), JSON.stringify({ name, version: 1 }, null, 2) + '\n');
    // 四個子資料夾 + 一個空白的起始劇本
    for (const section of SECTIONS) await window.api.mkdir(joinPath(root, CARD_DIRS[section]));
    await window.api.writeText(joinPath(root, SCRIPT_DIR, '第一章.vns'), '');
    return ProjectStore.open(root);
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

  // 寫入檔案；檔名有變就改名：優先用真正的 rename（保留檔案本身），
  // 失敗（例如舊檔其實已不在）就退回「先寫新檔、再刪舊檔」，中途失敗也不會丟資料
  private async writeAndRename(
    dirPath: string,
    names: Map<string, string>,
    id: string,
    newName: string,
    text: string,
  ): Promise<void> {
    const oldName = names.get(id);
    const newPath = joinPath(dirPath, newName);

    if (oldName === undefined || oldName === newName) {
      await window.api.writeText(newPath, text);
      names.set(id, newName);
      return;
    }

    const oldPath = joinPath(dirPath, oldName);
    let renamed = false;
    try {
      await window.api.rename(oldPath, newPath);
      renamed = true;
    } catch {
      // 改名失敗：下面退回寫新檔再刪舊檔
    }
    await window.api.writeText(newPath, text);
    names.set(id, newName);
    // 只差大小寫時在 Windows 是同一個檔案，刪掉舊名等於刪掉剛寫的，所以跳過
    if (!renamed && oldName.toLowerCase() !== newName.toLowerCase()) await removeFile(oldPath);
  }

  saveFile(id: string, file: ScriptFile): Promise<void> {
    return this.enqueue(async () => {
      const dirPath = joinPath(this.root, SCRIPT_DIR);
      const wanted = sanitizeName(file.name);
      // 撞名時把 " 2" 插在副檔名前面
      const name = this.uniqueName(this.fileNames, id, wanted, /\.[^.]*$/.exec(wanted)?.[0] ?? '');
      await this.writeAndRename(dirPath, this.fileNames, id, name, file.content);
    });
  }

  deleteFile(id: string): Promise<void> {
    return this.enqueue(async () => {
      const old = this.fileNames.get(id);
      if (old === undefined) return; // 從沒存過也沒載入過：硬碟上沒有對應檔案
      await removeFile(joinPath(this.root, SCRIPT_DIR, old));
      this.fileNames.delete(id);
    });
  }

  saveCard(section: CardSectionId, card: Card): Promise<void> {
    return this.enqueue(async () => {
      const dirPath = joinPath(this.root, CARD_DIRS[section]);
      const names = this.cardNames[section];
      const name = this.uniqueName(names, card.id, sanitizeName(card.name) + '.md', '.md');
      await this.writeAndRename(dirPath, names, card.id, name, serializeCard(card));
    });
  }

  deleteCard(section: CardSectionId, id: string): Promise<void> {
    return this.enqueue(async () => {
      const names = this.cardNames[section];
      const old = names.get(id);
      if (old === undefined) return;
      await removeFile(joinPath(this.root, CARD_DIRS[section], old));
      names.delete(id);
    });
  }
}
