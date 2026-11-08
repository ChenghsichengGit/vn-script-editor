import { useId, useRef, useState } from 'react';
import { MEMORY_KINDS, Memory, MemoryKind } from '../model';
import { clearFieldMark } from '../changeMarks';
import { cutOptions, memoriesUntil, memoryMarkKey, relations, sourceLabel } from '../memories';
import { dragWith, reorderAt } from '../hooks';
import Icon, { IconDef } from './Icon';

export interface MemoryLinks {
  targetNames: string[];
  scripts: { path: string; label: string }[];
  hasTarget: (name: string) => boolean;
  targetIcon: (name: string) => IconDef | undefined; // 對象那張卡所在區塊的圖示
  onOpenTarget: (name: string) => void;
  onOpenSource: (path: string) => void;
}

export function MemoryRelations({ list, targetIcon, onOpenTarget, onOpenSource }: {
  list: Memory[];
  targetIcon: (name: string) => IconDef | undefined;
  onOpenTarget: (name: string) => void;
  onOpenSource: (path: string) => void;
}) {
  const rels = relations(list);
  return (
    <div className="memory-relations">
      <div className="memory-rel-row memory-rel-head">
        <span>對象</span>
        <span>稱呼</span>
        <span>印象</span>
        <span>認識於</span>
      </div>
      {rels.map((r) => {
        const icon = targetIcon(r.target);
        return (
          <div key={r.target} className="memory-rel-row">
            <span>
              {icon ? (
                <button type="button" className="memory-link" title={`打開「${r.target}」`} onClick={() => onOpenTarget(r.target)}>
                  <Icon icon={icon} /> {r.target}
                </button>
              ) : (
                <span className="memory-dim">{r.target}</span>
              )}
            </span>
            <span>{r.name?.text || <span className="memory-dim">—</span>}</span>
            <span>{r.impression?.text || <span className="memory-dim">—</span>}</span>
            <span className="memory-first">
              {r.first.time && <span>{r.first.time}</span>}
              {r.first.source && (
                <button type="button" className="memory-link" title={`打開劇本「${r.first.source}」`} onClick={() => onOpenSource(r.first.source)}>
                  <Icon icon="file" /> {sourceLabel(r.first.source)}
                </button>
              )}
            </span>
          </div>
        );
      })}
      {rels.length === 0 && <div className="memory-note">還沒有填了「對象」的記憶。</div>}
    </div>
  );
}

