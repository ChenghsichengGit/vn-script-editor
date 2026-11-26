// 左右兩邊區塊共用的單欄樹（仿 Unity Project 視窗的 One Column Layout）
//   選取：點一下選取，Ctrl＋點加選，Shift＋點選一段；點兩下或 Enter 打開
//   鍵盤：↑↓ 移動、Home／End、→ 展開或進到第一個子項、← 收起或回到上一層、F2 改名、Delete 刪除、Ctrl+A 全選
//   另外有工具列（＋▾、搜尋框、篩選）、搜尋結果的標頭、最下面的路徑列、箭頭（Alt＋點 = 底下全部一起）
import { useEffect, useRef, useState } from 'react';
import Icon, { IconDef } from './Icon';

export interface NavRow {
  id: string;
  depth: number;
  pick?: boolean; // 可以被選取（預設可以）
  kids?: boolean; // 有可以展開的東西
  open?: boolean; // 現在是展開的
}

interface NavHandlers<R extends NavRow> {
  toggle: (row: R, open: boolean, alt: boolean) => void;
  activate: (row: R) => void;
  rename: (row: R) => void;
  remove: (ids: string[]) => void;
  escape?: () => boolean; // Esc：有處理回傳 true（例如清除搜尋）
  key?: (e: React.KeyboardEvent, row: R | undefined) => boolean; // 區塊自己的按鍵（例如空白鍵展開卡片欄位）
  busy: boolean; // 正在輸入名稱：樹不處理按鍵
}

