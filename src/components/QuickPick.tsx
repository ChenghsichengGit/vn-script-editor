import { useEffect, useMemo, useRef, useState } from 'react';
import Icon, { IconDef } from './Icon';
import './QuickPick.css';

// 清單裡的一項
export interface QuickPickItem {
  id: string;
  label: string;
  detail?: string; // 灰色小字：所在位置、說明
  icon?: IconDef | string;
  keybinding?: string; // 右邊顯示的快捷鍵
  run: () => QuickPickPrompt | void; // 回傳 QuickPickPrompt：接著在同一個框裡輸入名稱
}

// 「輸入名稱」模式：例如指令面板選了「新增角色」，接著在同一個框裡打名稱
export interface QuickPickPrompt {
  placeholder: string;
  submit: (value: string) => string | null; // 回傳錯誤訊息（名稱重複等）或 null
}

// 模糊比對：打的字依序出現在文字裡就算符合（不用連在一起），例如「小明角」找得到「角色／小明」
// 分數越高越前面：連續的字、出現在開頭、整段一樣都加分；不符合回傳 -1
function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase().replace(/\s+/g, '');
  if (!q) return 0;
  const t = text.toLowerCase();
  let score = 0;
  let from = 0;
  let prev = -2;
  for (const ch of q) {
    const i = t.indexOf(ch, from);
    if (i < 0) return -1;
    score += i === prev + 1 ? 5 : 1; // 連續的字
    if (i === 0) score += 3; // 在開頭
    prev = i;
    from = i + 1;
  }
  if (t.includes(q)) score += 10; // 整段連在一起出現
  return score;
}

// VS Code 式的快速選單：畫面上方中間一個輸入框 + 清單
// Ctrl+P：找劇本和設定卡；輸入框開頭打 > 就變成指令面板（Ctrl+Shift+P 直接從 > 開始）
// ↑↓ 選、Enter 確定、Esc 或點外面關閉
export default function QuickPick({
  initial,
  files,
  commands,
  onClose,
}: {
  initial: string; // 一開始輸入框裡的字：'' = 找檔案、'>' = 指令面板
  files: QuickPickItem[];
  commands: QuickPickItem[];
  onClose: () => void;
}) {
  const [text, setText] = useState(initial);
  const [index, setIndex] = useState(0);
  const [prompt, setPrompt] = useState<QuickPickPrompt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => inputRef.current?.focus(), [prompt]);

  const isCommand = !prompt && text.startsWith('>');
  const query = isCommand ? text.slice(1) : text;

  // 依分數排好；沒打字時照原本的順序
  const shown = useMemo(() => {
    if (prompt) return [];
    const source = isCommand ? commands : files;
    if (!query.trim()) return source;
    return source
      .map((item) => ({ item, score: fuzzyScore(query, `${item.label} ${item.detail ?? ''}`) }))
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.item);
  }, [prompt, isCommand, query, files, commands]);

  useEffect(() => setIndex(0), [text]);

  // 選中的那一項捲到看得見的地方
  useEffect(() => {
    listRef.current?.querySelector('.qp-item.active')?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  // 執行一項；回傳 QuickPickPrompt 的項目（新增○○）會切到「輸入名稱」模式，不關閉
  const choose = (item: QuickPickItem | undefined) => {
    if (!item) return;
    const next = item.run();
    if (next) {
      setPrompt(next);
      setText('');
      setError(null);
    } else onClose();
  };

  const submitPrompt = () => {
    if (!prompt) return;
    const err = prompt.submit(text);
    if (err) setError(err);
    else onClose();
  };

  return (
    <div className="qp-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="qp-panel">
        <input
          ref={inputRef}
          className="qp-input"
          value={text}
          spellCheck={false}
          placeholder={prompt ? prompt.placeholder : isCommand ? '輸入功能名稱' : '輸入劇本或設定卡的名稱（開頭打 > 可以找功能）'}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            } else if (e.key === 'Enter') {
              e.preventDefault();
              if (prompt) submitPrompt();
              else choose(shown[index]);
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              const n = shown.length;
              if (n > 0) setIndex((i) => (i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
            }
          }}
        />
        {error && <div className="qp-error">{error}</div>}
        {!prompt && (
          <div className="qp-list" ref={listRef}>
            {shown.length === 0 && <div className="qp-empty">沒有符合的項目</div>}
            {shown.map((item, i) => (
              <div
                key={item.id}
                className={`qp-item${i === index ? ' active' : ''}`}
                onMouseMove={() => i !== index && setIndex(i)}
                onMouseDown={(e) => {
                  e.preventDefault(); // 輸入框不要失去焦點
                  choose(item);
                }}
              >
                {item.icon && <Icon icon={item.icon} className="qp-icon" />}
                <span className="qp-label">{item.label}</span>
                {item.detail && <span className="qp-detail">{item.detail}</span>}
                {item.keybinding && <span className="qp-key">{item.keybinding}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
