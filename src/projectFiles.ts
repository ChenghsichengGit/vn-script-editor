// 專案資料夾的讀寫：透過 window.api（src/platform.ts → Tauri 主程式）存取使用者硬碟上的資料夾

import { dump, load } from 'js-yaml';
import { Card, CardSectionId, Field, ItemOrder, MEMORY_KINDS, Memory, SchemaField, Schemas, SectionId, defaultSchemas } from './model';
import { cleanFieldColor, cleanFieldIcon } from './fieldIcons';
import { FILES_SECTION, SectionDef, SectionRemoval, normalizeSections } from './sections';

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
  sections: SectionDef[]; // 設定卡區塊的清單（角色、世界觀、指令、自己加的…），取自 project.json
  schemas: Schemas; // 每個設定卡區塊的欄位範本，取自 project.json
  order: ItemOrder; // 左側清單的自訂順序，取自 project.json
}

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

function normalizeSchemas(raw: unknown, ids: CardSectionId[]): Schemas {
  const out = defaultSchemas(ids);
  if (!raw || typeof raw !== 'object') return out;
  for (const section of ids) {
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
      const icon = cleanFieldIcon(f.icon);
      const color = icon ? cleanFieldColor(f.color) : undefined;
      const type = f.type === 'image' ? ('image' as const) : undefined;
      return [{ key, ...(param && { param }), ...(icon && { icon }), ...(color && { color }), ...(type && { type }), ...(f.collapsed === true && { collapsed: true }) }];
    });
  }
  return out;
}

export function joinPath(base: string, ...parts: string[]): string {
  return [base.replace(/[\\/]+$/, ''), ...parts].join('/');
}

export function baseName(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, '');
  return trimmed.slice(Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\')) + 1) || trimmed;
}

export const pickFolder = () => window.api.pickFolder();

export async function assertProject(root: string): Promise<void> {
  if (!(await window.api.exists(joinPath(root, 'project.json')))) {
    throw new Error(`「${baseName(root)}」不是 VN Script Editor 專案（裡面沒有 project.json）。要開新的專案，請用「建立新專案」。`);
  }
}
export const getRecentProjects = () => window.api.getRecent();
export const rememberProject = (name: string, path: string) => window.api.rememberProject(name, path);
export const forgetProject = (path: string) => window.api.forgetProject(path);

export async function openRecent(path: string): Promise<void> {
  if (!(await window.api.allowRoot(path))) {
    throw new Error(`找不到資料夾「${path}」，可能已被移動或刪除`);
  }
}

const SCRIPT_DIR = FILES_SECTION.dir;
const SCRIPT_EXT = /\.(vns|txt|md)$/i;

export function sanitizeName(raw: string): string {
  // eslint-disable-next-line no-control-regex
  const s = raw.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/[. ]+$/, '');
  return s.trim() === '' ? '未命名' : s;
}

export function validateName(raw: string): string | null {
  const s = raw.trim();
  if (s === '') return '請輸入名稱';
  // eslint-disable-next-line no-control-regex
  if (/[\\/:*?"<>|\u0000-\u001f]/.test(s)) return '名稱不能包含 \\ / : * ? " < > |';
  if (/[. ]+$/.test(s)) return '名稱結尾不能是點或空白';
  return null;
}

export const parentFolder = (folder: string) => folder.slice(0, Math.max(0, folder.lastIndexOf('/')));
export const folderBase = (folder: string) => folder.slice(folder.lastIndexOf('/') + 1);
export const joinFolder = (parent: string, name: string) => (parent ? `${parent}/${name}` : name);
export const isInFolder = (folder: string, ancestor: string) => folder === ancestor || folder.startsWith(ancestor + '/');

export const withScriptExt = (name: string) => (/\.[^./\\]+$/.test(name) ? name : name + '.vns');

const FRONT_MATTER = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

function parseCard(id: string, fileName: string, text: string): Card {
  const baseName = fileName.replace(/\.md$/i, '');
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
      const field: Field = { key: r.key == null ? '' : String(r.key), value: r.value == null ? '' : String(r.value) };
      if (r.collapsed === true) field.collapsed = true;
      if (r.type === 'image') field.type = 'image';
      fields.push(field);
    }
  }
  const memories: Memory[] = [];
  if (Array.isArray(obj.memories)) {
    const str = (v: unknown) => (v == null ? '' : String(v));
    for (const x of obj.memories) {
      if (x === null || typeof x !== 'object') continue;
      const r = x as Record<string, unknown>;
      const kind = MEMORY_KINDS.find((k) => k === r.kind) ?? '事件';
      memories.push({ time: str(r.time), target: str(r.target), kind, text: str(r.text), source: str(r.source) });
    }
  }
  const detail = text.slice(m[0].length).replace(/^\r?\n/, '');
  return { id, name, fields, detail, ...(memories.length > 0 && { memories }) };
}

