// 畫面和桌面程式（Tauri，src-tauri/src/lib.rs）之間的橋：把 window.api 的每個功能接到 Rust 那邊的指令
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';

const thisWindow = getCurrentWebviewWindow();

function subscribe<T>(event: string, cb: (payload: T) => void): () => void {
  let stop: (() => void) | null = null;
  let cancelled = false;
  void thisWindow.listen<T>(event, (e) => cb(e.payload)).then((unlisten) => {
    if (cancelled) unlisten();
    else stop = unlisten;
  });
  return () => {
    cancelled = true;
    stop?.();
  };
}

window.api = {
  listDir: (path) => invoke('fs_list_dir', { path }),
  readText: (path) => invoke('fs_read_text', { path }),
  writeText: (path, text) => invoke('fs_write_text', { path, text }),
  mkdir: (path) => invoke('fs_mkdir', { path }),
  rename: (from, to) => invoke('fs_rename', { from, to }),
  remove: (path, opts) => invoke('fs_remove', { path, recursive: !!opts?.recursive }),
  exists: (path) => invoke('fs_exists', { path }),
  saveImage: (root, name, data) =>
    invoke('image_save', data, { headers: { 'x-root': encodeURIComponent(root), 'x-name': encodeURIComponent(name) } }),
  importImage: (root) => invoke('image_import', { root }),
  removeUnusedImages: (root, used, minAgeSecs) => invoke('image_remove_unused', { root, used, minAgeSecs }),
  pickFolder: () => invoke('project_pick_folder'),
  getRecent: () => invoke('project_get_recent'),
  rememberProject: (name, path) => invoke('project_remember', { name, path }),
  forgetProject: (path) => invoke('project_forget', { path }),
  allowRoot: (path) => invoke('project_allow_root', { path }),
  claimProject: (path) => invoke('project_claim', { path }),
  releaseProject: () => invoke('project_release'),
  watchProject: (path) => invoke('project_watch', { path }),
  onFsChange: (cb) => subscribe<string[]>('fs-change', cb),
  exportSaveText: (defaultName, text) => invoke('export_save_text', { defaultName, text }),
  packProject: (root, defaultName, exclude) => invoke('project_pack', { root, defaultName, exclude }),
  unpackProject: () => invoke('project_unpack'),
  newWindow: () => invoke('window_new'),
  isFirstWindow: thisWindow.label === 'main',
  onMenu: (cb) => subscribe<MenuEvent>('menu', cb),
  onAppClosing: (cb) => subscribe<null>('app-closing', () => cb()),
  readyToClose: () => void invoke('app_ready_to_close'),
  setZoom: (factor) => void invoke('set_zoom', { factor }),
};
