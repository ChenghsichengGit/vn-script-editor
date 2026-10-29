// Electron 主程序：建立視窗、原生選單、提供檔案讀寫給網頁（renderer）使用
// 用 CommonJS（.cjs），因為 package.json 設了 "type": "module"

const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

let mainWindow = null;

// ───────────────────────── 允許存取的專案資料夾 ─────────────────────────
// 網頁端只能讀寫「使用者親自選過的資料夾」底下的東西，其他路徑一律拒絕

const allowedRoots = new Set();

function addRoot(p) {
  allowedRoots.add(path.resolve(p));
}

// 路徑（先 resolve 成絕對路徑）是否落在某個允許的資料夾之內（含資料夾本身）
// 用 path.relative 判斷，Windows 不分大小寫的規則它會處理；"..\" 開頭代表跑到外面去了
function isInsideRoot(p) {
  const target = path.resolve(p);
  for (const root of allowedRoots) {
    const rel = path.relative(root, target);
    if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) return true;
  }
  return false;
}

// 每個檔案操作都先過這一關；回傳 resolve 後的絕對路徑
function guard(p) {
  if (typeof p !== 'string' || !path.isAbsolute(p)) throw new Error('路徑必須是絕對路徑');
  if (!isInsideRoot(p)) throw new Error('不能存取專案資料夾以外的路徑');
  return path.resolve(p);
}

// ───────────────────────── 最近的專案（userData/recent.json） ─────────────────────────

const MAX_RECENT = 8;
const recentFile = () => path.join(app.getPath('userData'), 'recent.json');

// 路徑比對：Windows 不分大小寫
const samePath = (a, b) => {
  const x = path.resolve(a);
  const y = path.resolve(b);
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
};

async function readRecent() {
  try {
    const list = JSON.parse(await fs.readFile(recentFile(), 'utf8'));
    if (!Array.isArray(list)) return [];
    return list.filter((e) => e && typeof e.name === 'string' && typeof e.path === 'string');
  } catch {
    return []; // 沒有檔案或壞掉：當作空清單
  }
}

async function writeRecent(list) {
  await fs.mkdir(path.dirname(recentFile()), { recursive: true });
  await fs.writeFile(recentFile(), JSON.stringify(list, null, 2), 'utf8');
  await buildMenu(); // 清單變了，「最近的專案」子選單要跟著重建
}

// 讀改寫是多步驟，用佇列串起來避免兩次呼叫互相覆蓋
let recentQueue = Promise.resolve();
function withRecent(fn) {
  const run = recentQueue.then(fn);
  recentQueue = run.catch(() => undefined);
  return run;
}

// ───────────────────────── 原生選單 ─────────────────────────

function sendMenu(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('menu', payload);
}

