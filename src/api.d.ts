// window.api 的型別：由 src/platform.ts 提供（接到 src-tauri/src/lib.rs 的指令），所有路徑都是絕對路徑
// 注意：此檔不可有 import / export，才會被當成全域宣告

interface DirEntry {
  name: string;
  kind: 'file' | 'directory';
}

interface RecentProject {
  name: string;
  path: string;
}

// 原生選單送來的事件
type MenuEvent =
  | { type: 'new-project' }
  | { type: 'open-project' }
  | { type: 'open-recent'; path: string }
  | { type: 'close-project' }
  | { type: 'open-settings' }
  | { type: 'close-tab' };

interface AppApi {
  // 檔案操作：路徑必須在使用者開啟過的專案資料夾內，否則會丟錯
  listDir(path: string): Promise<DirEntry[]>;
  readText(path: string): Promise<string>;
  writeText(path: string, text: string): Promise<void>; // 會先建立上層資料夾
  mkdir(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string, opts?: { recursive?: boolean }): Promise<void>;
  exists(path: string): Promise<boolean>;

  // 專案資料夾與最近的專案
  pickFolder(): Promise<string | null>; // 取消時回傳 null
  getRecent(): Promise<RecentProject[]>;
  rememberProject(name: string, path: string): Promise<void>;
  forgetProject(path: string): Promise<void>;
  allowRoot(path: string): Promise<boolean>; // 重新開啟最近的專案前呼叫
  // 開專案前呼叫：同一個專案已經在別的視窗開著時，會跳到那個視窗並回傳 false（這個視窗就不要開）
  claimProject(path: string): Promise<boolean>;
  releaseProject(): Promise<void>; // 這個視窗關掉了專案（回到開始畫面）
  // 監看專案資料夾：裡面有東西被新增、修改、刪除（例如 AI 改了檔案），就呼叫 onFsChange（內容是改到的路徑）
  watchProject(path: string): Promise<void>;
  onFsChange(cb: (paths: string[]) => void): () => void;

  // 視窗：可以開很多個（跟 VS Code 一樣）；第一個視窗才會自動開啟上次的專案
  newWindow(): Promise<void>;
  isFirstWindow: boolean;

  // 選單與關閉視窗；onXxx 回傳取消訂閱的函式
  onMenu(cb: (event: MenuEvent) => void): () => void;
  onAppClosing(cb: () => void): () => void;
  readyToClose(): void;

  setZoom(factor: number): void; // 整個畫面的縮放，1 = 100%
}

interface Window {
  api: AppApi;
}
