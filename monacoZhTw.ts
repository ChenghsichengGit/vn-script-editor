// 劇本編輯器（Monaco）內建的文字換成繁體中文（右鍵選單的「剪下、複製」、尋找視窗等）
import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

const root = path.resolve('node_modules/monaco-editor');

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

const MESSAGE = /localize2?\(\s*(?:'[^']*'|"[^"]*"|\{[^}]*\})\s*,\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g;

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
    transform(code, id) {
      if (isNls(id)) return patchNls(code, '__ZH_TW_DICT__');
      if (isMonaco(id)) for (const m of code.matchAll(MESSAGE)) used.add(new Function(`return ${m[1]}`)());
      return null;
    },
    renderChunk(code) {
      if (!code.includes('__ZH_TW_DICT__')) return null;
      const all = getDict();
      const picked = Object.fromEntries([...used].filter((e) => e in all).map((e) => [e, all[e]]));
      return code.replace('__ZH_TW_DICT__', () => JSON.stringify(picked)); // 用函式：翻譯裡的 $ 不會被當成取代符號
    },
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