async function buildMenu() {
  const recent = await readRecent();
  const recentItems =
    recent.length > 0
      ? recent.map((r) => ({
          label: r.name,
          sublabel: r.path,
          click: () => sendMenu({ type: 'open-recent', path: r.path }),
        }))
      : [{ label: '（沒有）', enabled: false }];

  const template = [
    {
      label: '檔案',
      submenu: [
        { label: '新增專案…', click: () => sendMenu({ type: 'new-project' }) },
        { label: '開啟專案資料夾…', accelerator: 'CmdOrCtrl+O', click: () => sendMenu({ type: 'open-project' }) },
        { label: '最近的專案', submenu: recentItems },
        { type: 'separator' },
        { label: '關閉專案', click: () => sendMenu({ type: 'close-project' }) },
        { type: 'separator' },
        { role: 'quit', label: '結束' },
      ],
    },
    // 編輯選單提供復原／重做／剪下／複製／貼上，文字輸入框需要它
    { role: 'editMenu' },
    {
      label: '檢視',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ───────────────────────── IPC：檔案操作（全部用絕對路徑） ─────────────────────────

function registerIpc() {
  ipcMain.handle('fs:listDir', async (_e, p) => {
    const entries = await fs.readdir(guard(p), { withFileTypes: true });
    // 只回報檔案與資料夾，其他（捷徑、裝置等）略過
    return entries
      .filter((d) => d.isFile() || d.isDirectory())
      .map((d) => ({ name: d.name, kind: d.isDirectory() ? 'directory' : 'file' }));
  });

  ipcMain.handle('fs:readText', (_e, p) => fs.readFile(guard(p), 'utf8'));

  ipcMain.handle('fs:writeText', async (_e, p, text) => {
    const target = guard(p);
    if (typeof text !== 'string') throw new Error('內容必須是文字');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, text, 'utf8');
  });

  ipcMain.handle('fs:mkdir', async (_e, p) => {
    await fs.mkdir(guard(p), { recursive: true });
  });

  ipcMain.handle('fs:rename', async (_e, from, to) => {
    await fs.rename(guard(from), guard(to));
  });

  ipcMain.handle('fs:remove', async (_e, p, opts) => {
    const target = guard(p);
    // 專案資料夾本身不能被刪掉
    for (const root of allowedRoots) {
      if (samePath(root, target)) throw new Error('不能刪除專案資料夾本身');
    }
    await fs.rm(target, { recursive: !!(opts && opts.recursive), force: false });
  });

  ipcMain.handle('fs:exists', async (_e, p) => {
    try {
      await fs.access(guard(p));
      return true;
    } catch (e) {
      if (e && e.code === 'ENOENT') return false;
      throw e; // 包含「路徑不被允許」的錯誤
    }
  });

  // 選擇資料夾：選到的才加入允許清單
  ipcMain.handle('project:pickFolder', async () => {
    const opts = { properties: ['openDirectory', 'createDirectory'] };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, opts) : await dialog.showOpenDialog(opts);
    if (result.canceled || result.filePaths.length === 0) return null;
    addRoot(result.filePaths[0]);
    return path.resolve(result.filePaths[0]);
  });

  ipcMain.handle('project:getRecent', () => withRecent(readRecent));

  ipcMain.handle('project:remember', (_e, name, p) =>
    withRecent(async () => {
      if (typeof name !== 'string' || typeof p !== 'string' || !path.isAbsolute(p)) throw new Error('參數錯誤');
      if (!isInsideRoot(p)) throw new Error('只能記住已開啟的專案資料夾');
      const rest = (await readRecent()).filter((e) => !samePath(e.path, p));
      // 最新的放最前面，最多保留 8 筆
      await writeRecent([{ name, path: path.resolve(p) }, ...rest].slice(0, MAX_RECENT));
    }),
  );

  ipcMain.handle('project:forget', (_e, p) =>
    withRecent(async () => {
      await writeRecent((await readRecent()).filter((e) => !samePath(e.path, p)));
    }),
  );

  // 重新開啟最近的專案：只有在最近清單裡、而且資料夾還在，才允許
  ipcMain.handle('project:allowRoot', (_e, p) =>
    withRecent(async () => {
      if (typeof p !== 'string' || !path.isAbsolute(p)) return false;
      if (!(await readRecent()).some((e) => samePath(e.path, p))) return false;
      try {
        if (!(await fs.stat(p)).isDirectory()) return false;
      } catch {
        return false;
      }
      addRoot(p);
      return true;
    }),
  );

  // 渲染端存完檔後呼叫，主程序才真的關掉視窗
  ipcMain.on('app:readyToClose', () => {
    closeConfirmed = true;
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
  });
}

// ───────────────────────── 視窗 ─────────────────────────

// 關閉視窗的流程：先通知網頁把沒存的存完，網頁回報 readyToClose 後才真的關
// （Electron 的 beforeunload 不能跳出確認視窗，所以改用這個流程）
// 網頁若決定不關（例如存檔失敗、使用者選擇取消），之後再按關閉會重新通知一次
let closeConfirmed = false;

function createWindow() {
  closeConfirmed = false;
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#1e1e1e',
    title: 'VN Script Editor',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 開發時連 Vite 的伺服器；打包後讀 dist/index.html
  if (app.isPackaged) mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  else mainWindow.loadURL('http://localhost:5173');

  // 網頁的 <title> 會蓋掉視窗標題，固定顯示應用程式名稱
  mainWindow.on('page-title-updated', (e) => e.preventDefault());

  mainWindow.on('close', (e) => {
    if (closeConfirmed) return;
    e.preventDefault();
    mainWindow.webContents.send('app-closing');
  });

  // 網頁當掉或載入失敗時不會有人回報 readyToClose，直接放行，免得視窗關不掉
  mainWindow.webContents.on('render-process-gone', () => (closeConfirmed = true));
  mainWindow.webContents.on('did-fail-load', () => (closeConfirmed = true));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  registerIpc();
  await buildMenu();
  createWindow();
  // macOS 習慣：點 Dock 圖示時，沒有視窗就重新開一個
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// 所有視窗都關了就結束程式
app.on('window-all-closed', () => app.quit());
