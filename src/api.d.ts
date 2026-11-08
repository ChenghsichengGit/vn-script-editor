// window.api 的型別：由 src/platform.ts 提供（接到 src-tauri/src/lib.rs 的指令），所有路徑都是絕對路徑

interface DirEntry {
  name: string;
  kind: 'file' | 'directory';
}

interface RecentProject {
  name: string;
  path: string;
}

type MenuEvent =
  | { type: 'new-project' }
  | { type: 'open-project' }
  | { type: 'open-recent'; path: string }
  | { type: 'close-project' }
  | { type: 'open-settings' }
  | { type: 'close-tab' }
  | { type: 'copy-for-ai' }
  | { type: 'pack-project' }
  | { type: 'import-project' }
  | { type: 'export-project' }
  | { type: 'show-shortcuts' }
  | { type: 'show-syntax' }
  | { type: 'check-update' }
  | { type: 'show-about' };
interface AppApi {
  listDir(path: string): Promise<DirEntry[]>;
  readText(path: string): Promise<string>;
  writeText(path: string, text: string): Promise<void>; // 會先建立上層資料夾
  mkdir(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string, opts?: { recursive?: boolean }): Promise<void>;
  exists(path: string): Promise<boolean>;
  saveImage(root: string, name: string, data: Uint8Array): Promise<string>;
  importImage(root: string): Promise<string | null>; // 跳出選圖片的視窗；取消回傳 null
  removeUnusedImages(root: string, used: string, minAgeSecs: number): Promise<string[]>;
  pickFolder(): Promise<string | null>; // 取消時回傳 null
  getRecent(): Promise<RecentProject[]>;
  rememberProject(name: string, path: string): Promise<void>;
  forgetProject(path: string): Promise<void>;
  allowRoot(path: string): Promise<boolean>; // 重新開啟最近的專案前呼叫
  claimProject(path: string): Promise<boolean>;
  releaseProject(): Promise<void>; // 這個視窗關掉了專案（回到開始畫面）
  watchProject(path: string): Promise<void>;
  onFsChange(cb: (paths: string[]) => void): () => void;
  exportSaveText(defaultName: string, text: string): Promise<boolean>;
  packProject(root: string, defaultName: string, exclude: string[]): Promise<boolean>;
  unpackProject(): Promise<string | null>;
  newWindow(): Promise<void>;
  isFirstWindow: boolean;
  onMenu(cb: (event: MenuEvent) => void): () => void;
  onAppClosing(cb: () => void): () => void;
  readyToClose(): void;
  setZoom(factor: number): void; // 整個畫面的縮放，1 = 100%
}

interface Window {
  api: AppApi;
}
