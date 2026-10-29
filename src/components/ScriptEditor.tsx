import Editor from '@monaco-editor/react';

interface Props {
  fileId: string;
  initialText: string;
  onChange: (text: string) => void;
  onCursor: (pos: { line: number; column: number }) => void;
}

// 劇本編輯器（Monaco，VS Code 的編輯器核心）
export default function ScriptEditor(props: Props) {
  return (
    // path 讓每個檔案有各自的內容和復原紀錄，切回來時游標位置也還在
    <Editor
      path={props.fileId}
      defaultValue={props.initialText}
      theme="vs-dark"
      onChange={(v) => props.onChange(v ?? '')}
      onMount={(editor) =>
        editor.onDidChangeCursorPosition((e) => props.onCursor({ line: e.position.lineNumber, column: e.position.column }))
      }
      options={{
        fontFamily: "'Cascadia Code', 'Microsoft JhengHei UI', monospace",
        fontSize: 15,
        lineHeight: 26,
        wordWrap: 'on',
        minimap: { enabled: true },
        automaticLayout: true, // 容器大小改變時跟著重新排版（不然縮放後會變很窄、小地圖消失）
      }}
    />
  );
}
