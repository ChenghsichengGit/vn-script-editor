import { Fragment, useRef, useState } from 'react';
import type { FileOps, FolderOps, Layout } from '../App';
import { dragWith } from '../App';
import { Card, CardOps, CardSectionId, SectionId, cardTabId } from '../model';
import { sectionMeta } from '../sampleData';
import { folderBase, joinFolder, parentFolder } from '../projectFiles';
import CardItem from './CardItem';
import ContextMenu from './ContextMenu';
import NameInput from './NameInput';

interface Props {
  layout: Layout;
  onLayoutChange: (patch: Partial<Layout>) => void;
  files: Record<string, { name: string; folder: string }>;
  fileOps: FileOps;
  folders: Record<SectionId, string[]>;
  folderOps: FolderOps;
  cards: Record<CardSectionId, Card[]>;
  cardOps: CardOps;
  activeTab: string | null;
  onOpenFile: (id: string) => void;
}

const MIN_HEIGHT = 60; // 每個展開區塊最矮多高
const FILLER_MIN_HEIGHT = 120; // 填滿用的區塊最矮多高（要和 styles.css 的 .section.filler 一致）
const DEFAULT_HEIGHT = 200; // 還沒調整過的區塊預設高度（像素）
const INDENT = 14; // 每深一層資料夾縮排多少像素

// 樹狀列的左邊距：資料夾和設定卡有 ▸ 箭頭；劇本檔案沒有，所以多推一個箭頭的寬度，讓檔名和資料夾名對齊
const rowPad = (depth: number, hasChevron: boolean) => (hasChevron ? 6 : 22) + depth * INDENT;
const byName = (a: string, b: string) => a.localeCompare(b, 'zh-Hant');

// 右鍵選單對準的目標
type MenuTarget =
  | { kind: 'file'; id: string }
  | { kind: 'card'; section: CardSectionId; id: string }
  | { kind: 'folder'; section: SectionId; folder: string };

// 正在顯示輸入框的位置：新增（在 parent 資料夾底下新增項目或資料夾），或幫某個東西改名
type Editing =
  | { mode: 'create'; section: SectionId; parent: string; what: 'item' | 'folder' }
  | { mode: 'rename'; kind: 'file'; id: string }
  | { mode: 'rename'; kind: 'card'; section: CardSectionId; id: string }
  | { mode: 'rename'; kind: 'folder'; section: SectionId; folder: string };

// 摺疊狀態的 key（預設全部展開，所以記的是「被摺起來」的資料夾）
const folderKey = (section: SectionId, folder: string) => `${section}:${folder}`;

