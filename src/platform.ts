// 畫面和桌面程式（Tauri，src-tauri/src/lib.rs）之間的橋：把 window.api 的每個功能接到 Rust 那邊的指令
// 畫面其他地方都只用 window.api（型別在 api.d.ts），不直接碰 Tauri；之後換平台只要改這個檔
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

// 訂閱主程式送來的事件，回傳取消訂閱的函式
// （Tauri 的 listen 是非同步的：還沒訂閱好就取消時，等它訂閱好再立刻取消）
function subscribe<T>(event: string, cb: (payload: T) => void): () => void {
  let stop: (() => void) | null = null;
  let cancelled = false;
  void listen<T>(event, (e) => cb(e.payload)).then((unlisten) => {
    if (cancelled) unlisten();
    else stop = unlisten;
  });
  return () => {
    cancelled = true;
    stop?.();
  };
}

window.api = {
  // 檔案操作（絕對路徑）
  listDir: (path) => invoke('fs_list_dir', { path }),
  readText: (path) => invoke('fs_read_text', { path }),
  writeText: (path, text) => invoke('fs_write_text', { path, text }),
  mkdir: (path) => invoke('fs_mkdir', { path }),
  rename: (from, to) => invoke('fs_rename', { from, to }),
  remove: (path, opts) => invoke('fs_remove', { path, recursive: !!opts?.recursive }),
  exists: (path) => invoke('fs_exists', { path }),

  // 專案資料夾與最近的專案
  pickFolder: () => invoke('project_pick_folder'),
  getRecent: () => invoke('project_get_recent'),
  rememberProject: (name, path) => invoke('project_remember', { name, path }),
  forgetProject: (path) => invoke('project_forget', { path }),
  allowRoot: (path) => invoke('project_allow_root', { path }),

  // 選單與關閉視窗
  onMenu: (cb) => subscribe<MenuEvent>('menu', cb),
  onAppClosing: (cb) => subscribe<null>('app-closing', () => cb()),
  readyToClose: () => void invoke('app_ready_to_close'),

  // 整個畫面的縮放（設定裡的「UI 大小」）
  setZoom: (factor) => void invoke('set_zoom', { factor }),
};
