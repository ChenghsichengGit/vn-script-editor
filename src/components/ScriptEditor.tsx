import { useLatest } from '../hooks';
import { useEffect, useRef, useState } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import { DEFAULT_FONT_FAMILY, getSettings, updateSettings, useSettings } from '../settings';
import { LANGUAGE_ID, registerScriptLanguage, scriptHeadings } from '../scriptLanguage';
import { BubbleState, addScriptActions, attachPreview, promptScriptRuby, setHeadingLines, trackSelectionBubble } from '../scriptPreview';
import type monacoApi from '../monaco';
import Outline, { Heading } from './Outline';
import { SAVE_ALL_EVENT } from '../model';
import { attachModel } from '../changeMarks';
import ChangeBar from './ChangeBar';

interface Props {
  fileId: string;
  initialText: string;
  onChange: (text: string) => void;
  onCursor: (pos: { line: number; column: number }) => void;
  active: boolean; // 這個編輯器是不是目前作用中的面板；只有作用中的才回報游標位置給狀態列
  fileName: string; // .vns 才用劇本語言（指令上色、補齊、提示），其他當純文字
}

export default function ScriptEditor(props: Props) {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const monacoRef = useRef<Parameters<OnMount>[1] | null>(null);
  const modelRef = useRef<ReturnType<Parameters<OnMount>[0]['getModel']>>(null);
  const activeRef = useLatest(props.active);
  const onCursorRef = useLatest(props.onCursor);
  const settings = useSettings();
  const isScript = /\.vns$/i.test(props.fileName);
  const mainRef = useRef<HTMLDivElement>(null);
  const [bubble, setBubble] = useState<BubbleState | null>(null);
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [active, setActive] = useState(0);
  const headingsRef = useRef<Heading[]>([]);
  headingsRef.current = headings;
  const syncActive = () => {
    const line = editorRef.current?.getPosition()?.lineNumber ?? 1;
    let current = 0;
    headingsRef.current.forEach((h, i) => {
      if (h.pos <= line) current = i;
    });
    setActive(current);
  };
  const jump = (i: number) => {
    const editor = editorRef.current;
    const h = headingsRef.current[i];
    if (!editor || !h) return;
    setActive(i);
    editor.revealLineNearTop(h.pos);
    editor.setPosition({ lineNumber: h.pos, column: 1 });
    editor.focus();
  };
  const report = () => {
    const pos = editorRef.current?.getPosition();
    if (pos) onCursorRef.current({ line: pos.lineNumber, column: pos.column });
  };
  useEffect(() => {
    if (props.active) report();
  }, [props.active]);
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
    <div className="script-editor">
      <div className="script-editor-main" ref={mainRef}>
        <ChangeBar markKey={props.fileId} />
        <Editor
          path={props.fileId}
          defaultValue={props.initialText}
          theme={`vn-${settings.theme}`} // 顏色主題：vn-dark／vn-light／vn-hc（定義在 scriptLanguage.ts）
          language={isScript ? LANGUAGE_ID : 'plaintext'}
          beforeMount={registerScriptLanguage}
          keepCurrentModel
          onChange={(v) => props.onChange(v ?? '')}
          onMount={(editor, monaco) => {
            editorRef.current = editor;
            monacoRef.current = monaco;
            modelRef.current = editor.getModel();
            if (modelRef.current) attachModel(props.fileId, modelRef.current); // 畫上「外部修改」的標記
            if (isScript) {
              const collect = () => {
                headingsRef.current = scriptHeadings(editor.getModel()?.getLinesContent() ?? []);
                setHeadings(headingsRef.current);
                syncActive();
              };
              collect();
              editor.onDidChangeModelContent(collect);
              editor.onDidChangeCursorPosition(syncActive);
              attachPreview(editor);
              addScriptActions(editor);
              trackSelectionBubble(editor, () => mainRef.current, setBubble);
            }
            editor.addCommand(monaco.KeyMod.chord(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, monaco.KeyCode.KeyS), () =>
              window.dispatchEvent(new Event(SAVE_ALL_EVENT)),
            );
            editor.onDidChangeCursorPosition(() => activeRef.current && report());
            if (activeRef.current) report();
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
            lineNumbersMinChars: 3,
            glyphMargin: false,
            lineDecorationsWidth: 6,
            wordBasedSuggestions: 'off', // 不要把文章裡出現過的詞也塞進補齊清單，只留指令和參數
            quickSuggestions: true, // 打字時就跳清單（打到指令名稱或參數的第幾個字都可以）；一般對白那幾行補齊沒有東西，所以不會跳
            automaticLayout: true, // 容器大小改變時跟著重新排版（不然縮放後會變很窄、小地圖消失）
          }}
        />
        {bubble && editorRef.current && (
          <ScriptBubble editor={editorRef.current} multiLine={bubble.multiLine} style={{ left: bubble.x, top: bubble.y }} />
        )}
      </div>
      {headings.length > 0 && <Outline headings={headings} active={active} onJump={jump} />}
    </div>
  );
}

function ScriptBubble({ editor, multiLine, style }: { editor: monacoApi.editor.ICodeEditor; multiLine: boolean; style: React.CSSProperties }) {
  const buttons = [
    { label: '標音', hidden: multiLine, run: () => promptScriptRuby(editor) },
    { label: '大標題', run: () => setHeadingLines(editor, 1) },
    { label: '中標題', run: () => setHeadingLines(editor, 2) },
    { label: '小標題', run: () => setHeadingLines(editor, 3) },
    { label: '註解', run: () => editor.trigger('bubble', 'editor.action.commentLine', null) },
  ];
  return (
    <div className="bubble-toolbar script-bubble" style={style}>
      {buttons
        .filter((b) => !b.hidden)
        .map((b) => (
          <button key={b.label} onMouseDown={(e) => e.preventDefault()} onClick={b.run}>{b.label}</button>
        ))}
    </div>
  );
}