// 側邊欄：把開著的區塊上下疊起來
// 每個區塊拖到多高就固定多高；只有「最下面的區塊」會伸縮填滿剩下的空間
// 放不下時，固定高度的區塊會按比例暫時縮小（記住的高度不變，空間夠了就恢復），側邊欄不會出現捲軸
export default function Sidebar(props: Props) {
  const { layout } = props;
  const sectionEls = useRef<Partial<Record<SectionId, HTMLDivElement | null>>>({});
  // 每個區塊的「全部展開／全部收起」訊號：tick 每按一次加 1，卡片看到變化就跟著切換
  const [bulk, setBulk] = useState<Partial<Record<SectionId, { show: boolean; tick: number }>>>({});

  // 右鍵選單（記著位置和對象）、以及正在顯示的名稱輸入框（新增／改名）
  const [menu, setMenu] = useState<{ x: number; y: number; target: MenuTarget } | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  // 被摺起來的資料夾
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const filler = layout.open[layout.open.length - 1]; // 負責填滿空間的那一塊

  const toggleFolder = (section: SectionId, folder: string) =>
    setCollapsed((c) => {
      const next = new Set(c);
      const key = folderKey(section, folder);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  // 開始新增：目標資料夾自動展開，並在那裡顯示輸入框
  const startCreate = (section: SectionId, parent: string, what: 'item' | 'folder') => {
    setCollapsed((c) => {
      const next = new Set(c);
      next.delete(folderKey(section, parent));
      return next;
    });
    setEditing({ mode: 'create', section, parent, what });
  };

  // 資料夾改名後，它（和底下各層）的摺疊記號跟著換成新路徑
  const remapCollapsed = (section: SectionId, oldPath: string, newPath: string) =>
    setCollapsed((c) => {
      const oldKey = folderKey(section, oldPath);
      const newKey = folderKey(section, newPath);
      const next = new Set<string>();
      for (const key of c) {
        next.add(key === oldKey || key.startsWith(oldKey + '/') ? newKey + key.slice(oldKey.length) : key);
      }
      return next;
    });

  // 拖曳第 index 條分隔線：改變上方區塊的高度
  // 下方如果是填滿用的區塊，它會自動吸收差額；如果是固定高度的，就一增一減
  const startSectionResize = (index: number, e: React.MouseEvent) => {
    e.preventDefault();
    const above = layout.open[index];
    const below = layout.open[index + 1];
    if (!above || !below) return;

    const height = (id: SectionId) => sectionEls.current[id]!.getBoundingClientRect().height;
    const startAbove = height(above);
    const startBelow = height(below);
    const startY = e.clientY;
    const belowMin = below === filler ? FILLER_MIN_HEIGHT : MIN_HEIGHT;

    dragWith((ev) => {
      let dy = ev.clientY - startY;
      // 上下兩塊都不能比最小高度矮，否則內容會撐出側邊欄、跑出捲軸
      dy = Math.max(MIN_HEIGHT - startAbove, dy);
      dy = Math.min(startBelow - belowMin, dy);
      const sizes = { ...layout.sizes, [above]: startAbove + dy };
      if (below !== filler) sizes[below] = startBelow - dy;
      props.onLayoutChange({ sizes });
    });
  };

  // 右鍵選單的項目
  const menuItems = (t: MenuTarget) => {
    if (t.kind === 'file') {
      return [
        { label: '重新命名', onClick: () => setEditing({ mode: 'rename', kind: 'file', id: t.id }) },
        {
          label: '刪除',
          onClick: () => {
            if (window.confirm(`要刪除「${props.files[t.id].name}」嗎？`)) props.fileOps.remove(t.id);
          },
        },
      ];
    }
    if (t.kind === 'card') {
      return [
        { label: '重新命名', onClick: () => setEditing({ mode: 'rename', kind: 'card', section: t.section, id: t.id }) },
        {
          label: '刪除',
          onClick: () => {
            const card = props.cards[t.section].find((c) => c.id === t.id);
            if (card && window.confirm(`要刪除「${card.name}」嗎？`)) props.cardOps.remove(t.section, t.id);
          },
        },
      ];
    }
    return [
      {
        label: t.section === 'files' ? '新增檔案' : `新增${sectionMeta[t.section].title}`,
        onClick: () => startCreate(t.section, t.folder, 'item'),
      },
      { label: '新增資料夾', onClick: () => startCreate(t.section, t.folder, 'folder') },
      {
        label: '重新命名',
        onClick: () => setEditing({ mode: 'rename', kind: 'folder', section: t.section, folder: t.folder }),
      },
      {
        label: '刪除',
        onClick: () => {
          if (window.confirm(`要刪除資料夾「${folderBase(t.folder)}」以及裡面所有的內容嗎？`)) {
            void props.folderOps.remove(t.section, t.folder);
          }
        },
      },
    ];
  };

  const openMenu = (e: React.MouseEvent, target: MenuTarget) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, target });
  };

  // 畫出某個區塊的某個資料夾裡的內容：先子資料夾、再項目，各自依名稱排序；子資料夾遞迴處理
  const renderLevel = (section: SectionId, folder: string, depth: number, sectionBulk: { show: boolean; tick: number }) => {
    const subs = props.folders[section]
      .filter((f) => parentFolder(f) === folder)
      .sort((a, b) => byName(folderBase(a), folderBase(b)));
    const creating = editing?.mode === 'create' && editing.section === section && editing.parent === folder ? editing : null;

    // 新增用的輸入框：資料夾的排在子資料夾群的最上面，檔案／設定卡的排在項目群的最上面
    const createRow = (what: 'item' | 'folder') => {
      if (creating?.what !== what) return null;
      const chevron = what === 'folder' || section !== 'files'; // 劇本檔案的列沒有箭頭
      return (
        <div className="tree-row" style={{ paddingLeft: rowPad(depth, chevron) }}>
          {chevron && <span className="chevron">▸</span>}
          <NameInput
            onSubmit={(name) => {
              if (what === 'folder') return props.folderOps.create(section, folder, name);
              return section === 'files' ? props.fileOps.add(folder, name) : props.cardOps.add(section, folder, name);
            }}
            onClose={() => setEditing(null)}
          />
        </div>
      );
    };

    // 這個資料夾直接包含的項目
    let items: React.ReactNode;
    if (section === 'files') {
      items = Object.entries(props.files)
        .filter(([, f]) => f.folder === folder)
        .sort(([, a], [, b]) => byName(a.name, b.name))
        .map(([fileId, file]) => {
          const renaming = editing?.mode === 'rename' && editing.kind === 'file' && editing.id === fileId;
          const dot = file.name.lastIndexOf('.');
          return (
            <div
              key={fileId}
              className={`tree-row${props.activeTab === fileId ? ' selected' : ''}`}
              style={{ paddingLeft: rowPad(depth, false) }}
              onClick={() => props.onOpenFile(fileId)}
              onContextMenu={(e) => openMenu(e, { kind: 'file', id: fileId })}
            >
              {renaming ? (
                <NameInput
                  initial={file.name}
                  selectTo={dot > 0 ? dot : undefined} // 一開始只選副檔名前面的部分
                  onSubmit={(name) => props.fileOps.rename(fileId, name)}
                  onClose={() => setEditing(null)}
                />
              ) : (
                <span className="tree-label">{file.name}</span>
              )}
            </div>
          );
        });
    } else {
      items = props.cards[section]
        .filter((c) => (c.folder ?? '') === folder)
        .sort((a, b) => byName(a.name, b.name))
        .map((card) => (
          <CardItem
            key={card.id}
            section={section}
            card={card}
            ops={props.cardOps}
            bulk={sectionBulk}
            selected={props.activeTab === cardTabId(section, card.id)}
            depth={depth}
            onMenu={(e) => openMenu(e, { kind: 'card', section, id: card.id })}
            renaming={editing?.mode === 'rename' && editing.kind === 'card' && editing.id === card.id}
            onRename={(name) => props.cardOps.rename(section, card.id, name)}
            onRenameClose={() => setEditing(null)}
          />
        ));
    }

    return (
      <>
        {createRow('folder')}
        {subs.map((sub) => {
          const open = !collapsed.has(folderKey(section, sub));
          const renaming =
            editing?.mode === 'rename' && editing.kind === 'folder' && editing.section === section && editing.folder === sub;
          return (
            <Fragment key={sub}>
              <div
                className="tree-row"
                style={{ paddingLeft: rowPad(depth, true) }}
                onClick={() => toggleFolder(section, sub)}
                onContextMenu={(e) => openMenu(e, { kind: 'folder', section, folder: sub })}
              >
                <span className="chevron">{open ? '▾' : '▸'}</span>
                {renaming ? (
                  <NameInput
                    initial={folderBase(sub)}
                    onSubmit={async (name) => {
                      const err = await props.folderOps.rename(section, sub, name);
                      if (!err) remapCollapsed(section, sub, joinFolder(parentFolder(sub), name.trim()));
                      return err;
                    }}
                    onClose={() => setEditing(null)}
                  />
                ) : (
                  <span className="tree-label">{folderBase(sub)}</span>
                )}
              </div>
              {open && renderLevel(section, sub, depth + 1, sectionBulk)}
            </Fragment>
          );
        })}
        {createRow('item')}
        {items}
      </>
    );
  };

  return (
    <aside className="sidebar" style={{ width: layout.width }}>
      {layout.open.map((id, i) => {
        const meta = sectionMeta[id];
        const sectionBulk = bulk[id] ?? { show: false, tick: 0 };
        return (
          <Fragment key={id}>
            {i > 0 && <div className="section-sash" onMouseDown={(e) => startSectionResize(i - 1, e)} />}
            <div
              className={`section${id === filler ? ' filler' : ''}`}
              ref={(el) => (sectionEls.current[id] = el)}
              style={id !== filler ? { height: layout.sizes[id] ?? DEFAULT_HEIGHT } : undefined}
            >
              {/* 區塊標題列：新增檔案（設定卡）、新增資料夾；設定卡區塊還多一個全部展開／收起 */}
              <div className="section-header">
                <span className="section-title">{meta.title}</span>
                <span className="section-actions">
                  {id !== 'files' && (
                    <button
                      className="icon-btn"
                      title={sectionBulk.show ? '全部收起' : '全部展開'}
                      onClick={() => setBulk({ ...bulk, [id]: { show: !sectionBulk.show, tick: sectionBulk.tick + 1 } })}
                    >
                      {sectionBulk.show ? '⊟' : '⊞'}
                    </button>
                  )}
                  <button
                    className="icon-btn wide"
                    title={id === 'files' ? '新增檔案' : `新增${meta.title}`}
                    onClick={() => startCreate(id, '', 'item')}
                  >
                    {id === 'files' ? '📄' : meta.icon}＋
                  </button>
                  <button className="icon-btn wide" title="新增資料夾" onClick={() => startCreate(id, '', 'folder')}>
                    📁＋
                  </button>
                </span>
              </div>

              <div className="section-body">{renderLevel(id, '', 0, sectionBulk)}</div>
            </div>
          </Fragment>
        );
      })}
      {menu && <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={menuItems(menu.target)} />}
    </aside>
  );
}
