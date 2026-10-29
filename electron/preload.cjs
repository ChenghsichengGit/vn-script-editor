// 預載腳本：在網頁與主程序之間搭橋，只開放必要的功能給 window.api
// （contextIsolation 開啟，網頁拿不到 ipcRenderer 本身）

const { contextBridge, ipcRenderer } = require('electron');

// 訂閱主程序送來的事件，回傳取消訂閱的函式
function subscribe(channel, cb) {
  const handler = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('api', {
  // 檔案操作（絕對路徑）
  listDir: (p) => ipcRenderer.invoke('fs:listDir', p),
  readText: (p) => ipcRenderer.invoke('fs:readText', p),
  writeText: (p, text) => ipcRenderer.invoke('fs:writeText', p, text),
  mkdir: (p) => ipcRenderer.invoke('fs:mkdir', p),
  rename: (from, to) => ipcRenderer.invoke('fs:rename', from, to),
  remove: (p, opts) => ipcRenderer.invoke('fs:remove', p, opts),
  exists: (p) => ipcRenderer.invoke('fs:exists', p),

  // 專案資料夾與最近的專案
  pickFolder: () => ipcRenderer.invoke('project:pickFolder'),
  getRecent: () => ipcRenderer.invoke('project:getRecent'),
  rememberProject: (name, p) => ipcRenderer.invoke('project:remember', name, p),
  forgetProject: (p) => ipcRenderer.invoke('project:forget', p),
  allowRoot: (p) => ipcRenderer.invoke('project:allowRoot', p),

  // 選單與關閉視窗
  onMenu: (cb) => subscribe('menu', cb),
  onAppClosing: (cb) => subscribe('app-closing', () => cb()),
  readyToClose: () => ipcRenderer.send('app:readyToClose'),
});
