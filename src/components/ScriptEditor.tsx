import { useEffect, useRef } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import { DEFAULT_FONT_FAMILY, getSettings, updateSettings, useSettings } from '../settings';

interface Props {
  fileId: string;
  initialText: string;
  onChange: (text: string) => void;
  onCursor: (pos: { line: number; column: number }) => void;
  active: boolean; // 這個編輯器是不是目前作用中的面板；只有作用中的才回報游標位置給狀態列
}

// 劇本編輯器（Monaco，VS Code 的編輯器核心）
export default function ScriptEditor(props: Props) {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const monacoRef = useRef<Parameters<OnMount>[1] | null>(null);
  const modelRef = useRef<ReturnType<Parameters<OnMount>[0]['getModel']>>(null);

  // 事件只在編輯器建立時訂閱一次，所以用 ref 讀最新的 active 和 onCursor
  const activeRef = useRef(props.active);
  activeRef.current = props.active;
  const onCursorRef = useRef(props.onCursor);
  onCursorRef.current = props.onCursor;

  const settings = useSettings();

  const report = () => {
    const pos = editorRef.current?.getPosition();
    if (pos) onCursorRef.current({ line: pos.lineNumber, column: pos.column });
  };

  // 變成作用中的面板時（切分頁、點到另一個群組），把自己的游標位置報給狀態列
  useEffect(() => {
    if (props.active) report();
  }, [props.active]);

  // 面板關掉時，如果沒有別的編輯器（例如分割出來的另一個畫面）還在用這份內容，就把它釋放掉
  // 不能交給 @monaco-editor/react 自己釋放：分割時兩個畫面共用同一份內容，關掉一個就會害另一個壞掉
  // 晚一個 tick 才檢查，等元件庫先把這個編輯器本身銷毀
  useEffect(
    () => () => {
      const model = modelRef.current;
      const monaco = monacoRef.current;
      if (!model || !monaco) return;
      setTimeout(() => {
        if (!model.isDisposed() && !monaco.editor.getEditors().some((e) => e.getModel() === model)) model.dispose();
      }, 0);
    },
    [],
  );

  return (
    // path 讓每個檔案有各自的內容和復原紀錄；同一個檔案開在兩個畫面時共用同一份，內容自動同步
    <Editor
      path={props.fileId}
      defaultValue={props.initialText}
      theme="vs-dark"
      keepCurrentModel
      onChange={(v) => props.onChange(v ?? '')}
      onMount={(editor, monaco) => {
        editorRef.current = editor;
        monacoRef.current = monaco;
        modelRef.current = editor.getModel();
        // 游標移動：只有作用中的面板才回報（另一個畫面編輯同一份內容時，這邊的游標也會被推動，不能算）
        editor.onDidChangeCursorPosition(() => activeRef.current && report());
        if (activeRef.current) report();
        // Ctrl＋滾輪：調整設定裡的「劇本文字大小」（所有劇本分頁一起變，也會記住）
        // 用捕捉階段先攔下來，不讓編輯器把它當成一般的捲動
        editor.getDomNode()?.addEventListener(
          'wheel',
          (e) => {
            if (!e.ctrlKey) return;
            e.preventDefault();
            e.stopPropagation();
            const { scriptFontSize } = getSettings();
            updateSettings({ scriptFontSize: scriptFontSize + (e.deltaY < 0 ? 1 : -1) });
          },
          { capture: true, passive: false },
        );
      }}
      options={{
        fontFamily: settings.scriptFontFamily.trim() ? `${settings.scriptFontFamily}, ${DEFAULT_FONT_FAMILY}` : DEFAULT_FONT_FAMILY,
        fontSize: settings.scriptFontSize,
        lineHeight: Math.round(settings.scriptFontSize * 1.75), // 行距跟著字的大小等比例
        wordWrap: settings.wordWrap ? 'on' : 'off',
        minimap: { enabled: settings.minimap, scale: settings.minimapScale },
        // 左邊的空白會跟著字體變寬，所以盡量收窄：行號先留 3 位數（超過會自動變寬）、
        // 不要放中斷點的符號欄、行號和文字之間的間距縮小；摺疊箭頭保留，之後分段可以用
        lineNumbersMinChars: 3,
        glyphMargin: false,
        lineDecorationsWidth: 6,
        automaticLayout: true, // 容器大小改變時跟著重新排版（不然縮放後會變很窄、小地圖消失）
      }}
    />
  );
}