export default function MemoryPanel({
  memories,
  markKey,
  changed,
  targetNames,
  scripts,
  hasTarget,
  targetIcon,
  onOpenTarget,
  onOpenSource,
  onChange,
}: {
  memories: Memory[];
  markKey: string; // 這張卡的分頁 id（「外部修改」標記記在這底下）
  changed: string[]; // 被外部改過的欄位標記（記憶的是 memoryMarkKey）
  targetNames: string[]; // 「對象」可以選的卡片名稱
  scripts: { path: string; label: string }[]; // 「出處」可以選的劇本
  hasTarget: (name: string) => boolean; // 對象有沒有對應的卡（有才畫成可以點的）
  targetIcon: (name: string) => IconDef | undefined;
  onOpenTarget: (name: string) => void;
  onOpenSource: (path: string) => void;
  onChange: (next: Memory[]) => void;
}) {
  const [view, setView] = useState<'timeline' | 'relations'>('timeline');
  const [cut, setCut] = useState('');
  const [dragging, setDragging] = useState<number | null>(null);
  const rowEls = useRef(new Map<number, HTMLDivElement>());
  const listId = useId();
  const cuts = cutOptions(memories);
  const activeCut = cuts.includes(cut) ? cut : '';
  const shown = memoriesUntil(memories, activeCut);
  const hidden = memories.length - shown.length;
  const setRow = (i: number, patch: Partial<Memory>) => {
    clearFieldMark(markKey, memoryMarkKey(memories[i])); // 自己改了這一筆：「外部修改」的標記拿掉
    onChange(memories.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  };
  const add = () => {
    const last = memories[memories.length - 1];
    onChange([...memories, { time: last?.time ?? '', target: '', kind: '事件', text: '', source: last?.source ?? '' }]);
  };
  const startDrag = (from: number, e: React.MouseEvent) => {
    e.preventDefault();
    const item = memories[from];
    let list = memories; // 畫面還沒重畫前，用自己記的最新順序
    setDragging(from);
    dragWith(
      (ev) => {
        const next = reorderAt(list, item, ev.clientY, (m) => rowEls.current.get(list.indexOf(m))?.getBoundingClientRect());
        if (next === list) return;
        list = next;
        setDragging(next.indexOf(item));
        onChange(next);
      },
      () => setDragging(null),
    );
  };
  return (
    <div className="memory-panel">
      <div className="memory-toolbar">
        <span className="memory-seg">
          <button type="button" className={view === 'timeline' ? 'on' : ''} onClick={() => setView('timeline')}>時間線</button>
          <button type="button" className={view === 'relations' ? 'on' : ''} onClick={() => setView('relations')}>關係表</button>
        </span>
        <label className="memory-cut" title="只看到這個劇本為止的記憶（清單由上往下算）">
          看到
          <select value={activeCut} onChange={(e) => setCut(e.target.value)}>
            <option value="">全部</option>
            {cuts.map((s) => (
              <option key={s} value={s}>{sourceLabel(s)}</option>
            ))}
          </select>
        </label>
      </div>
      {view === 'timeline' ? (
        <div className="memory-list">
          {shown.map((m, i) => (
            <div
              key={i}
              className={`memory-row${dragging === i ? ' dragging' : ''}${changed.includes(memoryMarkKey(m)) ? ' ext-changed' : ''}`}
              ref={(el) => {
                if (el) rowEls.current.set(i, el);
                else rowEls.current.delete(i);
              }}
            >
              <span className="memory-grip" title="按住上下拖曳，調整時間順序" onMouseDown={(e) => startDrag(i, e)}><Icon icon="gripper" /></span>
              <input className="memory-time" value={m.time} placeholder="時間" onChange={(e) => setRow(i, { time: e.target.value })} />
              <span className="memory-target">
                <input list={listId} value={m.target} placeholder="對象" onChange={(e) => setRow(i, { target: e.target.value })} />
                <button
                  type="button"
                  className="icon-btn"
                  title={`打開「${m.target}」`}
                  style={m.target.trim() && hasTarget(m.target) ? undefined : { visibility: 'hidden' }}
                  onClick={() => onOpenTarget(m.target)}
                >
                  <Icon icon="link-external" />
                </button>
              </span>
              <select className={`memory-kind kind-${MEMORY_KINDS.indexOf(m.kind)}`} value={m.kind} onChange={(e) => setRow(i, { kind: e.target.value as MemoryKind })}>
                {MEMORY_KINDS.map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
              <input className="memory-text" value={m.text} placeholder="內容" onChange={(e) => setRow(i, { text: e.target.value })} />
              <span className="memory-source">
                <select value={m.source} title={m.source || '出處（劇本）'} onChange={(e) => setRow(i, { source: e.target.value })}>
                  <option value="">（沒有出處）</option>
                  {m.source && !scripts.some((s) => s.path === m.source) && <option value={m.source}>{sourceLabel(m.source)}（找不到）</option>}
                  {scripts.map((s) => (
                    <option key={s.path} value={s.path}>{s.label}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="icon-btn"
                  title="打開這個劇本"
                  style={m.source && scripts.some((s) => s.path === m.source) ? undefined : { visibility: 'hidden' }}
                  onClick={() => onOpenSource(m.source)}
                >
                  <Icon icon="go-to-file" />
                </button>
              </span>
              <button type="button" className="icon-btn" title="刪除這筆記憶" onClick={() => onChange(memories.filter((_, j) => j !== i))}>×</button>
            </div>
          ))}
          {hidden > 0 && <div className="memory-note">（之後還有 {hidden} 筆，「看到」選「全部」才會顯示）</div>}
          <datalist id={listId}>
            {targetNames.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
          <button type="button" className="text-btn" onClick={add}>＋ 新增記憶</button>
        </div>
      ) : (
        <MemoryRelations list={shown} targetIcon={targetIcon} onOpenTarget={onOpenTarget} onOpenSource={onOpenSource} />
      )}
    </div>
  );
}
