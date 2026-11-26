// 資源的放大檢視：整棵樹全部展開，每個資料夾一組，資源排成大縮圖；可以用名稱或備註篩選，點一下開啟資源的編輯分頁
import { useRef, useState } from 'react';
import { Asset, openAsset, placeRel, useAssets } from '../assets';
import { imageSrc } from '../images';
import { ASSETS_ID, sectionMeta } from '../sections';
import { eventChannel, useKeys } from '../hooks';
import { useCtrlWheel } from '../settings';
import Icon from './Icon';

const channel = eventChannel<boolean>('vn-open-asset-viewer');
export const openAssetViewer = () => channel.open(true);

export default function AssetViewerHost() {
  const [open, setOpen] = channel.useValue();
  return open ? <AssetViewer onClose={() => setOpen(false)} /> : null;
}

function AssetViewer({ onClose }: { onClose: () => void }) {
  const tree = useAssets();
  const [filter, setFilter] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);
  useCtrlWheel(boxRef, 'viewerFontSize');
  useKeys((e) => e.key === 'Escape' && (filter ? setFilter('') : onClose(), true), [onClose, filter]);
  const q = filter.trim().toLowerCase();
  const hit = (a: Asset) => !q || a.name.toLowerCase().includes(q) || a.note.toLowerCase().includes(q) || a.label.toLowerCase().includes(q);
  const groups = tree.categories.flatMap((cat) =>
    ['', ...cat.folders].map((folder) => ({
      key: placeRel({ category: cat.name, folder }),
      category: cat.name,
      folder,
      assets: cat.assets.filter((a) => a.folder === folder && hit(a)),
    })),
  ).filter((g) => g.assets.length);
  const total = tree.categories.reduce((n, c) => n + c.assets.length, 0);
  const open = (a: Asset) => {
    onClose();
    openAsset(a.path);
  };
  return (
    <div className="memory-viewer asset-viewer" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="memory-viewer-box" ref={boxRef}>
        <div className="memory-viewer-head">
          <span className="memory-viewer-title">
            <Icon icon={sectionMeta(ASSETS_ID).icon} /> 資源（{total}）
          </span>
          <span className="memory-viewer-spacer" />
          <input className="asset-viewer-filter" autoFocus value={filter} placeholder="用名稱或備註篩選…" onChange={(e) => setFilter(e.target.value)} />
          <button type="button" className="icon-btn" title="關閉（Esc）" onClick={onClose}><Icon icon="close" /></button>
        </div>
        <div className="memory-viewer-body">
          {groups.length === 0 && <div className="asset-viewer-empty">{q ? '沒有符合的資源。' : '還沒有資源。'}</div>}
          {groups.map((g) => (
            <div key={g.key} className="asset-viewer-group">
              <div className="asset-viewer-path">
                <Icon icon="folder" />
                <b>{g.category}</b>
                {g.folder.split('/').filter(Boolean).map((f, i) => (
                  <span key={i}>› {f}</span>
                ))}
                <span>（{g.assets.length}）</span>
              </div>
              <div className="asset-viewer-grid">
                {g.assets.map((a) => (
                  <button
                    key={a.path}
                    type="button"
                    className={`asset-viewer-item${a.missing ? ' missing' : ''}`}
                    title={`${a.note ? `${a.note}\n` : ''}${a.name}${a.missing ? '\n還沒有檔案' : `\n${a.path}`}${a.desc ? `\n\n${a.desc}` : ''}`}
                    onClick={() => open(a)}
                  >
                    <span className="asset-viewer-thumb">
                      {a.image ? (
                        <img src={imageSrc(a.path)} loading="lazy" alt="" draggable={false} onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
                      ) : a.missing ? (
                        <small>還沒有檔案</small>
                      ) : (
                        <Icon icon="file" />
                      )}
                    </span>
                    <span className="asset-viewer-note">{a.note || a.label}</span>
                    <span className="asset-viewer-name">{a.name}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
