// 卡片放大視窗：不用開分頁就能看資料（欄位、圖片、詳細內容），有記憶的區塊還能切到時間線、關係
import { useState } from 'react';
import { Card, CardSectionId, Field, MEMORY_KINDS, Memory, SchemaField, cardTabId } from '../model';
import { cutOptions, findTargetCard, memoriesUntil, relationSummary, relations, scriptPath, sourceLabel, targetIcon } from '../memories';
import { sectionDef, sectionMeta } from '../sections';
import { fieldIconDef } from '../fieldIcons';
import { MemoryRelations } from './MemoryPanel';
import { showCardMemory } from './CardEditor';
import { CardImage } from './CardItem';
import { RichTextView } from './RichTextEditor';
import FieldText from './FieldText';
import Icon, { IconDef } from './Icon';
import { eventChannel, useKeys } from '../hooks';

type View = 'data' | 'timeline' | 'relations';

interface At {
  section: CardSectionId;
  id: string;
  view?: View;
}

const channel = eventChannel<At>('vn-open-memory');
let lastMemView: 'timeline' | 'relations' = 'timeline'; // 上次看的是時間線還是關係（下次打開記憶沿用）
export const openMemoryViewer = (section: CardSectionId, id: string) => channel.open({ section, id, view: lastMemView });
export const openCardViewer = (section: CardSectionId, id: string) => channel.open({ section, id, view: 'data' });

export default function MemoryViewerHost({ cards, files, schemaFields, openTab }: {
  cards: Record<CardSectionId, Card[]>;
  files: Record<string, { name: string; folder: string }>;
  schemaFields: (section: CardSectionId) => SchemaField[];
  openTab: (tabId: string) => void;
}) {
  const [at, setAt] = channel.useValue();
  const card = at && cards[at.section]?.find((c) => c.id === at.id);
  if (!at || !card) return null;
  return (
    <MemoryViewer
      key={`${at.section}:${at.id}`}
      section={at.section}
      card={card}
      initialView={at.view ?? 'data'}
      cards={cards}
      files={files}
      schemaFields={schemaFields(at.section)}
      openTab={openTab}
      onGo={setAt}
      onClose={() => setAt(null)}
    />
  );
}

