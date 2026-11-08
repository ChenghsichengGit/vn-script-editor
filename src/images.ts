// 圖片：統一放在專案的「圖片/」資料夾，卡片欄位和詳細內容裡記相對路徑（例如 圖片/立繪.png）
// 畫面要顯示時，用 imageSrc 轉成 vnimg 協定的網址（由 src-tauri/src/lib.rs 的 serve_image 讀檔回傳）

// 目前開著的專案資料夾（一個視窗只開一個專案；App 開關專案時設定）
let root: string | null = null;
export const setImageRoot = (r: string | null) => {
  root = r;
};

// 支援的格式（MIME → 副檔名）；剪貼簿和拖進來的檔案只收這些
const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
};

// Windows 上自訂協定的網址是 http://<協定>.localhost/，其他系統是 <協定>://localhost/
const BASE = navigator.userAgent.includes('Windows') ? 'http://vnimg.localhost/' : 'vnimg://localhost/';

// 記在檔案裡的路徑 → <img src>。網址（http、data:）照用；相對路徑接在專案資料夾後面
export function imageSrc(path: string): string {
  const p = path.trim();
  if (!p) return '';
  if (/^(https?:|data:|blob:)/i.test(p)) return p;
  if (!root) return '';
  const abs = /^([a-zA-Z]:)?[\\/]/.test(p) ? p : `${root.replace(/[\\/]+$/, '')}/${p}`;
  return BASE + encodeURIComponent(abs);
}

// 從清單（剪貼簿、拖放）挑出支援的圖片檔
export const imageFiles = (list: FileList | null | undefined): File[] => [...(list ?? [])].filter((f) => f.type in EXT);

const pad = (n: number) => String(n).padStart(2, '0');
function stamp() {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// 把貼上或拖進來的圖片存進 圖片/，回傳相對路徑
// 截圖貼上時瀏覽器給的檔名一律是 image.png，改成「貼上-日期-時間」；從檔案總管拖進來的保留原檔名
export async function saveImageFile(file: File): Promise<string> {
  if (!root) throw new Error('還沒有開啟專案');
  const ext = EXT[file.type] ?? 'png';
  const pasted = !file.name || /^image\.\w+$/i.test(file.name);
  const name = pasted ? `貼上-${stamp()}.${ext}` : file.name;
  return window.api.saveImage(root, name, new Uint8Array(await file.arrayBuffer()));
}

// 「選擇圖片」：跳出選檔視窗並複製進 圖片/，回傳相對路徑；取消回傳 null
export const pickImage = (): Promise<string | null> => (root ? window.api.importImage(root) : Promise.resolve(null));

// 關閉專案時：刪掉 圖片/ 裡沒用到的圖。texts = 整個專案的文字（卡片、劇本），檔名沒出現在裡面就算沒用到
// 只刪超過一天沒動過的（剛貼上或剛從雲端同步過來、引用它的卡片可能還沒到）；失敗就算了，不擋關閉
const UNUSED_MIN_AGE = 24 * 60 * 60;
export async function removeUnusedImages(root: string, texts: string[]): Promise<void> {
  let used = texts.join('\n');
  // 路徑可能被寫成 %E7%AB%8B.png 這種編碼，解開一份一起比對
  used += '\n' + used.replace(/(%[0-9A-Fa-f]{2})+/g, (m) => {
    try {
      return decodeURIComponent(m);
    } catch {
      return m;
    }
  });
  try {
    await window.api.removeUnusedImages(root, used, UNUSED_MIN_AGE);
  } catch {
    // 不影響關閉
  }
}

// 存圖片失敗（格式不支援、寫不進去…）時跳出訊息
export const imageError = (e: unknown) => window.alert(`圖片存檔失敗：${e instanceof Error ? e.message : String(e)}`);
