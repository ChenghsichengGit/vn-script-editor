import { errorText } from './hooks';
// 圖片：統一放在專案的「圖片/」資料夾，卡片欄位和詳細內容裡記相對路徑（例如 圖片/立繪.png）

let root: string | null = null;
export const setImageRoot = (r: string | null) => {
  root = r;
};

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
};

const BASE = navigator.userAgent.includes('Windows') ? 'http://vnimg.localhost/' : 'vnimg://localhost/';

export function imageSrc(path: string): string {
  const p = path.trim();
  if (!p) return '';
  if (/^(https?:|data:|blob:)/i.test(p)) return p;
  if (!root) return '';
  const abs = /^([a-zA-Z]:)?[\\/]/.test(p) ? p : `${root.replace(/[\\/]+$/, '')}/${p}`;
  return BASE + encodeURIComponent(abs);
}

export const imageFiles = (list: FileList | null | undefined): File[] => [...(list ?? [])].filter((f) => f.type in EXT);

const pad = (n: number) => String(n).padStart(2, '0');
function stamp() {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export async function saveImageFile(file: File): Promise<string> {
  if (!root) throw new Error('還沒有開啟專案');
  const ext = EXT[file.type] ?? 'png';
  const pasted = !file.name || /^image\.\w+$/i.test(file.name);
  const name = pasted ? `貼上-${stamp()}.${ext}` : file.name;
  return window.api.saveImage(root, name, new Uint8Array(await file.arrayBuffer()));
}

export const pickImage = (): Promise<string | null> => (root ? window.api.importImage(root) : Promise.resolve(null));

const UNUSED_MIN_AGE = 24 * 60 * 60;
export async function removeUnusedImages(root: string, texts: string[]): Promise<void> {
  let used = texts.join('\n');
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
  }
}

export const imageError = (e: unknown) => window.alert(`圖片存檔失敗：${errorText(e)}`);