export function useTreeNav<R extends NavRow>(rows: R[], h: NavHandlers<R>) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<string | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const pickable = (r: R) => r.pick !== false;
  // 游標移到看不到的地方：捲過去
  useEffect(() => {
    if (!cursor) return;
    treeRef.current?.querySelector(`[data-row="${CSS.escape(cursor)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);
  const focus = () => treeRef.current?.focus({ preventScroll: true });
  const selectOnly = (id: string) => {
    setSelected(new Set([id]));
    setCursor(id);
    setAnchor(id);
  };
  const clear = () => setSelected(new Set());
  const selectRange = (from: string | null, to: string) => {
    const a = rows.findIndex((r) => r.id === (from ?? to));
    const b = rows.findIndex((r) => r.id === to);
    if (a < 0 || b < 0) return selectOnly(to);
    const [lo, hi] = a < b ? [a, b] : [b, a];
    setSelected(new Set(rows.slice(lo, hi + 1).filter(pickable).map((r) => r.id)));
    setCursor(to);
  };
  const click = (e: React.MouseEvent, id: string) => {
    focus();
    if (e.shiftKey) return selectRange(anchor, id);
    if (e.ctrlKey || e.metaKey) {
      setSelected((s) => {
        const next = new Set(s);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      setCursor(id);
      setAnchor(id);
      return;
    }
    selectOnly(id);
  };
  // 右鍵：點在沒選到的列上 = 只選它；回傳這次要處理的那些
  const forMenu = (id: string) => {
    if (selected.has(id)) return selected;
    selectOnly(id);
    return new Set([id]);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget || h.busy) return;
    const i = rows.findIndex((r) => r.id === cursor);
    const row = rows[i];
    if (h.key?.(e, row)) return e.preventDefault();
    const go = (j: number) => {
      const r = rows[Math.max(0, Math.min(rows.length - 1, j))];
      if (!r) return;
      if (e.shiftKey) selectRange(anchor, r.id);
      else selectOnly(r.id);
    };
    const parentRow = () => {
      for (let j = i - 1; j >= 0; j--) if (rows[j].depth < row.depth) return rows[j];
      return undefined;
    };
    switch (e.key) {
      case 'ArrowDown':
        go(i < 0 ? 0 : i + 1);
        break;
      case 'ArrowUp':
        go(i < 0 ? 0 : i - 1);
        break;
      case 'Home':
        go(0);
        break;
      case 'End':
        go(rows.length - 1);
        break;
      case 'ArrowRight':
        if (!row) return go(0);
        if (row.kids && !row.open) h.toggle(row, true, e.altKey);
        else if (rows[i + 1]?.depth > row.depth) go(i + 1);
        break;
      case 'ArrowLeft':
        if (!row) return go(0);
        if (row.kids && row.open) h.toggle(row, false, e.altKey);
        else {
          const p = parentRow();
          if (p) selectOnly(p.id);
        }
        break;
      case 'Enter':
        if (row) h.activate(row);
        break;
      case 'F2':
        if (row) h.rename(row);
        break;
      case 'Delete':
        if (selected.size) h.remove([...selected]);
        break;
      case 'a':
        if (!(e.ctrlKey || e.metaKey)) return;
        setSelected(new Set(rows.filter(pickable).map((r) => r.id)));
        break;
      case 'Escape':
        if (!h.escape?.()) return;
        break;
      default:
        return;
    }
    e.preventDefault();
  };
  const rowCls = (id: string) => `${selected.has(id) ? ' ap-selected' : ''}${cursor === id ? ' ap-cursor' : ''}`;
  // 樹的外框：可以拿到焦點、按鍵、點空白處取消選取
  const treeProps = {
    ref: treeRef,
    tabIndex: 0,
    onKeyDown,
    onMouseDown: (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) clear();
    },
  };
  return { selected, setSelected, cursor, setCursor, anchor, selectOnly, selectRange, click, forMenu, clear, focus, rowCls, treeProps, treeRef };
}

// 列最前面的箭頭（沒有東西可以展開時只留空位）；Alt＋點 = 底下全部一起
export function TreeArrow({ kids, open, onToggle }: { kids?: boolean; open?: boolean; onToggle?: (alt: boolean) => void }) {
  if (!kids) return <span className="ap-arrow" />;
  return (
    <span
      className="ap-arrow"
      onClick={(e) => {
        e.stopPropagation();
        onToggle?.(e.altKey);
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <Icon icon={open ? 'chevron-down' : 'chevron-right'} className="chevron" />
    </span>
  );
}

// 工具列：＋▾（新增選單）、搜尋框、其他按鈕（例如篩選）
export function TreeToolbar({ plusTip, onPlus, query, setQuery, placeholder, onSearchDown, children }: {
  plusTip: string;
  onPlus: (x: number, y: number) => void;
  query: string;
  setQuery: (q: string) => void;
  placeholder: string;
  onSearchDown: () => void; // 在搜尋框按 ↓：跳到樹
  children?: React.ReactNode;
}) {
  return (
    <div className="ap-toolbar">
      <button
        type="button"
        className="ap-plus"
        data-tip={plusTip}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          onPlus(r.left, r.bottom + 2);
        }}
      >
        <Icon icon="add" />
        <span className="ap-caret">▾</span>
      </button>
      <span className="ap-search">
        <Icon icon="search" />
        <input
          value={query}
          placeholder={placeholder}
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && query) (e.preventDefault(), e.stopPropagation(), setQuery(''));
            if (e.key === 'ArrowDown') (e.preventDefault(), onSearchDown());
          }}
        />
        {query && (
          <button type="button" className="ap-clear" data-tip="清除" onClick={() => setQuery('')}>
            <Icon icon="close" />
          </button>
        )}
      </span>
      {children}
    </div>
  );
}

// 搜尋中：上面一條說明＋「回到樹狀」
export function SearchHead({ text, onBack }: { text: React.ReactNode; onBack: () => void }) {
  return (
    <div className="ap-search-head">
      <span>{text}</span>
      <button type="button" className="link" onClick={onBack}>回到樹狀</button>
    </div>
  );
}

// 最下面的路徑列：選到的東西在哪裡；多選時加上「選了 N 個」
export function PathBar({ icon, text, count }: { icon?: IconDef | string; text: string; count: number }) {
  return (
    <div className="ap-pathbar" title={text}>
      {text ? (
        <>
          <Icon icon={icon ?? 'folder'} />
          <span>{text}</span>
          {count > 1 && <span className="ap-count">（選了 {count} 個）</span>}
        </>
      ) : (
        <span className="ap-dim">點一下選取，點兩下開啟</span>
      )}
    </div>
  );
}
