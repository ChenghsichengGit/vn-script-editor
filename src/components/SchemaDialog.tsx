import { useEffect, useMemo, useState } from 'react';
import type { SchemaEdit, SchemaField } from '../model';
import './SchemaDialog.css';

// 編輯中的一列：from 記住原本的欄位名稱（新增的列沒有），讓呼叫端能替已有的卡改名
interface Row {
  id: number; // 只用來當 React key，不會存出去
  name: string;
  param: string;
  from?: string;
}

// 指令參數不能有空白或 [ ] | #，否則指令格式會解析錯
const BAD_PARAM = /[\s[\]|#]/;

export default function SchemaDialog({
  title,
  fields,
  onSave,
  onClose,
}: {
  title: string;
  fields: SchemaField[];
  onSave: (fields: SchemaEdit[]) => void;
  onClose: () => void;
}) {
  // 本地副本：按「儲存」前都不會影響外面
  const [rows, setRows] = useState<Row[]>(() =>
    fields.map((f, i) => ({ id: i, name: f.key, param: f.param ?? '', from: f.key })),
  );
  const [nextId, setNextId] = useState(fields.length);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const patch = (id: number, p: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));

  const move = (idx: number, dir: -1 | 1) =>
    setRows((rs) => {
      const to = idx + dir;
      if (to < 0 || to >= rs.length) return rs;
      const next = [...rs];
      [next[idx], next[to]] = [next[to], next[idx]];
      return next;
    });

  const add = () => {
    setRows((rs) => [...rs, { id: nextId, name: '', param: '' }]);
    setNextId(nextId + 1);
  };

  // 驗證：回傳第一個遇到的錯誤訊息，沒有錯就是 null
  const error = useMemo(() => {
    const names = new Set<string>();
    const params = new Set<string>();
    for (const r of rows) {
      const name = r.name.trim();
      const param = r.param.trim();
      if (!name) return '欄位名稱不能是空白';
      if (names.has(name)) return `欄位名稱「${name}」重複了`;
      names.add(name);
      if (param) {
        if (BAD_PARAM.test(param)) return '指令參數不能有空白或 [ ] | # 符號';
        if (params.has(param)) return `指令參數「${param}」重複了`;
        params.add(param);
      }
    }
    return null;
  }, [rows]);

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
    onSave(out);
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
          <span className="schema-title">{`${title}的欄位設定`}</span>
          <button type="button" className="schema-close" onClick={onClose} title="關閉">
            ×
          </button>
        </div>

        <div className="schema-body">
          <div className="schema-note">
            這個區塊的每張卡都一定會有下面這些欄位。新增的卡會自動帶上；按「儲存」時，已經存在的卡缺少的欄位也會補上空白欄位。
          </div>
          <div className="schema-note">
            填了「指令參數」的欄位，內容可以在劇本指令裡選，例如參數填「名字」，指令格式 #name [名字] 就能選所有卡的這個欄位。
          </div>

          <div className="schema-head">
            <span className="schema-col-name">欄位名稱</span>
            <span className="schema-col-param">指令參數</span>
          </div>

          {rows.map((r, i) => (
            <div className="schema-row" key={r.id}>
              <input
                type="text"
                className="schema-input schema-col-name"
                value={r.name}
                placeholder="欄位名稱"
                onChange={(e) => patch(r.id, { name: e.target.value })}
              />
              <input
                type="text"
                className="schema-input schema-col-param"
                value={r.param}
                placeholder="指令參數（可不填）"
                onChange={(e) => patch(r.id, { param: e.target.value })}
              />
              <button
                type="button"
                className="schema-icon-btn"
                title="上移"
                disabled={i === 0}
                onClick={() => move(i, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="schema-icon-btn"
                title="下移"
                disabled={i === rows.length - 1}
                onClick={() => move(i, 1)}
              >
                ↓
              </button>
              <button
                type="button"
                className="schema-icon-btn schema-del"
                title="刪除欄位"
                onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}
              >
                ×
              </button>
            </div>
          ))}

          <button type="button" className="schema-add" onClick={add}>
            ＋ 新增欄位
          </button>

          {error && <div className="schema-error">{error}</div>}
        </div>

        <div className="schema-footer">
          <span className="schema-footer-note">刪掉的欄位不會從已有的卡上移除，只是不再強制。</span>
          <div className="schema-footer-btns">
            <button type="button" className="schema-btn" onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              className="schema-btn schema-btn-primary"
              disabled={!!error}
              onClick={save}
            >
              儲存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
