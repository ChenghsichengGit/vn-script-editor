import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon';
import { fileIcon } from '../sampleData';
import { sectionMeta } from '../sections';
import { MAX_RESULTS, SearchGroup, SearchHit, SearchInput, SearchMatch, buildRegex, replacementFor, searchProject } from '../projectSearch';

// 搜尋框的內容與選項：放在 App 裡，切到「問題」分頁或關掉面板再打開時還在
export interface SearchState {
  query: string;
  replace: string;
  caseSensitive: boolean;
  regex: boolean;
  showReplace: boolean;
}
export const emptySearch: SearchState = { query: '', replace: '', caseSensitive: false, regex: false, showReplace: false };

// 下方面板的「搜尋」分頁：在所有劇本和設定卡裡找字，可以逐筆或全部取代
// 實際改內容由 App 做（onReplaceOne／onReplaceAll），這裡只負責找和顯示
export default function SearchPanel({
  data,
  state,
  onState,
  focusKey,
  onJump,
  onReplaceOne,
  onReplaceAll,
}: {
  data: SearchInput;
  state: SearchState;
  onState: (patch: Partial<SearchState>) => void;
  focusKey: number; // 每次 Ctrl+Shift+F 加一：把游標放進搜尋框
  onJump: (group: SearchGroup, hit: SearchHit, match: SearchMatch) => void;
  onReplaceOne: (hit: SearchHit, match: SearchMatch, re: RegExp) => void;
  onReplaceAll: (groups: SearchGroup[], re: RegExp) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusKey]);

  // 打字時不要每個字都重找：停 0.25 秒才找；內容（劇本、設定卡）變了也重找
  const [debounced, setDebounced] = useState({ state, data });
  useEffect(() => {
    const timer = setTimeout(() => setDebounced({ state, data }), 250);
    return () => clearTimeout(timer);
  }, [state.query, state.caseSensitive, state.regex, data]);

  const re = useMemo(() => buildRegex(debounced.state), [debounced.state.query, debounced.state.caseSensitive, debounced.state.regex]);
  const result = useMemo(() => (re instanceof RegExp ? searchProject(debounced.data, re) : null), [re, debounced.data]);

  const [folded, setFolded] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setFolded((f) => {
      const next = new Set(f);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const replaceable = result ? result.groups.reduce((n, g) => n + g.hits.filter((h) => !h.readonly).reduce((m, h) => m + h.matches.length, 0), 0) : 0;
  const showReplace = state.showReplace;

  // 一個結果那一行要顯示的樣子：找到的字前面最多留 30 個字，太長的開頭用「…」
  const preview = (m: SearchMatch, readonly: boolean) => {
    const from = Math.max(0, m.start - 30);
    const before = (from > 0 ? '…' : '') + m.text.slice(from, m.start).trimStart();
    const found = m.text.slice(m.start, m.end);
    const after = m.text.slice(m.end, m.end + 200);
    const willReplace = showReplace && !readonly && re instanceof RegExp;
    return (
      <span className="search-preview">
        {before}
        {willReplace ? (
          <>
            <del className="search-match">{found}</del>
            <ins className="search-insert">{replacementFor(found, re, state.replace, state.regex)}</ins>
          </>
        ) : (
          <span className="search-match">{found}</span>
        )}
        {after}
      </span>
    );
  };

  const groupIcon = (g: SearchGroup) => (g.kind === 'file' ? fileIcon(g.name) : sectionMeta(g.section!).icon);

  return (
    <div className="search-panel">
      <div className="search-inputs">
        <button
          type="button"
          className="icon-btn search-toggle"
          data-tip={showReplace ? '收起取代' : '取代'}
          onClick={() => onState({ showReplace: !showReplace })}
        >
          <Icon icon={showReplace ? 'chevron-down' : 'chevron-right'} />
        </button>
        <div className="search-fields">
          <div className="search-box">
            <input
              ref={inputRef}
              value={state.query}
              placeholder="搜尋"
              spellCheck={false}
              onChange={(e) => onState({ query: e.target.value })}
            />
            <button
              type="button"
              className={`icon-btn search-opt${state.caseSensitive ? ' on' : ''}`}
              data-tip="大小寫須相符"
              onClick={() => onState({ caseSensitive: !state.caseSensitive })}
            >
              <Icon icon="case-sensitive" />
            </button>
            <button
              type="button"
              className={`icon-btn search-opt${state.regex ? ' on' : ''}`}
              data-tip="使用正規表示式"
              onClick={() => onState({ regex: !state.regex })}
            >
              <Icon icon="regex" />
            </button>
          </div>
          {showReplace && (
            <div className="search-box">
              <input
                value={state.replace}
                placeholder={state.regex ? '取代（可用 $1、$& 等）' : '取代'}
                spellCheck={false}
                onChange={(e) => onState({ replace: e.target.value })}
              />
              <button
                type="button"
                className="icon-btn search-opt"
                data-tip="全部取代"
                disabled={!result || replaceable === 0}
                onClick={() => re instanceof RegExp && result && onReplaceAll(result.groups, re)}
              >
                <Icon icon="replace-all" />
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="search-summary">
        {typeof re === 'string'
          ? <span className="search-error">{re}</span>
          : result &&
            (result.total === 0
              ? '找不到結果'
              : `${result.total.toLocaleString()} 個結果，在 ${result.groups.length} 個檔案或設定卡中${result.truncated ? `（超過 ${MAX_RESULTS.toLocaleString()} 個，只列出前面的）` : ''}`)}
      </div>

      <div className="problems-body">
        {result?.groups.map((g) => {
          const open = !folded.has(g.key);
          const groupReplaceable = g.hits.some((h) => !h.readonly);
          return (
            <div key={g.key}>
              <div className="problems-file search-file" onClick={() => toggle(g.key)}>
                <Icon icon={open ? 'chevron-down' : 'chevron-right'} className="problems-chevron" />
                <Icon icon={groupIcon(g)} />
                <span className="problems-file-name">{g.name}</span>
                {g.folder && <span className="problems-dim">{g.folder}</span>}
                <span className="problems-badge">{g.count}</span>
                {showReplace && groupReplaceable && re instanceof RegExp && (
                  <button
                    type="button"
                    className="icon-btn search-row-btn"
                    data-tip="這個檔案全部取代"
                    onClick={(e) => {
                      e.stopPropagation();
                      onReplaceAll([g], re);
                    }}
                  >
                    <Icon icon="replace-all" />
                  </button>
                )}
              </div>
              {open &&
                g.hits.flatMap((h, hi) =>
                  h.matches.map((m, mi) => (
                    <div key={`${hi}:${mi}`} className="problems-row search-row" onClick={() => onJump(g, h, m)} title={m.text}>
                      {h.label && <span className="search-label">{h.label}</span>}
                      {preview(m, h.readonly)}
                      {showReplace && !h.readonly && re instanceof RegExp && (
                        <button
                          type="button"
                          className="icon-btn search-row-btn"
                          data-tip="取代"
                          onClick={(e) => {
                            e.stopPropagation();
                            onReplaceOne(h, m, re);
                          }}
                        >
                          <Icon icon="replace" />
                        </button>
                      )}
                    </div>
                  )),
                )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
