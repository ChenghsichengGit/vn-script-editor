import { useState } from 'react';
import { Card, CardSectionId, MEMORY_KINDS, Memory, cardTabId } from '../model';
import { cutOptions, findTargetCard, memoriesUntil, scriptPath, sourceLabel, targetIcon } from '../memories';
import { sectionDef } from '../sections';
import { MemoryRelations } from './MemoryPanel';
import { showCardMemory } from './CardEditor';
import Icon from './Icon';
import { eventChannel, useEscape } from '../hooks';

interface At {
  section: CardSectionId;
  id: string;
}

const channel = eventChannel<At>('vn-open-memory');
export const openMemoryViewer = (section: CardSectionId, id: string) => channel.open({ section, id });

let lastView: 'timeline' | 'relations' = 'timeline'; // 上次看的是哪一邊（下次打開沿用）

export default function MemoryViewerHost({ cards, files, openTab }: {
  cards: Record<CardSectionId, Card[]>;
  files: Record<string, { name: string; folder: string }>;
  openTab: (tabId: string) => void;
}) {
  const [at, setAt] = channel.useValue();
  const card = at && cards[at.section]?.find((c) => c.id === at.id);
  if (!at || !card) return null;
  return <MemoryViewer key={`${at.section}:${at.id}`} section={at.section} card={card} cards={cards} files={files} openTab={openTab} onGo={setAt} onClose={() => setAt(null)} />;
}

function MemoryViewer({ section, card, cards, files, openTab, onGo, onClose }: {
  section: CardSectionId;
  card: Card;
  cards: Record<CardSectionId, Card[]>;
  files: Record<string, { name: string; folder: string }>;
  openTab: (tabId: string) => void;
  onGo: (at: At) => void;
  onClose: () => void;
}) {
  const [view, setViewState] = useState(lastView);
  const setView = (v: typeof view) => {
    lastView = v;
    setViewState(v);
  };
  const [cut, setCut] = useState('');
  useEscape(onClose);
  const memories = card.memories ?? [];
  const cuts = cutOptions(memories);
  const activeCut = cuts.includes(cut) ? cut : '';
  const shown = memoriesUntil(memories, activeCut);
  const hidden = memories.length - shown.length;
  const iconOf = (name: string) => targetIcon(cards, name, section);
  const openTarget = (name: string) => {
    const hit = findTargetCard(cards, name, section);
    if (!hit) return;
    if (sectionDef(hit.section)?.memory) onGo({ section: hit.section, id: hit.card.id });
    else {
      openTab(cardTabId(hit.section, hit.card.id));
      onClose();
    }
  };
  const fileId = (path: string) => Object.keys(files).find((k) => scriptPath(files[k]) === path);
  const openSource = (path: string) => {
    const id = fileId(path);
    if (!id) return;
    openTab(id);
    onClose();
  };
  const edit = () => {
    const tabId = cardTabId(section, card.id);
    showCardMemory(tabId);
    openTab(tabId);
    onClose();
  };
  type Item = { kind: 'source'; source: string } | { kind: 'memory'; m: Memory };
  const items: Item[] = [];
  shown.forEach((m, i) => {
    if (i === 0 || m.source !== shown[i - 1].source) items.push({ kind: 'source', source: m.source });
    items.push({ kind: 'memory', m });
  });
  return (
    <div className="memory-viewer" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="memory-viewer-box">
        <div className="memory-viewer-head">
          <span className="memory-viewer-title">{card.name} 的記憶</span>
          <span className="memory-seg">
            <button type="button" className={view === 'timeline' ? 'on' : ''} onClick={() => setView('timeline')}>時間線</button>
            <button type="button" className={view === 'relations' ? 'on' : ''} onClick={() => setView('relations')}>關係</button>
          </span>
          <span className="memory-viewer-spacer" />
          <label className="memory-cut" title="只看到這個劇本為止的記憶">
            看到
            <select value={activeCut} onChange={(e) => setCut(e.target.value)}>
              <option value="">全部</option>
              {cuts.map((s) => (
                <option key={s} value={s}>{sourceLabel(s)}</option>
              ))}
            </select>
          </label>
          <button type="button" className="icon-btn" title="在分頁中編輯記憶" onClick={edit}><Icon icon="edit" /></button>
          <button type="button" className="icon-btn" title="關閉（Esc）" onClick={onClose}><Icon icon="close" /></button>
        </div>
        <div className="memory-viewer-body">
          {memories.length === 0 ? (
            <div className="memory-note">還沒有記憶，按右上角的鉛筆到卡片分頁新增。</div>
          ) : view === 'timeline' ? (
            <div className="memory-tl">
              {items.map((it, i) => {
                const pos = `${i === 0 ? ' first' : ''}${i === items.length - 1 ? ' last' : ''}`;
                if (it.kind === 'source') {
                  const found = !!it.source && !!fileId(it.source);
                  return (
                    <div key={i} className="memory-tl-row source">
                      <span className="memory-tl-left">
                        {!it.source ? (
                          <span className="memory-dim">（沒有出處）</span>
                        ) : found ? (
                          <button type="button" className="memory-link" title={`打開劇本「${it.source}」`} onClick={() => openSource(it.source)}>
                            {it.source.replace(/\.[^./]+$/, '')}
                          </button>
                        ) : (
                          <span className="memory-dim" title="找不到這個劇本">{it.source.replace(/\.[^./]+$/, '')}</span>
                        )}
                      </span>
                      <span className={`memory-tl-axis${pos}`}><span className="memory-tl-dot big" /></span>
                      <span />
                    </div>
                  );
                }
                const m = it.m;
                const kind = MEMORY_KINDS.indexOf(m.kind);
                const icon = m.target.trim() ? iconOf(m.target) : undefined;
                return (
                  <div key={i} className="memory-tl-row">
                    <span className="memory-tl-left memory-tl-time">{m.time}</span>
                    <span className={`memory-tl-axis${pos}`}><span className={`memory-tl-dot kind-${kind}`} /></span>
                    <span className="memory-tl-text">
                      <span className={`memory-tl-kind kind-${kind}`}>{m.kind}</span>
                      {m.target.trim() &&
                        (icon ? (
                          <button type="button" className="memory-link" title={`看「${m.target}」`} onClick={() => openTarget(m.target)}>
                            <Icon icon={icon} /> {m.target}
                          </button>
                        ) : (
                          <span>{m.target}</span>
                        ))}
                      {m.target.trim() && m.text && '：'}
                      <span>{m.text}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <MemoryRelations list={shown} targetIcon={iconOf} onOpenTarget={openTarget} onOpenSource={openSource} />
          )}
          {hidden > 0 && <div className="memory-note">（之後還有 {hidden} 筆，「看到」選「全部」才會顯示）</div>}
        </div>
      </div>
    </div>
  );
}
