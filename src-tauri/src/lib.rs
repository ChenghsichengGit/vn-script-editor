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

// ───────────────────────── 圖片 ─────────────────────────
// 圖片統一放在專案的「圖片/」資料夾；卡片和詳細內容裡記的是相對路徑（例如 圖片/立繪.png）
// 畫面用 vnimg 協定載圖：http://vnimg.localhost/<整個絕對路徑做 encodeURIComponent>（Windows 的寫法），一樣只能讀允許的資料夾

const IMAGE_DIR: &str = "圖片";
const IMAGE_EXTS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"];

fn image_mime(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_string_lossy().to_lowercase();
    Some(match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "avif" => "image/avif",
        _ => return None,
    })
}

// %XX 解碼（UTF-8）；格式不對回傳 None
fn percent_decode(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = std::str::from_utf8(bytes.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

// vnimg 協定：讀圖片檔回傳給 <img>；不是圖片、不在允許的資料夾裡、讀不到都回 404／403
fn serve_image(app: &AppHandle, uri_path: &str) -> tauri::http::Response<Vec<u8>> {
    let respond = |status: u16, mime: &str, body: Vec<u8>| {
        tauri::http::Response::builder()
            .status(status)
            .header("Content-Type", mime)
            .header("Cache-Control", "no-cache")
            .body(body)
            .unwrap()
    };
    let Some(path) = percent_decode(uri_path.trim_start_matches('/')) else {
        return respond(400, "text/plain", Vec::new());
    };
    let state = app.state::<AppState>();
    let Ok(target) = guard(&state, &path) else {
        return respond(403, "text/plain", Vec::new());
    };
    let Some(mime) = image_mime(&target) else {
        return respond(403, "text/plain", Vec::new());
    };
    match fs::read(&target) {
        Ok(data) => respond(200, mime, data),
        Err(_) => respond(404, "text/plain", Vec::new()),
    }
}

// 圖片檔名：只留檔名本身、拿掉 Windows 不能用的字；副檔名一定要是圖片
fn clean_image_name(raw: &str) -> Result<String, String> {
    let name = Path::new(raw).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let name: String = name.chars().filter(|c| !"<>:\"/\\|?*".contains(*c) && !c.is_control()).collect();
    let name = name.trim().trim_end_matches('.').to_string();
    let ok = Path::new(&name)
        .extension()
        .map(|e| IMAGE_EXTS.contains(&e.to_string_lossy().to_lowercase().as_str()))
        .unwrap_or(false);
    if !ok || Path::new(&name).file_stem().map(|s| s.is_empty()).unwrap_or(true) {
        return Err(format!("不支援的圖片格式：{raw}"));
    }
    Ok(name)
}

// 在 dir 裡找一個沒用過的檔名：已經有同名的就變成「名稱-2.png」「名稱-3.png」…
fn unique_in(dir: &Path, name: &str) -> PathBuf {
    let p = Path::new(name);
    let stem = p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let ext = p.extension().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let mut target = dir.join(name);
    let mut n = 2;
    while target.exists() {
        target = dir.join(format!("{stem}-{n}.{ext}"));
        n += 1;
    }
    target
}

// 存進 root/圖片/，回傳相對路徑（用 / 分隔）
fn store_image(root: &Path, name: &str, write: impl FnOnce(&Path) -> std::io::Result<()>) -> Result<String, String> {
    let dir = root.join(IMAGE_DIR);
    fs::create_dir_all(&dir).map_err(err)?;
    let target = unique_in(&dir, &clean_image_name(name)?);
    write(&target).map_err(err)?;
    let file = target.file_name().unwrap().to_string_lossy();
    Ok(format!("{IMAGE_DIR}/{file}"))
}

// 貼上或拖進來的圖片：內容直接放在 invoke 的 body（不轉成 JSON 陣列，大圖才不會慢）
// header：x-root = 專案資料夾、x-name = 想用的檔名（都做過 encodeURIComponent，因為 header 只能放英數字）
#[tauri::command]
fn image_save(state: State<AppState>, request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
        return Err("圖片內容格式不對".into());
    };
    let header = |key: &str| -> Result<String, String> {
        let v = request.headers().get(key).and_then(|v| v.to_str().ok()).ok_or("缺少參數")?;
        percent_decode(v).ok_or_else(|| "參數格式不對".to_string())
    };
    let root = guard(&state, &header("x-root")?)?;
    let name = header("x-name")?;
    store_image(&root, &name, |target| fs::write(target, data))
}

// 「選擇圖片」：跳出選檔視窗，把選到的圖複製進 root/圖片/，回傳相對路徑；取消回傳 null
// 選到的檔案本來就在 圖片/ 裡面時，直接用它，不再複製一份
#[tauri::command]
async fn image_import(app: AppHandle, state: State<'_, AppState>, root: String) -> Result<Option<String>, String> {
    let root = guard(&state, &root)?;
    let Some(picked) = app.dialog().file().set_title("選擇圖片").add_filter("圖片", IMAGE_EXTS).blocking_pick_file() else {
        return Ok(None);
    };
    let source = normalize(&picked.into_path().map_err(|e| e.to_string())?);
    let dir = root.join(IMAGE_DIR);
    if let (Some(parent), Some(file)) = (source.parent(), source.file_name()) {
        if same_path(parent, &dir) && image_mime(&source).is_some() {
            return Ok(Some(format!("{IMAGE_DIR}/{}", file.to_string_lossy())));
        }
    }
    let name = source.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    store_image(&root, &name, |target| fs::copy(&source, target).map(|_| ())).map(Some)
}

// 關閉專案時清掉沒用到的圖片：root/圖片/ 裡的圖片檔，檔名沒出現在 used（整個專案的文字）裡、
// 而且超過 min_age_secs 秒沒有變動的，直接刪掉；回傳刪掉的檔名
// 剛貼上或剛從雲端同步過來的圖不刪（共用資料夾時，圖檔可能比引用它的卡片早到）
#[tauri::command]
fn image_remove_unused(state: State<AppState>, root: String, used: String, min_age_secs: u64) -> Result<Vec<String>, String> {
    let dir = guard(&state, &root)?.join(IMAGE_DIR);
    let Ok(entries) = fs::read_dir(&dir) else {
        return Ok(Vec::new()); // 沒有 圖片/ 資料夾
    };
    let min_age = std::time::Duration::from_secs(min_age_secs);
    let mut removed = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() || image_mime(&path).is_none() || used.contains(&name) {
            continue;
        }
        let old = meta.modified().ok().and_then(|t| t.elapsed().ok()).map(|age| age >= min_age).unwrap_or(false);
        if old && fs::remove_file(&path).is_ok() {
            removed.push(name);
        }
    }
    Ok(removed)
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

// ───────────────────────── 打包／匯入專案（.vnpack = zip） ─────────────────────────
// 打包：整個專案資料夾壓成一個檔案，方便傳給別人；以 . 開頭的（.git 等）和 exclude 列的最上層檔案不放進去
// 匯入：選 .vnpack、選要放在哪個資料夾，解壓成一個同名的專案資料夾

const PACK_EXT: &str = "vnpack";

fn zip_err(e: zip::result::ZipError) -> String {
    e.to_string()
}

// 把 dir 底下的檔案（遞迴）加進壓縮檔，壓縮檔裡的路徑用 / 分隔、相對於專案資料夾
fn add_dir_to_zip(
    zip: &mut zip::ZipWriter<fs::File>,
    root: &Path,
    dir: &Path,
    exclude_top: &[String],
    skip: &Path,
) -> Result<(), String> {
    let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    for entry in fs::read_dir(dir).map_err(err)? {
        let entry = entry.map_err(err)?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let path = entry.path();
        if same_path(&path, skip) {
            continue; // 打包檔存在專案資料夾裡時，不要把自己也包進去
        }
        let rel = path.strip_prefix(root).map_err(|e| e.to_string())?;
        let rel_str = rel.to_string_lossy().replace('\\', "/");
        if dir == root && exclude_top.iter().any(|x| x.eq_ignore_ascii_case(&name)) {
            continue;
        }
        let ft = entry.file_type().map_err(err)?;
        if ft.is_dir() {
            zip.add_directory(format!("{rel_str}/"), options).map_err(zip_err)?;
            add_dir_to_zip(zip, root, &path, exclude_top, skip)?;
        } else if ft.is_file() {
            zip.start_file(rel_str, options).map_err(zip_err)?;
            let mut f = fs::File::open(&path).map_err(err)?;
            std::io::copy(&mut f, zip).map_err(err)?;
        }
    }
    Ok(())
}

// 打包專案：跳出「另存新檔」，把 root 整個壓進去；取消回傳 false
#[tauri::command]
async fn project_pack(app: AppHandle, state: State<'_, AppState>, root: String, default_name: String, exclude: Vec<String>) -> Result<bool, String> {
    let root = guard(&state, &root)?;
    let Some(picked) = app
        .dialog()
        .file()
        .set_title("打包專案")
        .set_file_name(&default_name)
        .add_filter("VN Script Editor 專案包", &[PACK_EXT])
        .blocking_save_file()
    else {
        return Ok(false);
    };
    let target = picked.into_path().map_err(|e| e.to_string())?;
    write_pack(&root, &target, &exclude).map(|_| true)
}

// 把 root 壓成 target；先寫到暫存檔，全部成功才換成正式檔名：中途失敗不會留下壞掉的打包檔
fn write_pack(root: &Path, target: &Path, exclude: &[String]) -> Result<(), String> {
    let temp = target.with_extension("vnpack.part");
    let result = (|| {
        let file = fs::File::create(&temp).map_err(err)?;
        let mut zip = zip::ZipWriter::new(file);
        add_dir_to_zip(&mut zip, root, root, exclude, &temp)?;
        add_dir_check_target(target, root)?;
        zip.finish().map_err(zip_err)?;
        fs::rename(&temp, target).map_err(err)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

// 打包檔不能直接存成專案裡的某個資料夾（例如存成「劇本」）：那樣改名時會蓋掉它
fn add_dir_check_target(target: &Path, root: &Path) -> Result<(), String> {
    if target.is_dir() || same_path(target, root) {
        return Err("不能存成資料夾，請換一個檔名".into());
    }
    Ok(())
}

// 把 pack 解壓到 dest（dest 要事先不存在）；中途失敗會把 dest 整個清掉
fn extract_pack(pack: &Path, dest: &Path) -> Result<(), String> {
    let file = fs::File::open(pack).map_err(err)?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("這不是有效的專案包：{e}"))?;
    fs::create_dir_all(dest).map_err(err)?;
    let result = (|| {
        for i in 0..archive.len() {
            let mut entry = archive.by_index(i).map_err(zip_err)?;
            // enclosed_name：擋掉 ../ 或絕對路徑這種會寫到目標資料夾外面的項目
            let Some(rel) = entry.enclosed_name() else { continue };
            let out = dest.join(rel);
            if entry.is_dir() {
                fs::create_dir_all(&out).map_err(err)?;
            } else {
                if let Some(p) = out.parent() {
                    fs::create_dir_all(p).map_err(err)?;
                }
                let mut f = fs::File::create(&out).map_err(err)?;
                std::io::copy(&mut entry, &mut f).map_err(err)?;
            }
        }
        Ok::<(), String>(())
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(dest);
    }
    result
}

// 匯入專案：選 .vnpack → 選要放在哪個資料夾 → 解壓成「檔名」這個新資料夾（已經有同名的就加 2、3…）
// 回傳新的專案資料夾（已加進允許清單）；任一步取消回傳 null
#[tauri::command]
async fn project_unpack(app: AppHandle, state: State<'_, AppState>) -> Result<Option<String>, String> {
    let Some(picked) = app.dialog().file().set_title("匯入專案：選擇專案包").add_filter("VN Script Editor 專案包", &[PACK_EXT]).blocking_pick_file() else {
        return Ok(None);
    };
    let pack = picked.into_path().map_err(|e| e.to_string())?;
    let Some(parent) = app.dialog().file().set_title("匯入專案：要放在哪個資料夾").blocking_pick_folder() else {
        return Ok(None);
    };
    let parent = parent.into_path().map_err(|e| e.to_string())?;

    let stem = pack.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "專案".into());
    let mut dest = parent.join(&stem);
    let mut n = 2;
    while dest.exists() {
        dest = parent.join(format!("{stem} {n}"));
        n += 1;
    }

    extract_pack(&pack, &dest)?;
    add_root(&state, &dest);
    Ok(Some(normalize(&dest).to_string_lossy().into_owned()))
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
        .item(&MenuItemBuilder::with_id("import-project", "匯入專案（.vnpack）…").build(app)?)
        .item(&recent_menu.build()?)
        .separator()
        .item(&MenuItemBuilder::with_id("pack-project", "打包專案成一個檔案（.vnpack）…").build(app)?)
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
        // 圖片：<img src="http://vnimg.localhost/..."> 由這裡讀檔回傳（見 serve_image）
        .register_uri_scheme_protocol("vnimg", |ctx, request| serve_image(ctx.app_handle(), request.uri().path()))
        .invoke_handler(tauri::generate_handler![
            fs_list_dir,
            fs_read_text,
            fs_write_text,
            fs_mkdir,
            fs_rename,
            fs_remove,
            fs_exists,
            image_save,
            image_import,
            image_remove_unused,
            project_pick_folder,
            export_save_text,
            project_pack,
            project_unpack,
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

// ───────────────────────── 測試：打包／匯入 ─────────────────────────
#[cfg(test)]
mod pack_tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("vnpack-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn pack_and_extract_roundtrip() {
        let root = temp_dir("root");
        fs::create_dir_all(root.join("劇本/第一章")).unwrap();
        fs::create_dir_all(root.join("角色")).unwrap();
        fs::create_dir_all(root.join(".git")).unwrap();
        fs::write(root.join("劇本/第一章/開場.vns"), "#bg 咖啡廳\n「歡迎光臨」").unwrap();
        fs::write(root.join("角色/紗季.md"), "---\nname: 紗季\n---\n").unwrap();
        fs::write(root.join("project.json"), "{\"name\":\"測試\"}").unwrap();
        fs::write(root.join("AI說明.md"), "auto").unwrap();
        fs::write(root.join(".git/HEAD"), "x").unwrap();
        fs::create_dir_all(root.join("空資料夾")).unwrap();

        // 打包檔存在專案資料夾裡面也不能把自己包進去
        let pack = root.join("測試.vnpack");
        write_pack(&root, &pack, &["AI說明.md".to_string()]).unwrap();

        let out = temp_dir("out").join("測試");
        extract_pack(&pack, &out).unwrap();
        assert_eq!(fs::read_to_string(out.join("劇本/第一章/開場.vns")).unwrap(), "#bg 咖啡廳\n「歡迎光臨」");
        assert!(out.join("角色/紗季.md").is_file());
        assert!(out.join("project.json").is_file());
        assert!(out.join("空資料夾").is_dir());
        assert!(!out.join("AI說明.md").exists(), "AI說明.md 不該放進去");
        assert!(!out.join(".git").exists(), ".git 不該放進去");
        assert!(!out.join("測試.vnpack").exists(), "不該把自己包進去");
    }

    #[test]
    fn extract_rejects_escaping_paths() {
        let dir = temp_dir("evil");
        let pack = dir.join("evil.vnpack");
        {
            let mut zip = zip::ZipWriter::new(fs::File::create(&pack).unwrap());
            let o = zip::write::SimpleFileOptions::default();
            zip.start_file("../逃出去.txt", o).unwrap();
            std::io::Write::write_all(&mut zip, b"bad").unwrap();
            zip.start_file("ok.txt", o).unwrap();
            std::io::Write::write_all(&mut zip, b"ok").unwrap();
            zip.finish().unwrap();
        }
        let out = dir.join("out");
        extract_pack(&pack, &out).unwrap();
        assert!(out.join("ok.txt").is_file());
        assert!(!dir.join("逃出去.txt").exists(), "不能寫到目標資料夾外面");
    }

    #[test]
    fn extract_rejects_non_zip() {
        let dir = temp_dir("notzip");
        let pack = dir.join("x.vnpack");
        fs::write(&pack, "not a zip").unwrap();
        let out = dir.join("out");
        assert!(extract_pack(&pack, &out).is_err());
        assert!(!out.exists(), "失敗時要清掉建出來的資料夾");
    }
}

// ───────────────────────── 測試：圖片 ─────────────────────────
#[cfg(test)]
mod image_tests {
    use super::*;

    #[test]
    fn decodes_percent_utf8() {
        assert_eq!(percent_decode("F%3A%2F%E5%9C%96.png").as_deref(), Some("F:/圖.png"));
        assert_eq!(percent_decode("bad%2"), None);
        assert_eq!(percent_decode("bad%zz"), None);
    }

    #[test]
    fn cleans_image_names() {
        assert_eq!(clean_image_name(r"C:\x\立繪.PNG").unwrap(), "立繪.PNG");
        assert_eq!(clean_image_name("../../a?.png").unwrap(), "a.png");
        assert!(clean_image_name("readme.txt").is_err());
        assert!(clean_image_name(".png").is_err());
        assert!(clean_image_name("noext").is_err());
    }

    #[test]
    fn stores_with_unique_names() {
        let root = std::env::temp_dir().join(format!("vnse-img-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let a = store_image(&root, "立繪.png", |t| fs::write(t, b"1")).unwrap();
        let b = store_image(&root, "立繪.png", |t| fs::write(t, b"2")).unwrap();
        assert_eq!(a, "圖片/立繪.png");
        assert_eq!(b, "圖片/立繪-2.png");
        assert_eq!(fs::read(root.join("圖片").join("立繪.png")).unwrap(), b"1");
        let _ = fs::remove_dir_all(&root);
    }
}
