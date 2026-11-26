// 加入資源檔案前的確認視窗：每個檔案一列，可以改名（預設是整理過的原檔名，副檔名不能改），右邊即時顯示資源名稱
import { useEffect, useMemo, useState } from 'react';
import { AssetPlace, assetName, cleanName, nameProblem, splitExt } from '../assets';
import { imageSrc } from '../images';
import { useKeys } from '../hooks';
import Icon from './Icon';

export type ImportSource = { kind: 'path'; path: string } | { kind: 'file'; file: File };
export interface ImportItem {
  source: ImportSource;
  original: string; // 原檔名
}

const IMAGE = /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i;

interface Props {
  place: AssetPlace;
  items: ImportItem[];
  existing: Set<string>; // 目的地已經有的名稱（小寫）
  onConfirm: (names: string[]) => Promise<void>; // 每個檔案最後的檔名（含副檔名）
  onCancel: () => void;
}

export default function AssetImportDialog({ place, items, existing, onConfirm, onCancel }: Props) {
  const exts = useMemo(() => items.map((it) => splitExt(it.original)[1]), [items]);
  const [stems, setStems] = useState(() => items.map((it) => cleanName(splitExt(it.original)[0]) || '新檔案'));
  const [busy, setBusy] = useState(false);
  // 拖進來的檔案用 blob 網址顯示縮圖，選檔的用 vnimg（Rust 允許剛選過的檔案）
  const previews = useMemo(
    () =>
      items.map((it) => {
        if (!IMAGE.test(it.original)) return '';
        return it.source.kind === 'file' ? URL.createObjectURL(it.source.file) : imageSrc(it.source.path);
      }),
    [items],
  );
  useEffect(() => () => previews.forEach((u) => u.startsWith('blob:') && URL.revokeObjectURL(u)), [previews]);
  useKeys((e) => {
    if (e.key !== 'Escape' || busy) return false;
    onCancel();
    return true;
  }, [busy, onCancel]);
  const names = stems.map((s, i) => s.trim() + exts[i]);
  const problems = names.map((n, i) => {
    const bad = nameProblem(stems[i]);
    if (bad) return bad;
    const lower = n.toLowerCase();
    if (existing.has(lower)) return '已經有同名的檔案';
    if (names.findIndex((m) => m.toLowerCase() === lower) !== i) return '和上面的檔案同名';
    return null;
  });
  const blocked = problems.some(Boolean);
  const where = [place.category, ...place.folder.split('/').filter(Boolean)].join('／');
  const submit = async () => {
    if (blocked || busy) return;
    setBusy(true);
    try {
      await onConfirm(names);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="close-backdrop">
      <div className="close-panel asset-import" role="dialog" aria-label="加入檔案">
        <div className="close-message">
          加入 {items.length} 個檔案到：<b>{where}</b>
        </div>
        <div className="asset-import-list">
          {items.map((it, i) => (
            <div key={i} className={`asset-import-row${problems[i] ? ' bad' : ''}`}>
              {previews[i] ? <img className="asset-import-thumb" src={previews[i]} alt="" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} /> : <Icon icon="file" className="asset-import-thumb" />}
              <input
                className="asset-import-input"
                value={stems[i]}
                autoFocus={i === 0}
                title={`原檔名：${it.original}`}
                onChange={(e) => setStems((s) => s.map((v, j) => (j === i ? e.target.value : v)))}
                onKeyDown={(e) => e.key === 'Enter' && void submit()}
              />
              <span className="asset-import-ext">{exts[i]}</span>
              <span className="asset-import-name" title="指令裡用的名稱">
                → {stems[i].trim() ? assetName(place.folder, names[i]) : ''}
              </span>
              {problems[i] && <span className="asset-import-problem"><Icon icon="warning" /> {problems[i]}</span>}
            </div>
          ))}
        </div>
        <div className="close-buttons">
          <button type="button" className="close-btn primary" disabled={blocked || busy} onClick={() => void submit()}>{busy ? '加入中…' : '加入'}</button>
          <button type="button" className="close-btn" disabled={busy} onClick={onCancel}>取消</button>
        </div>
      </div>
    </div>
  );
}
