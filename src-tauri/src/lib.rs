// Tauri 主程式：建立視窗、原生選單、提供檔案讀寫給畫面（網頁端）使用
// 取代原本的 Electron 主程式，功能一樣；畫面那邊透過 src/platform.ts 呼叫這裡的指令
//
// 給熟 C# 的人看的對照：
//   #[tauri::command] fn xxx(...)  ≈ 一個可以從畫面呼叫的 public 方法（像 Web API 的 Controller action）
//   Result<T, String>              ≈ 回傳 T，或丟出一個錯誤訊息（畫面那邊會變成 Promise 被 reject）
//   State<AppState>                ≈ 依賴注入進來的單例服務
//   Mutex<T>                       ≈ lock(...) 保護的欄位；.lock().unwrap() 就是進入 lock 區塊
//   ?                              ≈ 「失敗就直接把錯誤 return 出去」，省掉一堆 if (err) return err

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::window::Color;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent, Wry};
use tauri_plugin_dialog::DialogExt;

// ───────────────────────── 共用狀態 ─────────────────────────

struct AppState {
    // 允許存取的專案資料夾：畫面只能讀寫「使用者親自選過的資料夾」底下的東西，其他路徑一律拒絕
    roots: Mutex<HashSet<PathBuf>>,
    // 最近的專案清單是「讀 → 改 → 寫」好幾步，用這把鎖避免兩次呼叫互相覆蓋
    recent_lock: Mutex<()>,
    // 關閉視窗的流程：先通知畫面把沒存的存完，畫面回報 ready 後才真的關；這裡記著「已經確認可以關」的視窗
    close_confirmed: Mutex<HashSet<String>>,
    // 每個視窗開著哪個專案（視窗的 label → 專案資料夾）：同一個專案不能在兩個視窗同時開
    open_projects: Mutex<HashMap<String, PathBuf>>,
    // 新視窗的編號（label 用 w1、w2…；第一個視窗是 main）
    next_window: AtomicUsize,
    // 每個視窗監看自己開著的專案資料夾（視窗的 label → 監看器；拿掉就停止監看）
    watchers: Mutex<HashMap<String, RecommendedWatcher>>,
}

// ───────────────────────── 路徑檢查 ─────────────────────────

// 把路徑整理成乾淨的絕對路徑（處理 . 和 ..），但不要求檔案已經存在（寫新檔時還不存在）
fn normalize(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

// 比對用的字串：Windows 不分大小寫，分隔符號統一成 \
fn path_key(p: &Path) -> String {
    let s = p.to_string_lossy().replace('/', "\\");
    let s = s.trim_end_matches('\\').to_string();
    if cfg!(windows) {
        s.to_lowercase()
    } else {
        s
    }
}

fn same_path(a: &Path, b: &Path) -> bool {
    path_key(&normalize(a)) == path_key(&normalize(b))
}

// 路徑是否落在某個允許的資料夾之內（含資料夾本身）
fn is_inside_root(state: &AppState, target: &Path) -> bool {
    let t = path_key(target);
    state.roots.lock().unwrap().iter().any(|root| {
        let r = path_key(root);
        t == r || t.starts_with(&format!("{r}\\"))
    })
}

// 每個檔案操作都先過這一關；回傳整理過的絕對路徑
fn guard(state: &AppState, p: &str) -> Result<PathBuf, String> {
    let path = Path::new(p);
    if !path.is_absolute() {
        return Err("路徑必須是絕對路徑".into());
    }
    let path = normalize(path);
    if !is_inside_root(state, &path) {
        return Err("不能存取專案資料夾以外的路徑".into());
    }
    Ok(path)
}

fn add_root(state: &AppState, p: &Path) {
    state.roots.lock().unwrap().insert(normalize(p));
}

// 系統的錯誤（找不到檔案、沒有權限…）轉成字串交給畫面
fn err(e: std::io::Error) -> String {
    e.to_string()
}

// ───────────────────────── 檔案操作（全部用絕對路徑） ─────────────────────────

#[derive(Serialize)]
struct DirEntry {
    name: String,
    kind: &'static str, // "file" 或 "directory"
}

#[tauri::command]
fn fs_list_dir(state: State<AppState>, path: String) -> Result<Vec<DirEntry>, String> {
    let dir = guard(&state, &path)?;
    let mut out = Vec::new();
    for entry in fs::read_dir(dir).map_err(err)? {
        let entry = entry.map_err(err)?;
        let ft = entry.file_type().map_err(err)?;
        // 只回報檔案與資料夾，其他（捷徑等）略過
        let kind = if ft.is_dir() {
            "directory"
        } else if ft.is_file() {
            "file"
        } else {
            continue;
        };
        out.push(DirEntry { name: entry.file_name().to_string_lossy().into_owned(), kind });
    }
    Ok(out)
}

#[tauri::command]
fn fs_read_text(state: State<AppState>, path: String) -> Result<String, String> {
    fs::read_to_string(guard(&state, &path)?).map_err(err)
}

// 會先建立上層資料夾
#[tauri::command]
fn fs_write_text(state: State<AppState>, path: String, text: String) -> Result<(), String> {
    let target = guard(&state, &path)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(err)?;
    }
    fs::write(target, text).map_err(err)
}

