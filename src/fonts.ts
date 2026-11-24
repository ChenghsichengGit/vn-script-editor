// 劇本字型的選單：電腦上已經有的字型，和從 Google Fonts 載入的免費字型（只下載用到的字，下載過會留在暫存）

export interface FontOption {
  family: string; // CSS 的字型名稱（存進設定的就是 'family'）
  label: string; // 選單上顯示的名稱
  style: string; // 風格說明
  web?: boolean; // 要從網路載入
  partial?: boolean; // 日文字型：有些繁體字沒有，會用預設字型補
}

export const FONT_OPTIONS: FontOption[] = [
  { family: 'Microsoft JhengHei', label: '微軟正黑體', style: '現代黑體，乾淨好讀' },
  { family: 'Noto Sans TC', label: '思源黑體', style: '黑體，筆畫比正黑體細一點' },
  { family: 'PMingLiU', label: '新細明體', style: '傳統明體，像一般書本' },
  { family: 'Noto Serif TC', label: '思源宋體', style: '宋體，小說書籍的質感' },
  { family: 'DFKai-SB', label: '標楷體', style: '楷書，像毛筆字' },
  { family: 'LXGW WenKai TC', label: '霞鶩文楷', style: '手寫感的楷書，文青、溫柔', web: true },
  { family: 'Iansui', label: '芫荽', style: '手寫字，輕鬆可愛', web: true },
  { family: 'Huninn', label: 'jf open 粉圓', style: '圓體，圓潤可愛', web: true },
  { family: 'Cactus Classical Serif', label: '仙人掌明體', style: '古典刻本風，古書味道', web: true },
  { family: 'Chiron Hei HK', label: '昭源黑體', style: '俐落的現代黑體，有設計感', web: true },
  { family: 'Chiron Sung HK', label: '昭源宋體', style: '優雅的現代宋體', web: true },
  { family: 'Klee One', label: 'Klee One', style: '日系鉛筆手寫', web: true, partial: true },
  { family: 'Zen Maru Gothic', label: 'Zen Maru Gothic', style: '日系圓體', web: true, partial: true },
  { family: 'Hachi Maru Pop', label: 'はちまるポップ', style: '日系可愛手寫，像少女漫畫', web: true, partial: true },
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

// 設定的劇本字型是網路字型時，開程式就先載入
export function ensureScriptFont(value: string, text = '永遠的第一章') {
  const f = findFont(value);
  return f ? loadFont(f, text) : Promise.resolve(true);
}
