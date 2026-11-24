// 卡片放大視窗：不用開分頁就能看資料（欄位、圖片、詳細內容），有記憶的區塊還能切到時間線、關係
import { useEffect, useRef, useState } from 'react';
import { Card, CardSectionId, Field, MEMORY_KINDS, Memory, SchemaField, cardTabId } from '../model';
import { findTargetCard, relationSummary, relations, scriptPath, targetIcon } from '../memories';
import { sectionDef, sectionMeta } from '../sections';
import { childFolderOf } from '../projectFiles';
import FieldGroupTabs, { fieldShown, groupKey, groupOf, groupsIn, useFieldGroup } from './FieldGroupTabs';
import { fieldIconDef } from '../fieldIcons';
import { CutSelect, MemoryRelations, useCut } from './MemoryPanel';
import { showCardMemory } from './CardEditor';
import { CardImage } from './CardItem';
import { RichTextView } from './RichTextEditor';
import FieldText from './FieldText';
import Icon, { IconDef } from './Icon';
import { eventChannel, useKeys } from '../hooks';
import { useCtrlWheel } from '../settings';

type View = 'data' | 'timeline' | 'relations';

interface At {
  section: CardSectionId;
  id: string;
  view?: View;
  focus?: 'detail'; // 打開時捲到詳細內容
}

const channel = eventChannel<At>('vn-open-memory');
let lastMemView: 'timeline' | 'relations' = 'timeline'; // 上次看的是時間線還是關係（下次打開記憶沿用）
export const openMemoryViewer = (section: CardSectionId, id: string) => channel.open({ section, id, view: lastMemView });
export const openCardViewer = (section: CardSectionId, id: string, focus?: 'detail') => channel.open({ section, id, view: 'data', focus });

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
      key={`${at.section}:${at.id}:${at.focus ?? ''}`}
      focus={at.focus}
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

