import { useState } from 'react';
import Icon from './Icon';
import { fileIcon } from '../sampleData';
import type { ScriptProblem } from '../scriptLanguage';

// 一個劇本的所有問題
export interface ProblemGroup {
  fileId: string;
  name: string;
  folder: string;
  lines: string[]; // 劇本內容（每一行），用來顯示出問題的那一行
  problems: ScriptProblem[];
}

// 編輯區下方的問題面板（跟 VS Code 一樣）：所有劇本的錯誤依檔案分組，點一下跳到那一行
// 上緣可以拖曳調整高度
export default function ProblemsPanel({
  groups,
  height,
  onResize,
  onJump,
  onClose,
}: {
  groups: ProblemGroup[];
  height: number;
  onResize: (height: number) => void;
  onJump: (fileId: string, line: number, column: number) => void;
  onClose: () => void;
}) {
  const [folded, setFolded] = useState<Set<string>>(new Set()); // 被收起來的檔案
  const total = groups.reduce((n, g) => n + g.problems.length, 0);

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = height;
    const move = (ev: MouseEvent) => onResize(Math.min(600, Math.max(80, startH + startY - ev.clientY)));
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const toggle = (fileId: string) =>
    setFolded((f) => {
      const next = new Set(f);
      if (!next.delete(fileId)) next.add(fileId);
      return next;
    });

  return (
    <div className="problems" style={{ height }}>
      <div className="problems-resize" onMouseDown={startResize} />
      <div className="problems-header">
        <span className="problems-title">問題</span>
        <span className="problems-count">{total}</span>
        <button type="button" className="icon-btn problems-close" title="關閉 (Ctrl+Shift+M)" onClick={onClose}>
          <Icon icon="close" />
        </button>
      </div>
      <div className="problems-body">
        {total === 0 && <div className="problems-empty">沒有發現問題</div>}
        {groups.map((g) => (
          <div key={g.fileId}>
            <div className="problems-file" onClick={() => toggle(g.fileId)}>
              <Icon icon={folded.has(g.fileId) ? 'chevron-right' : 'chevron-down'} className="problems-chevron" />
              <Icon icon={fileIcon(g.name)} />
              <span className="problems-file-name">{g.name}</span>
              {g.folder && <span className="problems-dim">{g.folder}</span>}
              <span className="problems-badge">{g.problems.length}</span>
            </div>
            {!folded.has(g.fileId) &&
              g.problems.map((p, i) => (
                <div
                  key={i}
                  className="problems-row"
                  onClick={() => onJump(g.fileId, p.line, p.startColumn)}
                  title={g.lines[p.line - 1]}
                >
                  <Icon icon="error" className="problems-error" />
                  <span>{p.message}</span>
                  <span className="problems-dim problems-code">{g.lines[p.line - 1]?.trim()}</span>
                  <span className="problems-dim">
                    [{p.line}, {p.startColumn}]
                  </span>
                </div>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}