function MemoryViewer({ section, card, initialView, cards, files, schemaFields, openTab, onGo, onClose }: {
  section: CardSectionId;
  card: Card;
  initialView: View;
  cards: Record<CardSectionId, Card[]>;
  files: Record<string, { name: string; folder: string }>;
  schemaFields: SchemaField[];
  openTab: (tabId: string) => void;
  onGo: (at: At) => void;
  onClose: () => void;
}) {
  const hasMemory = !!sectionDef(section)?.memory;
  const [view, setViewState] = useState<View>(hasMemory ? initialView : 'data');
  const setView = (v: View) => {
    if (v !== 'data') lastMemView = v;
    setViewState(v);
  };
  const [cut, setCut] = useState('');
  // Esc：上面還開著看圖視窗時先讓它關
  useKeys((e) => e.key === 'Escape' && !document.querySelector('.image-viewer') && (onClose(), true), [onClose]);
  const memories = card.memories ?? [];
  const cuts = cutOptions(memories);
  const activeCut = cuts.includes(cut) ? cut : '';
  const shown = memoriesUntil(memories, activeCut);
  const hidden = memories.length - shown.length;
  const iconOf = (name: string) => targetIcon(cards, name, section);
  const openTarget = (name: string) => {
    const hit = findTargetCard(cards, name, section);
    if (!hit) return;
    onGo({ section: hit.section, id: hit.card.id, view: sectionDef(hit.section)?.memory ? view : 'data' });
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
    if (view !== 'data') showCardMemory(tabId);
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
      <div className={`memory-viewer-box${view === 'data' ? ' wide' : ''}`}>
        <div className="memory-viewer-head">
          <span className="memory-viewer-title">
            <Icon icon={sectionMeta(section).icon} /> {card.name || '（未命名）'}
          </span>
          {hasMemory && (
            <span className="memory-seg">
              <button type="button" className={view === 'data' ? 'on' : ''} onClick={() => setView('data')}>資料</button>
              <button type="button" className={view === 'timeline' ? 'on' : ''} onClick={() => setView('timeline')}>時間線</button>
              <button type="button" className={view === 'relations' ? 'on' : ''} onClick={() => setView('relations')}>關係</button>
            </span>
          )}
          <span className="memory-viewer-spacer" />
          {view !== 'data' && <label className="memory-cut" title="只看到這個劇本為止的記憶">
            看到
            <select value={activeCut} onChange={(e) => setCut(e.target.value)}>
              <option value="">全部</option>
              {cuts.map((s) => (
                <option key={s} value={s}>{sourceLabel(s)}</option>
              ))}
            </select>
          </label>}
          <button type="button" className="icon-btn" title={view === 'data' ? '在分頁中編輯' : '在分頁中編輯記憶'} onClick={edit}><Icon icon="edit" /></button>
          <button type="button" className="icon-btn" title="關閉（Esc）" onClick={onClose}><Icon icon="close" /></button>
        </div>
        <div className="memory-viewer-body">
          {view === 'data' ? (
            <CardData card={card} schemaFields={schemaFields} memories={hasMemory ? memories : null} targetIcon={iconOf} onRelations={() => setView('relations')} />
          ) : memories.length === 0 ? (
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
          {view !== 'data' && hidden > 0 && <div className="memory-note">（之後還有 {hidden} 筆，「看到」選「全部」才會顯示）</div>}
        </div>
      </div>
    </div>
  );
}

// 資料頁：左邊圖片欄位放大，右邊所有欄位（收合的也展開），下面詳細內容；有記憶的區塊附關係摘要
function CardData({ card, schemaFields, memories, targetIcon, onRelations }: {
  card: Card;
  schemaFields: SchemaField[];
  memories: Memory[] | null;
  targetIcon: (name: string) => IconDef | undefined;
  onRelations: () => void;
}) {
  const schemaOf = (f: Field) => schemaFields.find((s) => s.key === f.key);
  const isImage = (f: Field) => {
    const s = schemaOf(f);
    return (s ? s.type : f.type) === 'image';
  };
  const images = card.fields.filter((f) => isImage(f) && f.value.trim());
  const texts = card.fields.filter((f) => !isImage(f));
  const rels = memories ? relations(memories) : [];
  return (
    <div className="card-view">
      <div className="card-view-top">
        {images.length > 0 && (
          <div className="card-view-images">
            {images.map((f, i) => (
              <figure key={i}>
                <CardImage path={f.value.trim()} className="card-view-img" />
                <figcaption>{f.key}</figcaption>
              </figure>
            ))}
          </div>
        )}
        <div className="card-view-fields">
          {texts.length === 0 && <span className="memory-note">沒有欄位</span>}
          {texts.map((f, i) => {
            const icon = fieldIconDef(schemaOf(f));
            return (
              <div key={i} className="card-view-row">
                <span className="card-view-key">
                  {icon && <Icon icon={icon} className="field-icon" />}
                  {f.key || '（未命名）'}
                </span>
                {f.value.trim() ? <FieldText className="card-view-value" text={f.value} /> : <span className="card-view-value memory-dim">—</span>}
              </div>
            );
          })}
        </div>
      </div>
      {card.detail.trim() && (
        <section className="card-view-section">
          <div className="card-view-label">詳細內容</div>
          <RichTextView markdown={card.detail} />
        </section>
      )}
      {memories && (
        <section className="card-view-section">
          <div className="card-view-label">關係（記憶 {memories.length}）</div>
          {rels.length === 0 ? (
            <span className="memory-note">還沒有記憶</span>
          ) : (
            <div className="card-mem" title="點一下看關係" onClick={onRelations}>
              {rels.map((r) => {
                const icon = targetIcon(r.target);
                return (
                  <div key={r.target} className="card-mem-row">
                    <span className="card-mem-icon">{icon && <Icon icon={icon} />}</span>
                    <span className="card-mem-target">{r.target}</span>
                    <span className="card-mem-text">{relationSummary(r)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
