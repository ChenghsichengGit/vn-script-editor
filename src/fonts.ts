// 劇本字型的選單：電腦上已經有的字型，和從 Google Fonts 載入的免費字型（只下載用到的字，下載過會留在暫存）

export interface FontOption {
  family: string; // CSS 的字型名稱（存進設定的就是 'family'）
  label: string; // 選單上顯示的名稱
  style: string; // 風格說明
  web?: boolean; // 要從網路載入
  langs: string; // 支援的文字（2026-11 逐字檢查過：英文、日文假名、繁體中文都是字型本身就有）
  note?: string; // 字形的但書（不是完全照台灣標準時）
}

// 只收台灣字形（教育部標準）的字型；完全符合的排前面
export const FONT_OPTIONS: FontOption[] = [
  { family: 'Microsoft JhengHei', label: '微軟正黑體', style: '現代黑體，乾淨好讀', langs: '英・日・台灣字形' },
  { family: 'Noto Sans TC', label: '思源黑體', style: '黑體，筆畫比正黑體細一點', langs: '英・日・台灣字形' },
  { family: 'Noto Serif TC', label: '思源宋體', style: '宋體，小說書籍的質感', langs: '英・日・台灣字形' },
  { family: 'PMingLiU', label: '新細明體', style: '傳統明體，像一般書本', langs: '英・日・台灣字形' },
  { family: 'DFKai-SB', label: '標楷體', style: '楷書，像毛筆字', langs: '英・日・台灣字形' },
  { family: 'Iansui', label: '芫荽', style: '手寫字，輕鬆可愛', web: true, langs: '英・日・台灣字形' },
  { family: 'Chiron GoRound TC', label: '昭源圓體', style: '圓體，圓潤柔和', web: true, langs: '英・日・台灣字形', note: '少數字形不同，例如「骨」' },
];

// 設定裡存的值 ↔ 清單上的字型（存的是加了引號的名稱，例如 'LXGW WenKai TC'）
export const fontValue = (f: FontOption) => `'${f.family}'`;
export const findFont = (value: string) => FONT_OPTIONS.find((f) => fontValue(f) === value.trim());

const sheets = new Map<string, Promise<boolean>>();
// 網路字型：第一次用到時加上 Google Fonts 的樣式表（之後瀏覽器只下載畫面上用到的字）；樣式表載不到（沒網路）= false
function linkWebFont(f: FontOption): Promise<boolean> {
  let p = sheets.get(f.family);
  if (!p) {
    p = new Promise<boolean>((resolve) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(f.family).replace(/%20/g, '+')}&display=swap`;
      link.onload = () => resolve(true);
      link.onerror = () => {
        sheets.delete(f.family); // 下次再試（可能只是暫時沒網路）
        link.remove();
        resolve(false);
      };
      document.head.appendChild(link);
    });
    sheets.set(f.family, p);
  }
  return p;
}

// 載入字型（拿 text 裡的字去載）；成功 = true，沒網路 = false。電腦上的字型不用載
export async function loadFont(f: FontOption, text: string): Promise<boolean> {
  if (!f.web) return true;
  if (!(await linkWebFont(f))) return false;
  try {
    return (await document.fonts.load(`16px '${f.family}'`, text)).length > 0;
  } catch {
    return false;
  }
}

// 設定的字型是網路字型時，開程式就先載入
export function ensureFont(value: string, text = '永遠的第一章') {
  const f = findFont(value);
  return f ? loadFont(f, text) : Promise.resolve(true);
}
export const ensureScriptFont = ensureFont;
