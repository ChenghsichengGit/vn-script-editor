import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon';
import IconPicker, { pickerPosition } from './IconPicker';
import { dragWith } from '../App';
import { COMMANDS_ID, FILES_SECTION, SectionDef, SectionRemoval, colorVar } from '../sections';
import { sanitizeName } from '../projectFiles';
import './SchemaDialog.css';

// 編輯中的一列：isNew = 這次才新增的（還沒有資料夾）
interface Row extends SectionDef {
  key: number; // React key
  isNew?: boolean;
}

// 「區塊設定」：左邊活動列和側邊欄有哪些設定卡區塊
// 每列：握把（拖曳排序）、圖示（點了選圖示和顏色）、名稱（= 專案裡的資料夾名稱）、新項目的預設名稱、× 刪除
// 「檔案」（劇本）固定在最上面不能動；「指令」不能改名、不能刪，只能換圖示、排位置
// 按「儲存」才真的改（改名時硬碟上的資料夾跟著改名）
export default function SectionsDialog({
  sections,
  cardCount,
  onSave,
  onClose,
}: {
  sections: SectionDef[];
  cardCount: (id: string) => number; // 這個區塊目前有幾張卡（刪除時提醒用）
  onSave: (next: SectionDef[], removals: SectionRemoval[]) => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<Row[]>(() => sections.map((s, i) => ({ ...s, key: i })));
  const [nextKey, setNextKey] = useState(sections.length);
  const [removals, setRemovals] = useState<SectionRemoval[]>([]);
  const [picker, setPicker] = useState<{ key: number; x: number; y: number } | null>(null);
  const [confirmDel, setConfirmDel] = useState<{ row: Row; count: number } | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const rowEls = useRef(new Map<number, HTMLDivElement>());

  // Esc：先關最上層的（刪除確認、圖示面板），都沒有才關掉整個視窗
  const overlay = useRef<'confirm' | 'picker' | null>(null);
  overlay.current = confirmDel ? 'confirm' : picker ? 'picker' : null;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (overlay.current === 'confirm') setConfirmDel(null);
      else if (overlay.current === 'picker') setPicker(null);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const patch = (key: number, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));

  const add = () => {
    setRows((rs) => [...rs, { key: nextKey, id: `s${Date.now().toString(36)}${nextKey}`, title: '', dir: '', icon: 'tag', isNew: true }]);
    setNextKey(nextKey + 1);
  };

  const removeRow = (row: Row, deleteFolder?: boolean) => {
    setRows((rs) => rs.filter((r) => r.key !== row.key));
    if (picker?.key === row.key) setPicker(null);
    if (!row.isNew) setRemovals((list) => [...list.filter((x) => x.id !== row.id), { id: row.id, deleteFolder: !!deleteFolder }]);
  };
  const askRemove = (row: Row) => {
    if (row.isNew) return removeRow(row);
    setConfirmDel({ row, count: cardCount(row.id) });
  };

  // 按住握把上下拖：滑鼠經過別列的中線，就把這一列換到那個位置
  const startDrag = (key: number, e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(key);
    dragWith(
      (ev) =>
        setRows((rs) => {
          const others = rs.filter((r) => r.key !== key);
          let at = others.findIndex((r) => {
            const box = rowEls.current.get(r.key)?.getBoundingClientRect();
            return box ? ev.clientY < box.top + box.height / 2 : false;
          });
          if (at < 0) at = others.length;
          if (rs.findIndex((r) => r.key === key) === at) return rs;
          const next = [...others];
          next.splice(at, 0, rs.find((r) => r.key === key)!);
          return next;
        }),
      () => setDragging(null),
    );
  };

  // 驗證：名稱不能空白、不能重複，也不能跟「劇本」資料夾撞名（名稱就是資料夾名稱）
  const error = useMemo(() => {
    const dirs = new Set([FILES_SECTION.dir.toLowerCase()]);
    for (const r of rows) {
      const title = r.title.trim();
      if (!title) return '區塊名稱不能是空白';
      const dir = (r.id === COMMANDS_ID ? r.dir : sanitizeName(title)).toLowerCase();
      if (dirs.has(dir)) return `「${title}」跟其他區塊（或劇本資料夾）重複了`;
      dirs.add(dir);
    }
    return null;
  }, [rows]);

  const save = () => {
    if (error) return;
    const out: SectionDef[] = rows.map(({ key: _k, isNew: _n, ...s }) => {
      const title = s.title.trim();
      const def: SectionDef = { ...s, title, dir: s.id === COMMANDS_ID ? s.dir : sanitizeName(title) };
      const newName = s.newName?.trim();
      if (newName) def.newName = newName;
      else delete def.newName;
      if (!def.memory) delete def.memory;
      return def;
    });
    onSave(out, removals);
    onClose();
  };

  const pickerRow = picker ? rows.find((r) => r.key === picker.key) : undefined;

  return (
    <div
      className="schema-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="schema-panel" spellCheck={false} role="dialog" aria-label="區塊設定">
        <div className="schema-header">
          <span className="schema-title">區塊設定</span>
          <button type="button" className="schema-close" onClick={onClose} title="關閉">
            ×
          </button>
        </div>

        <div className="schema-body">
          <div className="schema-note">
            左邊活動列和側邊欄的區塊。每個區塊對應專案裡一個同名資料夾，改名時資料夾也會跟著改名。按住左邊的 ⋮⋮ 可以上下拖曳排序。
          </div>

          <div className="schema-table">
            <div className="schema-row schema-head">
              <span className="schema-grip" />
              <span className="schema-icon" />
              <span className="schema-col">區塊名稱（資料夾）</span>
              <span className="schema-col">新項目的預設名稱</span>
              <span className="schema-memory" title="勾了之後，這個區塊的卡片多一個「記憶」：什麼時候認識誰、怎麼稱呼、印象…">
                記憶
              </span>
              <span className="schema-del" />
            </div>

            {/* 「檔案」：劇本，固定在最上面 */}
            <div className="schema-row">
              <span className="schema-grip" />
              <span className="schema-icon" title="劇本區塊固定在最上面">
                <Icon icon={{ name: FILES_SECTION.icon, color: colorVar(FILES_SECTION.color) }} />
              </span>
              <span className="schema-col">
                <span className="schema-fixed">檔案（劇本）</span>
              </span>
              <span className="schema-col" />
              <span className="schema-memory" />
              <span className="schema-del" />
            </div>

            {rows.map((r) => {
              const locked = r.id === COMMANDS_ID;
              return (
                <div
                  key={r.key}
                  className={`schema-row${dragging === r.key ? ' dragging' : ''}`}
                  ref={(el) => {
                    if (el) rowEls.current.set(r.key, el);
                    else rowEls.current.delete(r.key);
                  }}
                >
                  <span className="schema-grip" title="按住上下拖曳排序" onMouseDown={(e) => startDrag(r.key, e)}>
                    <Icon icon="gripper" />
                  </span>
                  <button
                    type="button"
                    className={`schema-icon schema-icon-btn${picker?.key === r.key ? ' open' : ''}`}
                    title="選擇圖示和顏色"
                    onClick={(e) => {
                      const at = pickerPosition(e.currentTarget);
                      setPicker((p) => (p?.key === r.key ? null : { key: r.key, ...at }));
                    }}
                  >
                    <Icon icon={{ name: r.icon, color: colorVar(r.color) }} />
                  </button>
                  <span className="schema-col schema-name-cell">
                    {locked ? (
                      <span className="schema-fixed" title="指令區塊跟劇本語法綁在一起，不能改名或刪除">
                        {r.title}
                      </span>
                    ) : (
                      <input
                        type="text"
                        className="schema-input"
                        value={r.title}
                        placeholder="例如：道具、地點"
                        autoFocus={r.isNew}
                        onChange={(e) => patch(r.key, { title: e.target.value })}
                      />
                    )}
                  </span>
                  <span className="schema-col schema-name-cell">
                    <input
                      type="text"
                      className="schema-input"
                      value={r.newName ?? ''}
                      placeholder={`新${r.title.trim() || '項目'}`}
                      onChange={(e) => patch(r.key, { newName: e.target.value })}
                    />
                  </span>
                  <span className="schema-memory">
                    {!locked && (
                      <input
                        type="checkbox"
                        checked={!!r.memory}
                        title="這個區塊的卡片有「記憶」"
                        onChange={(e) => patch(r.key, { memory: e.target.checked })}
                      />
                    )}
                  </span>
                  {locked ? (
                    <span className="schema-del" />
                  ) : (
                    <button type="button" className="schema-del" title="刪除這個區塊" onClick={() => askRemove(r)}>
                      <Icon icon="close" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <button type="button" className="schema-add" onClick={add}>
            ＋ 新增區塊
          </button>
          {error && <div className="schema-error">{error}</div>}
        </div>

        <div className="schema-footer">
          <button type="button" className="schema-btn" onClick={onClose}>
            取消
          </button>
          <button type="button" className="schema-btn schema-btn-primary" disabled={!!error} onClick={save}>
            儲存
          </button>
        </div>
      </div>

      {picker && pickerRow && (
        <IconPicker
          x={picker.x}
          y={picker.y}
          icon={pickerRow.icon}
          color={pickerRow.color}
          allowNone={false}
          extraIcons={[
            ['terminal', '指令'],
            ['files', '檔案'],
          ]}
          onChange={(p) => patch(pickerRow.key, { ...(p.icon !== undefined && { icon: p.icon }), ...('color' in p && { color: p.color }) })}
          onClose={() => setPicker(null)}
        />
      )}

      {/* 刪除區塊的確認：資料夾要不要一起刪（按「儲存」才真的做） */}
      {confirmDel && (
        <div
          className="close-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setConfirmDel(null);
          }}
        >
          <div className="close-panel schema-confirm" role="dialog" aria-label="刪除區塊">
            <div className="close-message">
              要刪除區塊「{confirmDel.row.title}」嗎？
              <div className="schema-confirm-detail">
                這個區塊目前有 {confirmDel.count} 張卡，放在專案的「{confirmDel.row.dir}」資料夾。
              </div>
            </div>
            <div className="schema-confirm-options">
              <button
                type="button"
                className="schema-confirm-option"
                autoFocus
                onClick={() => {
                  removeRow(confirmDel.row, false);
                  setConfirmDel(null);
                }}
              >
                <b>只是不在編輯器裡顯示</b>
                <span>資料夾和卡片都留在硬碟上；之後新增同名的區塊，就會再讀回來。</span>
              </button>
              <button
                type="button"
                className="schema-confirm-option danger"
                onClick={() => {
                  removeRow(confirmDel.row, true);
                  setConfirmDel(null);
                }}
              >
                <b>連資料夾一起刪掉</b>
                <span>{confirmDel.count > 0 ? `${confirmDel.count} 張卡會一起刪除，不能復原。` : '資料夾裡沒有卡片。'}</span>
              </button>
            </div>
            <div className="close-buttons">
              <button type="button" className="close-btn" onClick={() => setConfirmDel(null)}>
                取消
              </button>
            </div>
            <div className="schema-confirm-note">選完要按區塊設定的「儲存」才會真的改；按「取消」關掉區塊設定就什麼都不會變。</div>
          </div>
        </div>
      )}
    </div>
  );
}
