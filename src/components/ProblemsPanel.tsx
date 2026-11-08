import { useState } from 'react';
import Icon, { fileIcon } from './Icon';
import type { ScriptProblem } from '../scriptLanguage';

export interface ProblemGroup {
  fileId: string;
  name: string;
  folder: string;
  lines: string[]; // 劇本內容（每一行），用來顯示出問題的那一行
  problems: ScriptProblem[];
}

export default function ProblemsPanel({ groups, onJump }: {
  groups: ProblemGroup[];
  onJump: (fileId: string, line: number, column: number) => void;
}) {
  const [folded, setFolded] = useState<Set<string>>(new Set()); // 被收起來的檔案
  const total = groups.reduce((n, g) => n + g.problems.length, 0);
  const toggle = (fileId: string) =>
    setFolded((f) => {
      const next = new Set(f);
      if (!next.delete(fileId)) next.add(fileId);
      return next;
    });
  return (
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
              <div key={i} className="problems-row" onClick={() => onJump(g.fileId, p.line, p.startColumn)} title={g.lines[p.line - 1]}>
                <Icon icon="error" className="problems-error" />
                <span>{p.message}</span>
                <span className="problems-dim problems-code">{g.lines[p.line - 1]?.trim()}</span>
                <span className="problems-dim">[{p.line}, {p.startColumn}]</span>
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}
