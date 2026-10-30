import { useEffect, useMemo, useState } from 'react';
import type { SchemaEdit, SectionSchema } from '../model';
import ContextMenu, { ContextMenuItem } from './ContextMenu';
import SuggestInput from './SuggestInput';
import { definedParams, usedParams } from '../scriptLanguage';
import './SchemaDialog.css';

// 編輯中的一列：from 記住原本的欄位名稱（新增的列沒有），讓呼叫端能替已有的卡改名
interface Row {
  id: number; // 只用來當 React key，不會存出去
  name: string;
  param: string;
  from?: string;
}

// 指令參數不能有空白或 [ ] | / #，否則指令格式會解析錯
const BAD_PARAM = /[\s[\]|/#]/;

const HELP =
  '這個區塊的每張卡都一定會有這些欄位：新增的卡會自動帶上，按「儲存」時已有的卡缺的欄位也會補上空白欄位。\n' +
  '「指令參數」：例如填「名字」，指令格式 #name [名字] 就能從所有卡的這個欄位（或名稱）裡選。\n' +
  '從範本刪掉的欄位不會從已有的卡上移除，只是不再強制。';

// 區塊的「欄位設定」：最上面固定一列「名稱」（只能設參數），下面是可以增刪排序的範本欄位
// 每列前面的圖示按下去（或在那一列按右鍵）會出現選單：上移、下移、刪除
export default function SchemaDialog({
  title,
  icon,
  schema,
  specialFields,
  onSave,
  onClose,
}: {
  title: string;
  icon: string; // 區塊的圖示，放在「名稱」那一列
  schema: SectionSchema;
  specialFields: { name: string; description: string }[]; // 這個區塊有特別用途的欄位名稱（指令的「用法」「說明」），新增時可以直接選

  onSave: (nameParam: string, fields: SchemaEdit[]) => void;
  onClose: () => void;
}) {
  // 本地副本：按「儲存」前都不會影響外面
  const [nameParam, setNameParam] = useState(schema.nameParam ?? '');
  const [rows, setRows] = useState<Row[]>(() =>
    schema.fields.map((f, i) => ({ id: i, name: f.key, param: f.param ?? '', from: f.key })),
  );
  const [nextId, setNextId] = useState(schema.fields.length);
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const patch = (id: number, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));

  const move = (idx: number, dir: -1 | 1) =>
    setRows((rs) => {
      const to = idx + dir;
      if (to < 0 || to >= rs.length) return rs;
      const next = [...rs];
      [next[idx], next[to]] = [next[to], next[idx]];
      return next;
    });

  const add = (name: string) => {
    setRows((rs) => [...rs, { id: nextId, name, param: '' }]);
    setNextId(nextId + 1);
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

  // 選單出現在圖示正下方（按圖示）或滑鼠位置（按右鍵）；index = null 是「名稱」那一列，全部不能用
  const openMenu = (e: React.MouseEvent, index: number | null) => {
    e.preventDefault();
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const at = e.type === 'contextmenu' ? { x: e.clientX, y: e.clientY } : { x: box.left, y: box.bottom + 2 };
    const locked = index === null;
    setMenu({
      ...at,
      items: [
        { label: '上移', disabled: locked || index === 0, onClick: () => move(index!, -1) },
        { label: '下移', disabled: locked || index === rows.length - 1, onClick: () => move(index!, 1) },
        { label: '刪除', disabled: locked, onClick: () => setRows((rs) => rs.filter((_, i) => i !== index)) },
      ],
    });
  };

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
    // 去掉前後空白；參數是空的就不帶 param
    const out: SchemaEdit[] = rows.map((r) => {
      const param = r.param.trim();
      const edit: SchemaEdit = { key: r.name.trim() };
      if (param) edit.param = param;
      if (r.from !== undefined) edit.from = r.from;
      return edit;
    });
    onSave(nameParam.trim(), out);
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
      <div className="schema-panel" role="dialog" aria-label={`${title}的欄位設定`}>
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
          <div className="schema-note">每張卡都一定會有這些欄位；填了指令參數，劇本指令就能選它的內容。</div>

          <div className="schema-table">
            <div className="schema-row schema-head">
              <span className="schema-icon" />
              <span className="schema-col">欄位名稱</span>
              <span className="schema-col">指令參數</span>
            </div>

            {/* 固定的「名稱」列：卡片名稱本身，不能改名、移動或刪除，只能設參數 */}
            <div className="schema-row" onContextMenu={(e) => openMenu(e, null)}>
              <button type="button" className="schema-icon" title="名稱這一列不能移動或刪除" onClick={(e) => openMenu(e, null)}>
                {icon}
              </button>
              <span className="schema-col schema-fixed">名稱</span>
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
            </div>

            {rows.map((r, i) => (
              <div className="schema-row" key={r.id} title={specialOf(r.name)} onContextMenu={(e) => openMenu(e, i)}>
                <button type="button" className="schema-icon" title="上移、下移、刪除" onClick={(e) => openMenu(e, i)}>
                  {/* 加 ️ 才會畫成彩色圖示，不然在深色背景上看不到 */}
                  {'🏷️'}
                </button>
                <span className="schema-col schema-name-cell">
                  <input
                    type="text"
                    className="schema-input"
                    value={r.name}
                    placeholder="欄位名稱"
                    onChange={(e) => patch(r.id, { name: e.target.value })}
                  />
                  {specialOf(r.name) && <span className="field-special">✦</span>}
                </span>
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
              </div>
            ))}
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
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}
