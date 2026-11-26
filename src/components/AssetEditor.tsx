// 資源的編輯視窗（像卡片的放大檢視那樣跳出來）：檔案（預覽、選檔、拖進來更換）、檔名（改了就把檔案改名）、名稱（資源.json 的備註）
// 劇本裡存的一律是指令名稱（由路徑算出來），在檔名底下用小字標出來
import { useEffect, useRef, useState } from 'react';
import { AssetSource, assetName, attachAssetFile, closeAsset, nameProblem, renameAsset, splitExt, takeAssetNameFocus, updateAssetInfo, useAssets, useOpenAsset } from '../assets';
import { imageSrc } from '../images';
import { ASSETS_ID, sectionMeta } from '../sections';
import { errorText, useKeys } from '../hooks';
import { openImageViewer } from './ImageViewer';
import Icon from './Icon';

export default function AssetEditorHost() {
  const path = useOpenAsset();
  return path ? <AssetEditor key={path} path={path} /> : null;
}

function AssetEditor({ path }: { path: string }) {
  const tree = useAssets();
  const asset = tree.categories.flatMap((c) => c.assets).find((a) => a.path === path);
  const file = path.slice(path.lastIndexOf('/') + 1);
  const [stem, ext] = asset?.missing ? [file, ''] : splitExt(file);
  const [draft, setDraft] = useState(stem);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => setDraft(stem), [stem]);
  useEffect(() => {
    if (asset && takeAssetNameFocus(path)) window.setTimeout(() => (nameRef.current?.focus(), nameRef.current?.select()), 0);
  }, [asset, path]);
  // Esc：上面還開著看圖視窗時先讓它關
  useKeys((e) => e.key === 'Escape' && !document.querySelector('.image-viewer') && (closeAsset(), true), []);

  const commitName = async () => {
    const name = draft.trim();
    if (name === stem || busy) return setError(null);
    const bad = nameProblem(name);
    if (bad) return setError(bad);
    setBusy(true);
    const problem = await renameAsset(path, name + ext);
    setBusy(false);
    setError(problem);
  };
  const giveFile = async (source: AssetSource) => {
    const name = source.kind === 'file' ? source.file.name : source.path.replace(/\\/g, '/').split('/').pop();
    if (!asset?.missing && !window.confirm(`要用「${name}」換掉現在的檔案嗎？\n原本的檔案會從硬碟刪除，名稱不變。`)) return;
    setBusy(true);
    setFileError(await attachAssetFile(path, source));
    setBusy(false);
  };
  const pick = async () => {
    try {
      const [first] = await window.api.pickAssetFiles();
      if (first) await giveFile({ kind: 'path', path: first });
    } catch (e) {
      setFileError(errorText(e));
    }
  };
  // 從檔案總管拖檔案進來：給檔案／更換檔案
  const dropProps = {
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes('Files')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setDropping(true);
    },
    onDragLeave: (e: React.DragEvent) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setDropping(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDropping(false);
      const f = e.dataTransfer.files[0];
      if (f) void giveFile({ kind: 'file', file: f });
    },
  };

  let body: React.ReactNode;
  if (!asset) {
    body = <div className="asset-viewer-empty">{tree.exists ? `找不到「${path}」（可能被改名、搬移或刪除了）` : '讀取中…'}</div>;
  } else {
    const preview = assetName(asset.folder, draft.trim() + ext);
    body = (
      <>
        {asset.missing ? (
          <div className={`asset-editor-preview none missing${dropping ? ' dropping' : ''}`} {...dropProps}>
            <Icon icon="file-media" />
            <span>還沒有檔案</span>
            <button type="button" className="close-btn primary" disabled={busy} onClick={() => void pick()}>選擇檔案…</button>
            <span className="asset-editor-hint">或從檔案總管把檔案拖到這裡</span>
          </div>
        ) : (
          <div className={`asset-editor-drop${dropping ? ' dropping' : ''}`} {...dropProps}>
            {asset.image ? (
              <button type="button" className="asset-editor-preview" title="點一下放大；把檔案拖到這裡可以更換" onClick={() => openImageViewer(asset.path)}>
                <img src={imageSrc(asset.path)} alt="" draggable={false} onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
              </button>
            ) : (
              <div className="asset-editor-preview none" title="把檔案拖到這裡可以更換">
                <Icon icon="file" />
                <span>{ext ? `${ext.slice(1).toUpperCase()} 檔案` : '檔案'}</span>
              </div>
            )}
          </div>
        )}
        {fileError && (
          <div className="asset-editor-problem center">
            <Icon icon="warning" /> {fileError}
          </div>
        )}
        <div className="asset-editor-grid">
          <label htmlFor="asset-dialog-file">檔名</label>
          <div className="asset-editor-value">
            <span className="asset-editor-file">
              <input
                id="asset-dialog-file"
                ref={nameRef}
                value={draft}
                disabled={busy}
                onChange={(e) => (setDraft(e.target.value), setError(null))}
                onBlur={() => void commitName()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void commitName();
                }}
              />
              <span className="asset-import-ext">{ext}</span>
            </span>
            {!asset.missing && (
              <button type="button" className="text-btn" disabled={busy} onClick={() => void pick()}>更換檔案…</button>
            )}
            {error && (
              <span className="asset-editor-problem">
                <Icon icon="warning" /> {error}
              </span>
            )}
            <span className="asset-editor-cmd">
              {draft.trim() && draft.trim() !== stem ? (
                <>指令名稱會變成 <code>{preview}</code>（按 Enter 改名）</>
              ) : (
                <>
                  指令名稱 <code>{asset.name}</code>
                  <button
                    type="button"
                    className="text-btn"
                    onClick={() => void navigator.clipboard.writeText(asset.name).then(() => (setCopied(true), window.setTimeout(() => setCopied(false), 1200)))}
                  >
                    {copied ? '已複製' : '複製'}
                  </button>
                  {asset.duplicate && (
                    <span className="asset-editor-problem">
                      <Icon icon="warning" /> 這個類別裡有別的資源算出同一個名稱
                    </span>
                  )}
                </>
              )}
            </span>
          </div>

          <label htmlFor="asset-dialog-note">名稱</label>
          <div className="asset-editor-value">
            <input
              id="asset-dialog-note"
              className="asset-editor-note"
              value={asset.note}
              placeholder="例如：桃花 微笑（只用來顯示）"
              onChange={(e) => updateAssetInfo(path, { 備註: e.target.value })}
            />
          </div>
        </div>
      </>
    );
  }
  return (
    <div className="memory-viewer asset-dialog" onClick={(e) => e.target === e.currentTarget && closeAsset()}>
      <div className="memory-viewer-box" spellCheck={false}>
        <div className="memory-viewer-head">
          <span className="memory-viewer-title">
            <Icon icon={sectionMeta(ASSETS_ID).icon} /> {asset ? asset.note || asset.label : file}
          </span>
          <span className="memory-viewer-spacer" />
          <button type="button" className="icon-btn" title="關閉（Esc）" onClick={closeAsset}><Icon icon="close" /></button>
        </div>
        <div className="memory-viewer-body asset-dialog-body">{body}</div>
      </div>
    </div>
  );
}