function serializeCard(card: Card): string {
  const fields = card.fields.map((f) => {
    const out: Record<string, unknown> = { key: f.key, value: f.value };
    if (f.collapsed) out.collapsed = true; // 沒摺疊就不寫
    if (f.type === 'image') out.type = 'image'; // 文字欄位不寫
    return out;
  });
  const memories = (card.memories ?? []).map((mem) => {
    const out: Record<string, string> = { time: mem.time, target: mem.target, kind: mem.kind, text: mem.text, source: mem.source };
    for (const k of ['time', 'target', 'source'] as const) if (!out[k]) delete out[k];
    return out;
  });
  const yaml = dump({ name: card.name, fields, ...(memories.length > 0 && { memories }) }, { lineWidth: -1 });
  return `---\n${yaml}---\n\n${card.detail}`;
}

async function removeFile(path: string): Promise<void> {
  if (await window.api.exists(path)) await window.api.remove(path);
}

async function scanTree(
  dirPath: string,
  accept: (name: string) => boolean,
): Promise<{ folders: string[]; files: { folder: string; name: string; text: string }[] }> {
  const out = { folders: [] as string[], files: [] as { folder: string; name: string; text: string }[] };
  if (!(await window.api.exists(dirPath))) return out;
  const walk = async (abs: string, rel: string) => {
    const entries = await window.api.listDir(abs);
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
const MOVE_CONFLICT = '目標資料夾裡已經有同名的項目';
const isScript = (n: string) => SCRIPT_EXT.test(n);
const isCard = (n: string) => /\.md$/i.test(n);

interface Loc {
  folder: string;
  name: string;
}

export interface DiskChanges {
  files: { changed: (ScriptFile & { id: string })[]; added: (ScriptFile & { id: string })[]; removed: string[] };
  cards: Record<CardSectionId, { changed: Card[]; added: Card[]; removed: string[] }>;
  folders: ProjectData['folders'];
  meta: { schemas: Schemas; order: ItemOrder; sections: SectionDef[] } | null; // project.json 有變才有
}

// project.json 的內容：不是物件就當作沒有
const parseMeta = (text: string): Record<string, unknown> | null => {
  try {
    const meta = JSON.parse(text);
    return meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : null;
  } catch {
    return null;
  }
};

export class ProjectStore {
  readonly root: string; // 專案資料夾的絕對路徑
  private locMaps: Record<SectionId, Map<string, Loc>> = {}; // id → 硬碟上的位置
  private knownMaps: Record<SectionId, Map<string, string>> = {}; // id → 上次讀到或寫入的內容（判斷外部有沒有改）
  private sections: SectionDef[] = [];
  private knownMeta = '';
  private queue: Promise<unknown> = Promise.resolve();
  private meta: Record<string, unknown> = {};
  private constructor(root: string) {
    this.root = root;
  }
  private locs = (section: SectionId) => (this.locMaps[section] ??= new Map());
  private known = (section: SectionId) => (this.knownMaps[section] ??= new Map());
  private dirOf = (section: SectionId) => (section === FILES_SECTION.id ? SCRIPT_DIR : (this.sections.find((s) => s.id === section)?.dir ?? section));
  private dirPath = (section: SectionId, folder: string) => joinPath(this.root, this.dirOf(section), ...(folder ? [folder] : []));
  private pathOf = (section: SectionId, loc: Loc) => joinPath(this.dirPath(section, loc.folder), loc.name);
  private track(section: SectionId, id: string, folder: string, name: string, text: string) {
    this.locs(section).set(id, { folder, name });
    this.known(section).set(id, text);
  }
  // 讀進一個設定卡區塊：每個 .md 一張卡
  private async loadCards(section: SectionId, dir: string) {
    const tree = await scanTree(dir, isCard);
    const cards = tree.files.map((f) => {
      const id = newId();
      this.track(section, id, f.folder, f.name, f.text);
      return { ...parseCard(id, f.name, f.text), folder: f.folder };
    });
    return { cards, folders: tree.folders };
  }
  static async open(root: string): Promise<{ store: ProjectStore; data: ProjectData }> {
    await assertProject(root);
    const store = new ProjectStore(root);
    store.knownMeta = await window.api.readText(joinPath(root, 'project.json')).catch(() => '');
    store.meta = parseMeta(store.knownMeta) ?? {};
    const name = typeof store.meta.name === 'string' && store.meta.name.trim() ? store.meta.name : baseName(root);
    store.sections = normalizeSections(store.meta.sections);
    const ids = store.sections.map((s) => s.id);
    const scripts = await scanTree(joinPath(root, SCRIPT_DIR), isScript);
    const folders: ProjectData['folders'] = { files: scripts.folders };
    const files: Record<string, ScriptFile> = {};
    for (const f of scripts.files) {
      const id = newId();
      files[id] = { name: f.name, content: f.text, folder: f.folder };
      store.track('files', id, f.folder, f.name, f.text);
    }
    const cards: ProjectData['cards'] = {};
    for (const section of ids) ({ cards: cards[section], folders: folders[section] } = await store.loadCards(section, joinPath(root, store.dirOf(section))));
    const data = { name, files, cards, folders, sections: store.sections, schemas: normalizeSchemas(store.meta.schemas, ids), order: normalizeOrder(store.meta.order) };
    return { store, data };
  }
  static async create(root: string, name: string): Promise<{ store: ProjectStore; data: ProjectData }> {
    const sections = normalizeSections(undefined);
    const meta = { name, version: 1, schemas: defaultSchemas(sections.map((s) => s.id)) };
    await window.api.writeText(joinPath(root, 'project.json'), JSON.stringify(meta, null, 2) + '\n');
    for (const s of sections) await window.api.mkdir(joinPath(root, s.dir));
    await window.api.writeText(joinPath(root, SCRIPT_DIR, '第一章.vns'), '');
    return ProjectStore.open(root);
  }
  private saveMeta(patch: Record<string, unknown>) {
    this.meta = { ...this.meta, ...patch };
    this.knownMeta = JSON.stringify(this.meta, null, 2) + '\n';
    return window.api.writeText(joinPath(this.root, 'project.json'), this.knownMeta);
  }
  saveSchemas = (schemas: Schemas) => this.enqueue(() => this.saveMeta({ schemas }));
  saveOrder = (order: ItemOrder) => this.enqueue(() => this.saveMeta({ order }));
  // 區塊設定：改名的區塊把資料夾改名、刪掉的（勾了刪資料夾才）刪資料夾、新的讀進來
  updateSections(next: SectionDef[], removals: SectionRemoval[]): Promise<{ id: string; cards: Card[]; folders: string[] }[]> {
    return this.enqueue(async () => {
      const old = new Map(this.sections.map((s) => [s.id, s]));
      const pathOf = (dir: string) => joinPath(this.root, dir);
      const renamed = next.flatMap((s) => {
        const o = old.get(s.id);
        return o && o.dir !== s.dir ? [{ from: o, to: s }] : [];
      });
      for (const { from, to } of renamed) {
        if (from.dir.toLowerCase() !== to.dir.toLowerCase() && (await window.api.exists(pathOf(to.dir))))
          throw new Error(`專案裡已經有「${to.dir}」資料夾，「${from.title}」不能改成這個名稱`);
      }
      for (const rm of removals) {
        const s = old.get(rm.id);
        if (!s) continue;
        if (rm.deleteFolder && (await window.api.exists(pathOf(s.dir)))) await window.api.remove(pathOf(s.dir), { recursive: true });
        delete this.locMaps[rm.id];
        delete this.knownMaps[rm.id];
      }
      for (const { from, to } of renamed) {
        if (await window.api.exists(pathOf(from.dir))) await window.api.rename(pathOf(from.dir), pathOf(to.dir));
        else await window.api.mkdir(pathOf(to.dir));
      }
      const loaded: { id: string; cards: Card[]; folders: string[] }[] = [];
      for (const s of next.filter((s) => !old.has(s.id))) {
        await window.api.mkdir(pathOf(s.dir));
        loaded.push({ id: s.id, ...(await this.loadCards(s.id, pathOf(s.dir))) });
      }
      this.sections = next;
      await this.saveMeta({ sections: next });
      return loaded;
    });
  }
  // 重新掃一遍硬碟，跟上次知道的內容比：新增、改過、不見的（外部修改、一起寫的人改的）
  syncFromDisk(): Promise<DiskChanges> {
    return this.enqueue(async () => {
      const ids = this.sections.map((s) => s.id);
      const changes: DiskChanges = { files: { changed: [], added: [], removed: [] }, cards: {}, folders: {}, meta: null };
      const key = (folder: string, name: string) => `${folder}/${name}`.toLowerCase();
      const syncSection = async (section: SectionId, accept: (name: string) => boolean) => {
        const tree = await scanTree(joinPath(this.root, this.dirOf(section)), accept);
        changes.folders[section] = tree.folders;
        const byPath = new Map([...this.locs(section)].map(([id, loc]) => [key(loc.folder, loc.name), id]));
        const seen = new Set<string>();
        const result: { id: string; folder: string; name: string; text: string; isNew: boolean }[] = [];
        for (const f of tree.files) {
          const old = byPath.get(key(f.folder, f.name));
          const id = old ?? newId();
          seen.add(id);
          if (old !== undefined && this.known(section).get(id) === f.text) continue; // 沒變
          this.track(section, id, f.folder, f.name, f.text);
          result.push({ id, folder: f.folder, name: f.name, text: f.text, isNew: old === undefined });
        }
        const removed = [...this.locs(section).keys()].filter((id) => !seen.has(id));
        for (const id of removed) this.forget(section, id);
        return { result, removed };
      };
      const scripts = await syncSection('files', isScript);
      for (const f of scripts.result) (f.isNew ? changes.files.added : changes.files.changed).push({ id: f.id, name: f.name, folder: f.folder, content: f.text });
      changes.files.removed = scripts.removed;
      for (const section of ids) {
        const synced = await syncSection(section, isCard);
        const out = (changes.cards[section] = { changed: [] as Card[], added: [] as Card[], removed: synced.removed });
        for (const f of synced.result) (f.isNew ? out.added : out.changed).push({ ...parseCard(f.id, f.name, f.text), folder: f.folder });
      }
      const text = await window.api.readText(joinPath(this.root, 'project.json')).catch(() => this.knownMeta);
      const meta = text !== this.knownMeta ? parseMeta(text) : null;
      this.knownMeta = text;
      if (meta) {
        this.meta = meta;
        changes.meta = { schemas: normalizeSchemas(meta.schemas, ids), order: normalizeOrder(meta.order), sections: this.sections };
      }
      return changes;
    });
  }
  // 所有寫入排成一列依序做，不會同時改到同一個檔案
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn);
    this.queue = run.catch(() => undefined);
    return run;
  }
  private forget(section: SectionId, id: string) {
    this.locs(section).delete(id);
    this.known(section).delete(id);
  }
  // 同一個資料夾裡不重名：已經有了就在後面加「 2」「 3」…
  private uniqueName(section: SectionId, selfId: string, folder: string, wanted: string, ext: string): string {
    const taken = new Set([...this.locs(section)].filter(([id, loc]) => id !== selfId && loc.folder === folder).map(([, loc]) => loc.name.toLowerCase()));
    const stem = ext && wanted.toLowerCase().endsWith(ext.toLowerCase()) ? wanted.slice(0, -ext.length) : wanted;
    let candidate = wanted;
    for (let i = 2; taken.has(candidate.toLowerCase()); i++) candidate = `${stem} ${i}${ext}`;
    return candidate;
  }
  // 寫檔；名稱或資料夾變了就先改名再寫（改名失敗就寫新檔、刪舊檔）
  private async writeAndRename(section: SectionId, id: string, folder: string, newName: string, text: string): Promise<void> {
    const old = this.locs(section).get(id);
    const newPath = joinPath(this.dirPath(section, folder), newName);
    this.known(section).set(id, text);
    const moved = old !== undefined && (old.folder !== folder || old.name !== newName);
    const oldPath = old && this.pathOf(section, old);
    const renamed = moved && (await window.api.rename(oldPath!, newPath).then(() => true, () => false));
    await window.api.writeText(newPath, text);
    this.locs(section).set(id, { folder, name: newName }); // 寫成功才換位置
    if (moved && !renamed && oldPath!.toLowerCase() !== newPath.toLowerCase()) await removeFile(oldPath!);
  }
  saveFile(id: string, file: ScriptFile): Promise<void> {
    return this.enqueue(async () => {
      const wanted = sanitizeName(file.name);
      const name = this.uniqueName('files', id, file.folder, wanted, /\.[^.]*$/.exec(wanted)?.[0] ?? '');
      await this.writeAndRename('files', id, file.folder, name, file.content);
    });
  }
  saveCard(section: CardSectionId, card: Card): Promise<void> {
    return this.enqueue(async () => {
      const folder = card.folder ?? '';
      const name = this.uniqueName(section, card.id, folder, sanitizeName(card.name) + '.md', '.md');
      await this.writeAndRename(section, card.id, folder, name, serializeCard(card));
    });
  }
  // 硬碟上存的版本（「不儲存」時還原用）
  private readSaved = <T>(section: SectionId, id: string, read: (loc: Loc, text: string) => T) =>
    this.enqueue(async () => {
      const loc = this.locs(section).get(id);
      return loc ? read(loc, await window.api.readText(this.pathOf(section, loc))) : null;
    });
  readSavedFile = (id: string) => this.readSaved('files', id, (loc, content) => ({ name: loc.name, content }));
  readSavedCard = (section: CardSectionId, id: string) => this.readSaved(section, id, (loc, text): Card => ({ ...parseCard(id, loc.name, text), folder: loc.folder }));
  private deleteItem(section: SectionId, id: string): Promise<void> {
    return this.enqueue(async () => {
      const old = this.locs(section).get(id);
      if (old === undefined) return; // 從沒存過也沒載入過：硬碟上沒有對應檔案
      await removeFile(this.pathOf(section, old));
      this.locs(section).delete(id);
    });
  }
  deleteFile = (id: string) => this.deleteItem('files', id);
  deleteCard = (section: CardSectionId, id: string) => this.deleteItem(section, id);
  private moveItem(section: SectionId, id: string, toFolder: string): Promise<void> {
    return this.enqueue(async () => {
      const old = this.locs(section).get(id);
      if (old === undefined || old.folder === toFolder) return;
      const newPath = joinPath(this.dirPath(section, toFolder), old.name);
      if (await window.api.exists(newPath)) throw new Error(MOVE_CONFLICT);
      await window.api.rename(this.pathOf(section, old), newPath);
      this.locs(section).set(id, { folder: toFolder, name: old.name });
    });
  }
  moveFile = (id: string, toFolder: string) => this.moveItem('files', id, toFolder);
  moveCard = (section: CardSectionId, id: string, toFolder: string) => this.moveItem(section, id, toFolder);
  // 資料夾改名或搬走：硬碟上改名，裡面每個檔案記的位置跟著換
  private async relocate(section: SectionId, folder: string, newRel: string, conflict: string) {
    const newAbs = this.dirPath(section, newRel);
    if (folder.toLowerCase() !== newRel.toLowerCase() && (await window.api.exists(newAbs))) throw new Error(conflict);
    await window.api.rename(this.dirPath(section, folder), newAbs);
    for (const loc of this.locs(section).values()) if (isInFolder(loc.folder, folder)) loc.folder = newRel + loc.folder.slice(folder.length);
    return newRel;
  }
  moveFolder(section: SectionId, folder: string, toParent: string): Promise<string> {
    return this.enqueue(async () => {
      if (folder === '') throw new Error('不能移動區塊的根目錄');
      if (isInFolder(toParent, folder)) throw new Error('不能把資料夾移到它自己或它的子資料夾裡');
      const newRel = joinFolder(toParent, folderBase(folder));
      return newRel === folder ? folder : this.relocate(section, folder, newRel, MOVE_CONFLICT);
    });
  }
  renameFolder = (section: SectionId, folder: string, newName: string) =>
    this.enqueue(() => this.relocate(section, folder, joinFolder(parentFolder(folder), newName), '已經有同名的項目'));
  createFolder(section: SectionId, parent: string, name: string): Promise<string> {
    return this.enqueue(async () => {
      const rel = joinFolder(parent, name);
      if (await window.api.exists(this.dirPath(section, rel))) throw new Error('已經有同名的項目');
      await window.api.mkdir(this.dirPath(section, rel));
      return rel;
    });
  }
  deleteFolder(section: SectionId, folder: string): Promise<void> {
    return this.enqueue(async () => {
      if (folder === '') throw new Error('不能刪除區塊的根目錄');
      const abs = this.dirPath(section, folder);
      if (await window.api.exists(abs)) await window.api.remove(abs, { recursive: true });
      for (const [id, loc] of [...this.locs(section)]) if (isInFolder(loc.folder, folder)) this.locs(section).delete(id);
    });
  }
}
