// Tauri 主程式：建立視窗、原生選單、提供檔案讀寫給畫面（網頁端）使用
// 取代原本的 electron/main.cjs，功能一模一樣；畫面那邊透過 src/platform.ts 呼叫這裡的指令
//
// 給熟 C# 的人看的對照：
//   #[tauri::command] fn xxx(...)  ≈ 一個可以從畫面呼叫的 public 方法（像 Web API 的 Controller action）
//   Result<T, String>              ≈ 回傳 T，或丟出一個錯誤訊息（畫面那邊會變成 Promise 被 reject）
//   State<AppState>                ≈ 依賴注入進來的單例服務
//   Mutex<T>                       ≈ lock(...) 保護的欄位；.lock().unwrap() 就是進入 lock 區塊
//   ?                              ≈ 「失敗就直接把錯誤 return 出去」，省掉一堆 if (err) return err

use std::collections::HashSet;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow, WindowEvent, Wry};
use tauri_plugin_dialog::DialogExt;

// ───────────────────────── 共用狀態 ─────────────────────────

struct AppState {
    // 允許存取的專案資料夾：畫面只能讀寫「使用者親自選過的資料夾」底下的東西，其他路徑一律拒絕
    roots: Mutex<HashSet<PathBuf>>,
    // 最近的專案清單是「讀 → 改 → 寫」好幾步，用這把鎖避免兩次呼叫互相覆蓋
    recent_lock: Mutex<()>,
    // 關閉視窗的流程：先通知畫面把沒存的存完，畫面回報 ready 後才真的關
    close_confirmed: AtomicBool,
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

// ───────────────────────── 視窗：關閉流程、縮放 ─────────────────────────

// 畫面存完檔後呼叫，才真的關掉視窗
#[tauri::command]
fn app_ready_to_close(window: WebviewWindow, state: State<AppState>) -> Result<(), String> {
    state.close_confirmed.store(true, Ordering::SeqCst);
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
        .item(&MenuItemBuilder::with_id("new-project", "新增專案…").build(app)?)
        .item(&MenuItemBuilder::with_id("open-project", "開啟專案資料夾…\tCtrl+O").build(app)?)
        .item(&recent_menu.build()?)
        .separator()
        .item(&MenuItemBuilder::with_id("close-tab", "關閉分頁\tCtrl+W").build(app)?)
        .item(&MenuItemBuilder::with_id("close-project", "關閉專案").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("quit", "結束").build(app)?)
        .build()?;
    let settings = SubmenuBuilder::new(app, "設定")
        .item(&MenuItemBuilder::with_id("open-settings", "設定…\tCtrl+,").build(app)?)
        .build()?;
    // 沒有「編輯」選單；複製／貼上／復原的快捷鍵不需要它也能用
    MenuBuilder::new(app).item(&file).item(&settings).build()
}

fn set_menu(app: &AppHandle, recent: &[RecentProject]) -> tauri::Result<()> {
    let menu = build_menu(app, recent)?;
    app.set_menu(menu)?;
    Ok(())
}

fn on_menu(app: &AppHandle, id: &str) {
    if id == "quit" {
        // 跟按視窗右上角的 × 一樣：走關閉流程（先存檔）
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.close();
        }
        return;
    }
    let payload = match id.strip_prefix("recent:") {
        Some(path) => json!({ "type": "open-recent", "path": path }),
        None => json!({ "type": id }),
    };
    let _ = app.emit("menu", payload);
}

// ───────────────────────── 啟動 ─────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            roots: Mutex::new(HashSet::new()),
            recent_lock: Mutex::new(()),
            close_confirmed: AtomicBool::new(false),
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
            project_get_recent,
            project_remember,
            project_forget,
            project_allow_root,
            app_ready_to_close,
            set_zoom,
        ])
        .setup(|app| {
            let handle = app.handle();
            set_menu(handle, &read_recent(handle))?;
            Ok(())
        })
        .on_menu_event(|app, event| on_menu(app, event.id().as_ref()))
        .on_window_event(|window, event| {
            // 按關閉：還沒確認就先擋下來，通知畫面去存檔；畫面存完會呼叫 app_ready_to_close
            // 畫面決定不關（存檔失敗、使用者取消）時，之後再按關閉會重新通知一次
            if let WindowEvent::CloseRequested { api, .. } = event {
                if !window.state::<AppState>().close_confirmed.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.emit("app-closing", ());
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("程式啟動失敗");
}