#[tauri::command]
fn fs_mkdir(state: State<AppState>, path: String) -> Result<(), String> {
    fs::create_dir_all(guard(&state, &path)?).map_err(err)
}

#[tauri::command]
fn fs_rename(state: State<AppState>, from: String, to: String) -> Result<(), String> {
    fs::rename(guard(&state, &from)?, guard(&state, &to)?).map_err(err)
}

#[tauri::command]
fn fs_remove(state: State<AppState>, path: String, recursive: bool) -> Result<(), String> {
    let target = guard(&state, &path)?;
    // 專案資料夾本身不能被刪掉
    if state.roots.lock().unwrap().iter().any(|r| same_path(r, &target)) {
        return Err("不能刪除專案資料夾本身".into());
    }
    let meta = fs::metadata(&target).map_err(err)?;
    if !meta.is_dir() {
        fs::remove_file(target).map_err(err)
    } else if recursive {
        fs::remove_dir_all(target).map_err(err)
    } else {
        fs::remove_dir(target).map_err(err)
    }
}

// 不存在回傳 false；其他錯誤（含「路徑不被允許」）照樣丟出去
#[tauri::command]
fn fs_exists(state: State<AppState>, path: String) -> Result<bool, String> {
    match fs::metadata(guard(&state, &path)?) {
        Ok(_) => Ok(true),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(err(e)),
    }
}

// ───────────────────────── 最近的專案（應用程式資料夾/recent.json） ─────────────────────────

const MAX_RECENT: usize = 8;

#[derive(Serialize, Deserialize, Clone)]
struct RecentProject {
    name: String,
    path: String,
}

fn recent_file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("recent.json"))
}

