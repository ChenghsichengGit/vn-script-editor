// 劇本編輯器（Monaco）內建的文字換成繁體中文（右鍵選單的「剪下、複製」、尋找視窗等）
//
// 為什麼要自己做：Monaco 附的繁中翻譯（min/vs/nls.messages.zh-tw.js）是給「整包版」用的，用編號查；
// 我們用的是只載入部分功能的 ESM 版（src/monaco.ts），它是直接寫英文字、不查編號，所以接不上
// 做法：建置時從 dev 版（dev/vs/editor/editor.main.js，裡面是 localize(編號, "英文")）對出「英文 → 編號 → 繁中」，
// 再把 ESM 版的 nls.js 改成「先查這份對照表，查不到才用英文」。正式打包（Rollup）和開發時的預先打包（esbuild）都要改
// 正式打包時只留下實際用到的文字（整份對照表 120KB 左右，只留用到的小很多）
import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

const root = path.resolve('node_modules/monaco-editor');

// 讀出「英文 → 繁中」對照表
function buildDictionary(): Record<string, string> {
  const zhText = fs.readFileSync(path.join(root, 'min/vs/nls.messages.zh-tw.js'), 'utf8');
  const start = zhText.indexOf('globalThis._VSCODE_NLS_MESSAGES=') + 'globalThis._VSCODE_NLS_MESSAGES='.length;
  const end = zhText.indexOf(',globalThis._VSCODE_NLS_LANGUAGE');
  const zh: string[] = new Function(`return ${zhText.slice(start, end)}`)();

  const dev = fs.readFileSync(path.join(root, 'dev/vs/editor/editor.main.js'), 'utf8');
  const dict: Record<string, string> = {};
  const re = /localize2?\((\d+),\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g;
  for (const m of dev.matchAll(re)) {
    const english: string = new Function(`return ${m[2]}`)();
    const chinese = zh[Number(m[1])];
    if (typeof chinese === 'string' && english && !(english in dict)) dict[english] = chinese;
  }
  return dict;
}

const isNls = (id: string) => /monaco-editor[\\/]esm[\\/]vs[\\/]nls\.js$/.test(id);
const isMonaco = (id: string) => /monaco-editor[\\/]esm[\\/]/.test(id);

// Monaco 原始碼裡 localize('key', "英文") 的英文
const MESSAGE = /localize2?\(\s*(?:'[^']*'|"[^"]*"|\{[^}]*\})\s*,\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g;

// 把 nls.js 改成先查對照表；dictCode = 對照表的程式碼（正式打包時先放一個記號，最後才換成只留用到的那些）
function patchNls(code: string, dictCode: string): string {
  return (
    `const __ZH_TW = ${dictCode};\n` +
    code
      .replace('return _format(message, args);\n}', 'return _format(__ZH_TW[message] ?? message, args);\n}')
      .replace('message = originalMessage;', 'message = __ZH_TW[originalMessage] ?? originalMessage;')
  );
}

export default function monacoZhTw(): Plugin {
  let dict: Record<string, string> | null = null;
  const getDict = () => (dict ??= buildDictionary());
  const used = new Set<string>(); // 打包進來的 Monaco 程式碼裡出現過的英文
  return {
    name: 'monaco-zh-tw',
    // 正式打包：nls.js 先放記號；同時記下每個 Monaco 檔案用到哪些英文
    transform(code, id) {
      if (isNls(id)) return patchNls(code, '__ZH_TW_DICT__');
      if (isMonaco(id)) for (const m of code.matchAll(MESSAGE)) used.add(new Function(`return ${m[1]}`)());
      return null;
    },
    // 所有檔案都看過了：把記號換成「只留用到的英文」的對照表
    renderChunk(code) {
      if (!code.includes('__ZH_TW_DICT__')) return null;
      const all = getDict();
      const picked = Object.fromEntries([...used].filter((e) => e in all).map((e) => [e, all[e]]));
      return code.replace('__ZH_TW_DICT__', () => JSON.stringify(picked)); // 用函式：翻譯裡的 $ 不會被當成取代符號
    },
    // 開發時 Vite 會先用 esbuild 把 monaco-editor 預先打包，上面的 transform 管不到，這裡另外處理
    config() {
      return {
        optimizeDeps: {
          esbuildOptions: {
            plugins: [
              {
                name: 'monaco-zh-tw',
                setup(build) {
                  build.onLoad({ filter: /monaco-editor[\\/]esm[\\/]vs[\\/]nls\.js$/ }, (args) => ({
                    contents: patchNls(fs.readFileSync(args.path, 'utf8'), JSON.stringify(getDict())),
                    loader: 'js',
                  }));
                },
              },
            ],
          },
        },
      };
    },
  };
}