function MemoryViewer({ section, card, focus, initialView, cards, files, schemaFields, openTab, onGo, onClose }: {
  section: CardSectionId;
  focus?: 'detail';
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
  const boxRef = useRef<HTMLDivElement>(null);
  useCtrlWheel(boxRef, 'viewerFontSize');
  const [view, setViewState] = useState<View>(hasMemory ? initialView : 'data');
  const setView = (v: View) => {
    if (v !== 'data') lastMemView = v;
    setViewState(v);
  };
  // Esc：上面還開著看圖視窗時先讓它關
  useKeys((e) => e.key === 'Escape' && !document.querySelector('.image-viewer') && (onClose(), true), [onClose]);
  const memories = card.memories ?? [];
  const { cut, setCut, shown } = useCut(memories);
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
  // 上層卡片（這張卡所在的資料夾是哪張卡的子卡片資料夾）和子卡片
  const siblings = cards[section] ?? [];
  const here = (card.folder ?? '').toLowerCase();
  const own = childFolderOf(card).toLowerCase();
  const family = {
    parent: here ? siblings.find((c) => childFolderOf(c).toLowerCase() === here) : undefined,
    kids: siblings.filter((c) => (c.folder ?? '').toLowerCase() === own),
  };
  type Item = { kind: 'source'; source: string } | { kind: 'memory'; m: Memory };
  const items: Item[] = [];
  shown.forEach((m, i) => {
    if (i === 0 || m.source !== shown[i - 1].source) items.push({ kind: 'source', source: m.source });
    items.push({ kind: 'memory', m });
  });
  return (
    <div className="memory-viewer" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="memory-viewer-box" ref={boxRef}>
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
          {hasMemory && <CutSelect memories={memories} cut={cut} onChange={setCut} />}
          <button type="button" className="icon-btn" title={view === 'data' ? '在分頁中編輯' : '在分頁中編輯記憶'} onClick={edit}><Icon icon="edit" /></button>
          <button type="button" className="icon-btn" title="關閉（Esc）" onClick={onClose}><Icon icon="close" /></button>
        </div>
        <div className="memory-viewer-body">
          {view === 'data' ? (
            <CardData
              focus={focus}
              card={card}
              schemaFields={schemaFields}
              memories={hasMemory ? shown : null}
              total={memories.length}
              targetIcon={iconOf}
              onRelations={() => setView('relations')}
              family={family}
              section={section}
              icon={sectionMeta(section).icon}
              onOpenCard={(c) => onGo({ section, id: c.id, view: 'data' })}
            />
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
          {hidden > 0 && <div className="memory-note">（之後還有 {hidden} 筆，「看到」選「全部」才會顯示）</div>}
        </div>
      </div>
    </div>
  );
}

// 資料頁：左邊圖片欄位放大，右邊所有欄位（收合的也展開），下面詳細內容；有記憶的區塊附關係摘要
function CardData({ focus, card, schemaFields, memories, total, targetIcon, onRelations, family, section, icon, onOpenCard }: {
  family: { parent?: Card; kids: Card[] };
  section: CardSectionId;
  icon: IconDef;
  onOpenCard: (card: Card) => void;
  focus?: 'detail';
  card: Card;
  schemaFields: SchemaField[];
  memories: Memory[] | null; // 照「看到」過濾過的記憶（沒有記憶的區塊 = null）
  total: number;
  targetIcon: (name: string) => IconDef | undefined;
  onRelations: () => void;
}) {
  const schemaOf = (f: Field) => schemaFields.find((s) => s.key === f.key);
  const isImage = (f: Field) => {
    const s = schemaOf(f);
    return (s ? s.type : f.type) === 'image';
  };
  const groups = groupsIn(card.fields, schemaFields);
  const [group, setGroup] = useFieldGroup(groupKey('viewer', cardTabId(section, card.id)), groups);
  const shownNow = card.fields.filter((f) => fieldShown(schemaFields, f.key, group));
  const images = shownNow.filter((f) => isImage(f) && f.value.trim());
  const textsOf = (grouped: boolean) => shownNow.filter((f) => !isImage(f) && !!groupOf(schemaFields, f.key) === grouped);
  const texts = [...textsOf(false), ...textsOf(true)];
  const textRow = (f: Field) => {
    const icon = fieldIconDef(schemaOf(f));
    return (
      <div key={f.key} className="card-view-row">
        <span className="card-view-key">
          {icon && <Icon icon={icon} className="field-icon" />}
          {f.key || '（未命名）'}
        </span>
        {f.value.trim() ? <FieldText className="card-view-value" text={f.value} /> : <span className="card-view-value memory-dim">—</span>}
      </div>
    );
  };
  const rels = memories ? relations(memories) : [];
  const detailRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (focus === 'detail') detailRef.current?.scrollIntoView({ block: 'start' });
  }, []);
  const cardLink = (c: Card) => (
    <button key={c.id} type="button" className="memory-link" title={`看「${c.name}」`} onClick={() => onOpenCard(c)}>
      <Icon icon={icon} /> {c.name || '（未命名）'}
    </button>
  );
  return (
    <div className="card-view">
      {family.parent && <div className="card-view-parent">上層：{cardLink(family.parent)}</div>}
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
          {texts.length === 0 && groups.length === 0 && <span className="memory-note">沒有欄位</span>}
          {textsOf(false).map(textRow)}
          <FieldGroupTabs groups={groups} current={group} onPick={setGroup} className="card-view-groups" />
          {textsOf(true).map(textRow)}
        </div>
      </div>
      {family.kids.length > 0 && (
        <section className="card-view-section">
          <div className="card-view-label">子卡片 {family.kids.length}</div>
          <div className="card-view-kids">{family.kids.map(cardLink)}</div>
        </section>
      )}
      {card.detail.trim() && (
        <section className="card-view-section" ref={detailRef}>
          <div className="card-view-label">詳細內容</div>
          <RichTextView markdown={card.detail} />
        </section>
      )}
      {memories && (
        <section className="card-view-section">
          <div className="card-view-label">關係（記憶 {memories.length === total ? total : `${memories.length}／${total}`}）</div>
          {rels.length === 0 ? (
            <span className="memory-note">{total === 0 ? '還沒有記憶' : '到這裡為止還沒有關係'}</span>
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