// 沒有檔案或壞掉：當作空清單
fn read_recent(app: &AppHandle) -> Vec<RecentProject> {
    recent_file(app)
        .and_then(|f| fs::read_to_string(f).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn write_recent(app: &AppHandle, list: &[RecentProject]) -> Result<(), String> {
    let file = recent_file(app).ok_or("找不到應用程式資料夾")?;
    if let Some(dir) = file.parent() {
        fs::create_dir_all(dir).map_err(err)?;
    }
    let text = serde_json::to_string_pretty(list).map_err(|e| e.to_string())?;
    fs::write(file, text).map_err(err)?;
    // 清單變了，「最近的專案」子選單要跟著重建
    set_menu(app, list).map_err(|e| e.to_string())
}

// 選擇資料夾：選到的才加入允許清單；取消回傳 null
// （async：選資料夾的視窗會一直等到使用者按下確定，不能卡住主執行緒）
#[tauri::command]
async fn project_pick_folder(app: AppHandle, state: State<'_, AppState>) -> Result<Option<String>, String> {
    let Some(picked) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    add_root(&state, &path);
    Ok(Some(normalize(&path).to_string_lossy().into_owned()))
}

// 匯出：跳出「另存新檔」視窗，把 text 寫到使用者選的位置；取消回傳 false
// 寫入的位置是使用者在系統視窗裡親自選的，所以不經過 guard（不限專案資料夾），也不會把它加進允許清單
#[tauri::command]
async fn export_save_text(app: AppHandle, default_name: String, text: String) -> Result<bool, String> {
    let Some(picked) = app
        .dialog()
        .file()
        .set_file_name(&default_name)
        .add_filter("Markdown", &["md"])
        .add_filter("文字檔", &["txt"])
        .blocking_save_file()
    else {
        return Ok(false);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    fs::write(path, text).map_err(err)?;
    Ok(true)
}

#[tauri::command]
fn project_get_recent(app: AppHandle, state: State<AppState>) -> Vec<RecentProject> {
    let _lock = state.recent_lock.lock().unwrap();
    read_recent(&app)
}

#[tauri::command]
fn project_remember(app: AppHandle, state: State<AppState>, name: String, path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.is_absolute() {
        return Err("參數錯誤".into());
    }
    if !is_inside_root(&state, &normalize(p)) {
        return Err("只能記住已開啟的專案資料夾".into());
    }
    let _lock = state.recent_lock.lock().unwrap();
    // 最新的放最前面，最多保留 8 筆
    let mut list = vec![RecentProject { name, path: normalize(p).to_string_lossy().into_owned() }];
    list.extend(read_recent(&app).into_iter().filter(|e| !same_path(Path::new(&e.path), p)));
    list.truncate(MAX_RECENT);
    write_recent(&app, &list)
}

#[tauri::command]
fn project_forget(app: AppHandle, state: State<AppState>, path: String) -> Result<(), String> {
    let _lock = state.recent_lock.lock().unwrap();
    let list: Vec<_> = read_recent(&app).into_iter().filter(|e| !same_path(Path::new(&e.path), Path::new(&path))).collect();
    write_recent(&app, &list)
}

// 重新開啟最近的專案：只有在最近清單裡、而且資料夾還在，才允許
#[tauri::command]
fn project_allow_root(app: AppHandle, state: State<AppState>, path: String) -> bool {
    let p = Path::new(&path);
    if !p.is_absolute() {
        return false;
    }
    let in_recent = {
        let _lock = state.recent_lock.lock().unwrap();
        read_recent(&app).iter().any(|e| same_path(Path::new(&e.path), p))
    };
    if !in_recent || !p.is_dir() {
        return false;
    }
    add_root(&state, p);
    true
}

// ───────────────────────── 多個視窗（跟 VS Code 一樣） ─────────────────────────
// 可以開很多個視窗，各開各的專案；同一個專案已經在別的視窗開著時，改成跳到那個視窗

// 開一個新視窗（從開始畫面開始）
fn open_new_window(app: &AppHandle) -> tauri::Result<()> {
    let state = app.state::<AppState>();
    let label = format!("w{}", state.next_window.fetch_add(1, Ordering::SeqCst) + 1);
    WebviewWindowBuilder::new(app, label, WebviewUrl::default())
        .title(window_title(app))
        .inner_size(1400.0, 900.0)
        .background_color(Color(0x1e, 0x1e, 0x1e, 0xff))
        .disable_drag_drop_handler() // 跟 tauri.conf.json 的 dragDropEnabled: false 一樣，不然畫面裡不能拖曳
        .build()?;
    Ok(())
}

// 視窗標題：程式名稱＋版本號（版本號取自 tauri.conf.json）
fn window_title(app: &AppHandle) -> String {
    format!("VN Script Editor {}", app.package_info().version)
}

// 把視窗叫到最前面（最小化的話先還原）
fn bring_to_front(window: &WebviewWindow) {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

// async：在 Windows 上，從同步的指令裡建立視窗會卡住
#[tauri::command]
async fn window_new(app: AppHandle) -> Result<(), String> {
    open_new_window(&app).map_err(|e| e.to_string())
}

// 這個視窗要開某個專案：別的視窗已經開著它，就把那個視窗叫到前面並回傳 false（這個視窗不要開）；
// 否則記下「這個視窗開著這個專案」並回傳 true
#[tauri::command]
fn project_claim(app: AppHandle, window: WebviewWindow, state: State<AppState>, path: String) -> bool {
    let p = normalize(Path::new(&path));
    let mut open = state.open_projects.lock().unwrap();
    let other = open.iter().find(|(label, root)| label.as_str() != window.label() && same_path(root, &p)).map(|(label, _)| label.clone());
    if let Some(label) = other {
        if let Some(w) = app.get_webview_window(&label) {
            bring_to_front(&w);
            return false;
        }
    }
    open.insert(window.label().to_string(), p);
    true
}

// 這個視窗關掉了專案（回到開始畫面）
#[tauri::command]
fn project_release(window: WebviewWindow, state: State<AppState>) {
    state.open_projects.lock().unwrap().remove(window.label());
    state.watchers.lock().unwrap().remove(window.label());
}

// ───────────────────────── 監看專案資料夾（外部改動，例如 AI 改了檔案） ─────────────────────────
// 資料夾裡有東西被新增、修改、刪除，就送「fs-change」事件（內容是改到的路徑）給這個視窗
// 畫面收到後會重新讀取，比對出哪些是別人改的（自己存檔造成的會被認出來略過）

#[tauri::command]
fn project_watch(app: AppHandle, window: WebviewWindow, state: State<AppState>, path: String) -> Result<(), String> {
    let root = guard(&state, &path)?;
    let label = window.label().to_string();
    let target = label.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(event) = res else { return };
        // 只在意內容有變的事件（新增、修改、刪除、改名）；單純讀取不算
        if matches!(event.kind, notify::EventKind::Access(_)) {
            return;
        }
        let paths: Vec<String> = event.paths.iter().map(|p| p.to_string_lossy().into_owned()).collect();
        let _ = app.emit_to(target.as_str(), "fs-change", paths);
    })
    .map_err(|e| e.to_string())?;
    watcher.watch(&root, RecursiveMode::Recursive).map_err(|e| e.to_string())?;
    // 同一個視窗換專案時，舊的監看器會被換掉（丟掉就停止監看）
    state.watchers.lock().unwrap().insert(label, watcher);
    Ok(())
}

// 目前作用中的視窗（選單事件要送給它）；都沒有焦點時隨便挑一個
fn focused_window(app: &AppHandle) -> Option<WebviewWindow> {
    let windows = app.webview_windows();
    windows.values().find(|w| w.is_focused().unwrap_or(false)).or_else(|| windows.values().next()).cloned()
}

// ───────────────────────── 視窗：關閉流程、縮放 ─────────────────────────

// 畫面存完檔後呼叫，才真的關掉視窗
#[tauri::command]
fn app_ready_to_close(window: WebviewWindow, state: State<AppState>) -> Result<(), String> {
    state.close_confirmed.lock().unwrap().insert(window.label().to_string());
    window.close().map_err(|e| e.to_string())
}

// 整個畫面的縮放（設定裡的「UI 大小」），1 = 100%
#[tauri::command]
fn set_zoom(window: WebviewWindow, factor: f64) -> Result<(), String> {
    window.set_zoom(factor).map_err(|e| e.to_string())
}

// ───────────────────────── 原生選單 ─────────────────────────
// 每個選單項目有一個 id；按下去時把對應的事件送給畫面（App.tsx 的 onMenu 接收）
// 快捷鍵（Ctrl+O 等）不在這裡登記：游標在畫面裡時按鍵會被 WebView2 收走，選單收不到，
// 所以改由畫面自己偵測（App.tsx）；這裡只在名稱後面用 \t 接上快捷鍵文字，選單右邊照樣會顯示

fn build_menu(app: &AppHandle, recent: &[RecentProject]) -> tauri::Result<Menu<Wry>> {
    let mut recent_menu = SubmenuBuilder::new(app, "最近的專案");
    if recent.is_empty() {
        recent_menu = recent_menu.item(&MenuItemBuilder::with_id("recent-none", "（沒有）").enabled(false).build(app)?);
    }
    for r in recent {
        // id 直接帶著路徑，按下去時才知道要開哪一個
        let label = format!("{}    {}", r.name, r.path);
        recent_menu = recent_menu.item(&MenuItemBuilder::with_id(format!("recent:{}", r.path), label).build(app)?);
    }

    let file = SubmenuBuilder::new(app, "檔案")
        .item(&MenuItemBuilder::with_id("new-window", "新視窗\tCtrl+Shift+N").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("new-project", "新增專案…").build(app)?)
        .item(&MenuItemBuilder::with_id("open-project", "開啟專案資料夾…\tCtrl+O").build(app)?)
        .item(&recent_menu.build()?)
        .separator()
        .item(&MenuItemBuilder::with_id("copy-for-ai", "複製整個專案（給網頁版 AI）").build(app)?)
        .item(&MenuItemBuilder::with_id("export-project", "匯出專案為單一文字檔…").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("close-tab", "關閉分頁\tCtrl+W").build(app)?)
        .item(&MenuItemBuilder::with_id("close-project", "關閉專案").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("quit", "結束").build(app)?)
        .build()?;
    let settings = SubmenuBuilder::new(app, "設定")
        .item(&MenuItemBuilder::with_id("open-settings", "設定…\tCtrl+,").build(app)?)
        .build()?;
    let help = SubmenuBuilder::new(app, "說明")
        .item(&MenuItemBuilder::with_id("show-shortcuts", "鍵盤快捷鍵").build(app)?)
        .item(&MenuItemBuilder::with_id("show-syntax", "劇本語法說明").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("check-update", "檢查更新…").build(app)?)
        .item(&MenuItemBuilder::with_id("show-about", "關於 VN Script Editor").build(app)?)
        .build()?;
    // 沒有「編輯」選單；複製／貼上／復原的快捷鍵不需要它也能用
    MenuBuilder::new(app).item(&file).item(&settings).item(&help).build()
}

fn set_menu(app: &AppHandle, recent: &[RecentProject]) -> tauri::Result<()> {
    let menu = build_menu(app, recent)?;
    app.set_menu(menu)?;
    Ok(())
}

fn on_menu(app: &AppHandle, id: &str) {
    if id == "quit" {
        // 結束：每個視窗都跟按右上角的 × 一樣，走關閉流程（有沒存的會先問）
        for w in app.webview_windows().values() {
            let _ = w.close();
        }
        return;
    }
    if id == "new-window" {
        // 選單事件跑在主執行緒上：在這裡直接建立視窗會死結（Windows），交給別的執行緒
        let app = app.clone();
        std::thread::spawn(move || {
            let _ = open_new_window(&app);
        });
        return;
    }
    let payload = match id.strip_prefix("recent:") {
        Some(path) => json!({ "type": "open-recent", "path": path }),
        None => json!({ "type": id }),
    };
    // 選單是所有視窗共用的，只送給目前作用中的那個視窗
    if let Some(w) = focused_window(app) {
        let _ = app.emit_to(w.label(), "menu", payload);
    }
}

// ───────────────────────── 啟動 ─────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 程式已經開著時再啟動一次（例如再雙擊捷徑）：不另外開一個程式，改成在原本的程式裡多開一個視窗
        // （這個外掛要放在最前面）
        // 這個回呼跑在主執行緒上，在這裡直接建立視窗會死結（Windows），所以交給別的執行緒去開
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let app = app.clone();
            std::thread::spawn(move || {
                let _ = open_new_window(&app);
            });
        }))
        .plugin(tauri_plugin_dialog::init())
        // 記住每個視窗的位置、大小、是否最大化（依視窗 label：main、w1、w2…），下次開同一個視窗時還原
        // 上次的位置在已經拔掉的螢幕上時，外掛會自己拉回看得到的地方
        .plugin(tauri_plugin_window_state::Builder::default().build())
        // 自動更新：檢查 tauri.conf.json 裡 plugins.updater.endpoints 的網址有沒有新版本；process 用來更新完重新啟動
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(AppState {
            roots: Mutex::new(HashSet::new()),
            recent_lock: Mutex::new(()),
            close_confirmed: Mutex::new(HashSet::new()),
            open_projects: Mutex::new(HashMap::new()),
            next_window: AtomicUsize::new(0),
            watchers: Mutex::new(HashMap::new()),
        })
        .invoke_handler(tauri::generate_handler![
            fs_list_dir,
            fs_read_text,
            fs_write_text,
            fs_mkdir,
            fs_rename,
            fs_remove,
            fs_exists,
            project_pick_folder,
            export_save_text,
            project_get_recent,
            project_remember,
            project_forget,
            project_allow_root,
            project_claim,
            project_release,
            project_watch,
            window_new,
            app_ready_to_close,
            set_zoom,
        ])
        .setup(|app| {
            let handle = app.handle();
            set_menu(handle, &read_recent(handle))?;
            if let Some(w) = handle.get_webview_window("main") {
                let _ = w.set_title(&window_title(handle));
            }
            Ok(())
        })
        .on_menu_event(|app, event| on_menu(app, event.id().as_ref()))
        .on_window_event(|window, event| {
            // 按關閉：還沒確認就先擋下來，通知畫面去存檔；畫面存完會呼叫 app_ready_to_close
            // 畫面決定不關（存檔失敗、使用者取消）時，之後再按關閉會重新通知一次
            let state = window.state::<AppState>();
            let label = window.label().to_string();
            match event {
                WindowEvent::CloseRequested { api, .. } => {
                    if !state.close_confirmed.lock().unwrap().contains(&label) {
                        api.prevent_close();
                        let _ = window.emit_to(label.as_str(), "app-closing", ());
                    }
                }
                // 視窗真的關掉了：它開著的專案讓出來，別的視窗就可以開
                WindowEvent::Destroyed => {
                    state.close_confirmed.lock().unwrap().remove(&label);
                    state.open_projects.lock().unwrap().remove(&label);
                    state.watchers.lock().unwrap().remove(&label);
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("程式啟動失敗");
}
