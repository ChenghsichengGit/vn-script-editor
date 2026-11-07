import { useEffect, useMemo, useRef, useState } from 'react';
import type { Card, FieldRemoval, SchemaEdit, SectionSchema } from '../model';
import ContextMenu, { ContextMenuItem } from './ContextMenu';
import SuggestInput from './SuggestInput';
import Icon, { IconDef } from './Icon';
import { definedParams, usedParams } from '../scriptLanguage';
import { fieldIconDef } from '../fieldIcons';
import IconPicker, { pickerPosition } from './IconPicker';
import { dragWith } from '../App';
import './SchemaDialog.css';

// 編輯中的一列：from 記住原本的欄位名稱（新增的列沒有），讓呼叫端能替已有的卡改名
interface Row {
  id: number; // 只用來當 React key，不會存出去
  name: string;
  param: string;
  icon?: string;
  color?: string;
  type?: 'image'; // 沒有 = 文字
  from?: string;
}

// 指令參數不能有空白或 [ ] | / #，否則指令格式會解析錯
const BAD_PARAM = /[\s[\]|/#]/;

const HELP =
  '這個區塊的每張卡都一定會有這些欄位：新增的卡會自動帶上，按「儲存」時已有的卡缺的欄位也會補上空白欄位。\n' +
  '「類型」：文字或圖片。圖片欄位放一張圖（選擇、貼上或拖進來），圖檔存在專案的「圖片」資料夾。\n' +
  '「指令參數」：例如填「名字」，指令格式 #name [名字] 就能從所有卡的這個欄位（或名稱）裡選。\n' +
  '從範本刪掉的欄位不會從已有的卡上移除，只是不再強制。';

// 區塊的「欄位設定」：最上面固定一列「名稱」（只能設參數），下面是可以增刪排序的範本欄位
// 每列：握把（按住上下拖曳排序）、圖示（點了選圖示和顏色）、欄位名稱、指令參數、右邊的 × 刪除
export default function SchemaDialog({
  title,
  icon,
  schema,
  specialFields,
  cards,
  onSave,
  onClose,
}: {
  title: string;
  icon: IconDef; // 區塊的圖示，放在「名稱」那一列
  schema: SectionSchema;
  specialFields: { name: string; description: string }[]; // 這個區塊有特別用途的欄位名稱（指令的「用法」「說明」），新增時可以直接選
  cards: Card[]; // 這個區塊所有的卡：刪欄位時算有幾張卡有填、幾張是空的

  // removals = 被刪掉的欄位要不要連卡片上的一起刪（按「儲存」才真的做）
  onSave: (nameParam: string, fields: SchemaEdit[], removals: FieldRemoval[]) => void;
  onClose: () => void;
}) {
  // 本地副本：按「儲存」前都不會影響外面
  const [nameParam, setNameParam] = useState(schema.nameParam ?? '');
  const [rows, setRows] = useState<Row[]>(() =>
    schema.fields.map((f, i) => ({ id: i, name: f.key, param: f.param ?? '', icon: f.icon, color: f.color, type: f.type, from: f.key })),
  );
  const [nextId, setNextId] = useState(schema.fields.length);
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  // 圖示選擇面板：哪一列、出現在哪裡
  const [picker, setPicker] = useState<{ id: number; x: number; y: number } | null>(null);
  // 正在拖曳排序的那一列
  const [dragging, setDragging] = useState<number | null>(null);
  const rowEls = useRef(new Map<number, HTMLDivElement>());

  // 刪欄位：問卡片上已經有的要怎麼處理（row = 要刪的那一列，filled／empty = 有填／沒填內容的卡數）
  const [confirmDel, setConfirmDel] = useState<{ row: Row; filled: number; empty: number } | null>(null);
  const [removals, setRemovals] = useState<FieldRemoval[]>([]);

  // Esc：先關最上層的東西（刪除確認、圖示面板），都沒有才關掉整個視窗
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

  const patch = (id: number, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));

  // 把這一列從範本拿掉；mode = 卡片上的欄位要不要一起刪（沒給 = 卡片上的保留）
  const removeRow = (row: Row, mode?: FieldRemoval['mode']) => {
    setRows((rs) => rs.filter((x) => x.id !== row.id));
    if (picker?.id === row.id) setPicker(null);
    if (mode && row.from !== undefined) setRemovals((list) => [...list.filter((x) => x.key !== row.from), { key: row.from!, mode }]);
  };
  // 按 ×：剛新增還沒存過的欄位，或沒有任何卡有這個欄位，直接刪；不然先問
  const askRemove = (row: Row) => {
    const key = row.from;
    const having = key === undefined ? [] : cards.flatMap((c) => c.fields.filter((f) => f.key === key));
    if (having.length === 0) return removeRow(row);
    const filled = having.filter((f) => f.value.trim() !== '').length;
    setConfirmDel({ row, filled, empty: having.length - filled });
  };

  const add = (name: string) => {
    setRows((rs) => [...rs, { id: nextId, name, param: '' }]);
    setNextId(nextId + 1);
  };

  // 按住握把上下拖：滑鼠經過別列的中線，就把這一列換到那個位置（其他列即時讓位）
  const startDrag = (id: number, e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(id);
    dragWith(
      (ev) => {
        setRows((rs) => {
          const others = rs.filter((r) => r.id !== id);
          // 插入位置 = 中線在滑鼠下方的第一列（其他列都在上面就放最後）
          let at = others.findIndex((r) => {
            const box = rowEls.current.get(r.id)?.getBoundingClientRect();
            return box ? ev.clientY < box.top + box.height / 2 : false;
          });
          if (at < 0) at = others.length;
          if (rs.findIndex((r) => r.id === id) === at) return rs;
          const next = [...others];
          next.splice(at, 0, rs.find((r) => r.id === id)!);
          return next;
        });
      },
      () => setDragging(null),
    );
  };

  // 指令參數輸入框的選項：所有指令格式裡用到的 [參數]；已經在欄位設定裡設過的標「已設定」
  const paramSuggest = (value: string) => {
    const typing = value.trim();
    const defined = definedParams();
    const here = new Set([nameParam, ...rows.map((r) => r.param)].map((p) => p.trim()));
    const items = [...usedParams()]
      .filter(([name]) => name.includes(typing) && name !== typing)
      .map(([name, cmds]) => ({
        label: name,
        detail: (defined.has(name) || here.has(name) ? '已設定・' : '') + `用在 ${cmds.join('、')}`,
        insert: name,
      }));
    return { items, from: 0, to: value.length };
  };

  const specialOf = (name: string) => specialFields.find((f) => f.name === name.trim())?.description;

  // 「＋ 新增欄位」：有專用名稱的區塊先跳選單（已經有的變灰），其他直接加一個空白欄位
  const openAddMenu = (e: React.MouseEvent) => {
    if (specialFields.length === 0) return add('');
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({
      x: box.left,
      y: box.bottom + 2,
      items: [
        ...specialFields.map((f) => ({ label: f.name, disabled: rows.some((r) => r.name.trim() === f.name), onClick: () => add(f.name) })),
        { label: '自訂欄位', onClick: () => add('') },
      ],
    });
  };

  // 圖示面板出現在圖示按鈕正下方（放不下就往上）
  const openPicker = (id: number, e: React.MouseEvent) => {
    const at = pickerPosition(e.currentTarget as HTMLElement);
    setPicker((p) => (p?.id === id ? null : { id, ...at }));
  };
  const pickerRow = picker ? rows.find((r) => r.id === picker.id) : undefined;

  // 驗證：回傳第一個遇到的錯誤訊息，沒有錯就是 null
  const error = useMemo(() => {
    const names = new Set<string>();
    const params = new Set<string>();
    const checkParam = (raw: string) => {
      const param = raw.trim();
      if (!param) return null;
      if (BAD_PARAM.test(param)) return '指令參數不能有空白或 [ ] | / # 符號';
      if (params.has(param)) return `指令參數「${param}」重複了`;
      params.add(param);
      return null;
    };
    const nameErr = checkParam(nameParam);
    if (nameErr) return nameErr;
    for (const r of rows) {
      const name = r.name.trim();
      if (!name) return '欄位名稱不能是空白';
      if (names.has(name)) return `欄位名稱「${name}」重複了`;
      names.add(name);
      const err = checkParam(r.param);
      if (err) return err;
    }
    return null;
  }, [rows, nameParam]);

  const save = () => {
    if (error) return;
    // 去掉前後空白；參數、圖示、顏色沒設就不帶
    const out: SchemaEdit[] = rows.map((r) => {
      const param = r.param.trim();
      const edit: SchemaEdit = { key: r.name.trim() };
      if (param) edit.param = param;
      if (r.icon) edit.icon = r.icon;
      if (r.icon && r.color) edit.color = r.color;
      if (r.type) edit.type = r.type;
      if (r.from !== undefined) edit.from = r.from;
      return edit;
    });
    onSave(nameParam.trim(), out, removals);
    onClose();
  };

  return (
    // 只有直接點在背景上才關閉（點到面板內不算）
    <div
      className="schema-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="schema-panel" spellCheck={false} role="dialog" aria-label={`${title}的欄位設定`}>
        <div className="schema-header">
          <span className="schema-title">
            {title}的欄位設定
            <span className="schema-help" title={HELP}>
              ⓘ
            </span>
          </span>
          <button type="button" className="schema-close" onClick={onClose} title="關閉">
            ×
          </button>
        </div>

        <div className="schema-body">
          <div className="schema-note">每張卡都一定會有這些欄位；填了指令參數，劇本指令就能選它的內容。按住左邊的 ⋮⋮ 可以上下拖曳排序。</div>

          <div className="schema-table">
            <div className="schema-row schema-head">
              <span className="schema-grip" />
              <span className="schema-icon" />
              <span className="schema-col">欄位名稱</span>
              <span className="schema-type">類型</span>
              <span className="schema-col">指令參數</span>
              <span className="schema-del" />
            </div>

            {/* 固定的「名稱」列：卡片名稱本身，不能改名、移動或刪除，只能設參數 */}
            <div className="schema-row">
              <span className="schema-grip" />
              <span className="schema-icon" title="名稱這一列不能移動或刪除">
                <Icon icon={icon} />
              </span>
              {/* 內距加在裡面那層：加在欄位本身會被算進平分的欄寬，右邊的參數格就對不齊 */}
              <span className="schema-col">
                <span className="schema-fixed">名稱</span>
              </span>
              <span className="schema-type" />
              <span className="schema-col schema-name-cell">
                <SuggestInput
                  type="text"
                  className="schema-input"
                  value={nameParam}
                  placeholder="（不當參數）"
                  openOnFocus
                  suggest={paramSuggest}
                  onChange={setNameParam}
                />
              </span>
              <span className="schema-del" />
            </div>

            {rows.map((r) => {
              const def = fieldIconDef(r);
              return (
                <div
                  className={`schema-row${dragging === r.id ? ' dragging' : ''}`}
                  key={r.id}
                  title={specialOf(r.name)}
                  ref={(el) => {
                    if (el) rowEls.current.set(r.id, el);
                    else rowEls.current.delete(r.id);
                  }}
                >
                  <span className="schema-grip" title="按住上下拖曳排序" onMouseDown={(e) => startDrag(r.id, e)}>
                    <Icon icon="gripper" />
                  </span>
                  <button
                    type="button"
                    className={`schema-icon schema-icon-btn${def ? '' : ' no-icon'}${picker?.id === r.id ? ' open' : ''}`}
                    title="選擇圖示和顏色"
                    onClick={(e) => openPicker(r.id, e)}
                  >
                    {def && <Icon icon={def} />}
                  </button>
                  <span className="schema-col schema-name-cell">
                    <input
                      type="text"
                      className="schema-input"
                      value={r.name}
                      placeholder="欄位名稱"
                      onChange={(e) => patch(r.id, { name: e.target.value })}
                    />
                    {specialOf(r.name) && <Icon icon="sparkle" className="field-special" />}
                  </span>
                  {/* 欄位類型：點一下在「文字」和「圖片」之間切換 */}
                  <button
                    type="button"
                    className={`schema-type schema-type-btn${r.type === 'image' ? ' image' : ''}`}
                    title="點一下切換：文字欄位／圖片欄位（圖片欄位放一張圖，存在專案的「圖片」資料夾）"
                    onClick={() => patch(r.id, { type: r.type === 'image' ? undefined : 'image' })}
                  >
                    {r.type === 'image' ? '圖片' : '文字'}
                  </button>
                  <span className="schema-col schema-name-cell">
                    <SuggestInput
                      type="text"
                      className="schema-input"
                      value={r.param}
                      placeholder="（不當參數）"
                      openOnFocus
                      suggest={paramSuggest}
                      onChange={(param) => patch(r.id, { param })}
                    />
                  </span>
                  <button
                    type="button"
                    className="schema-del"
                    title="刪除這個欄位"
                    onClick={() => askRemove(r)}
                  >
                    <Icon icon="close" />
                  </button>
                </div>
              );
            })}
          </div>

          <button type="button" className="schema-add" onClick={openAddMenu}>
            ＋ 新增欄位
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

      {/* 圖示選擇面板 */}
      {picker && pickerRow && (
        <IconPicker
          x={picker.x}
          y={picker.y}
          icon={pickerRow.icon}
          color={pickerRow.color}
          allowNone
          onChange={(p) => patch(pickerRow.id, p)}
          onClose={() => setPicker(null)}
        />
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}

      {/* 刪欄位的確認：卡片上已經有的這個欄位要怎麼處理（按「儲存」才真的改卡片） */}
      {confirmDel && (
        <div
          className="close-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setConfirmDel(null);
          }}
        >
          <div className="close-panel schema-confirm" role="dialog" aria-label="刪除欄位">
            <div className="close-message">
              要刪除欄位「{confirmDel.row.from}」嗎？
              <div className="schema-confirm-detail">
                共有 {confirmDel.filled + confirmDel.empty} 張卡有這個欄位：{confirmDel.filled} 張有填內容，{confirmDel.empty} 張是空的。
              </div>
            </div>
            <div className="schema-confirm-options">
              <button type="button" className="schema-confirm-option" autoFocus onClick={() => { removeRow(confirmDel.row); setConfirmDel(null); }}>
                <b>只從範本移除</b>
                <span>卡片上的欄位全部保留，只是不再強制每張卡都要有。</span>
              </button>
              <button
                type="button"
                className="schema-confirm-option"
                disabled={confirmDel.empty === 0}
                onClick={() => { removeRow(confirmDel.row, 'empty'); setConfirmDel(null); }}
              >
                <b>移除，並刪掉沒填內容的</b>
                <span>{confirmDel.empty === 0 ? '每張卡都有填內容，沒有可以刪的。' : `空的 ${confirmDel.empty} 張卡拿掉這個欄位，有填內容的保留。`}</span>
              </button>
              <button type="button" className="schema-confirm-option danger" onClick={() => { removeRow(confirmDel.row, 'all'); setConfirmDel(null); }}>
                <b>移除，並從所有卡片刪掉</b>
                <span>{confirmDel.filled > 0 ? `${confirmDel.filled} 張卡已填的內容也會一起刪除，不能復原。` : '每張卡的這個欄位都是空的。'}</span>
              </button>
            </div>
            <div className="close-buttons">
              <button type="button" className="close-btn" onClick={() => setConfirmDel(null)}>
                取消
              </button>
            </div>
            <div className="schema-confirm-note">選完要按欄位設定的「儲存」才會真的改卡片；按「取消」關掉欄位設定就什麼都不會變。</div>
          </div>
        </div>
      )}
    </div>
  );
}
