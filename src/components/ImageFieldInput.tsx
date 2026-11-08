import { useEffect, useState } from 'react';
import { imageError, imageFiles, imageSrc, pickImage, saveImageFile } from '../images';
import { openImageViewer } from './ImageViewer';

export default function ImageFieldInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [over, setOver] = useState(false);
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [value]); // 換了圖（包括外部改了卡片檔）就重新試著載入
  const src = imageSrc(value);
  const set = (path: string | null) => {
    if (path === null) return;
    setBroken(false);
    onChange(path);
  };
  const choose = () => pickImage().then(set, imageError);
  const saveFirst = (files: File[]) => {
    if (files.length > 0) saveImageFile(files[0]).then(set, imageError);
  };
  return (
    <div
      className={`image-field${over ? ' drop' : ''}${value ? '' : ' empty'}`}
      tabIndex={0}
      title={value || undefined}
      onPaste={(e) => {
        const files = imageFiles(e.clipboardData.files);
        if (files.length === 0) return;
        e.preventDefault();
        saveFirst(files);
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const files = imageFiles(e.dataTransfer.files);
        if (files.length === 0) return;
        e.preventDefault();
        saveFirst(files);
      }}
    >
      {value ? (
        broken ? (
          <div className="image-field-missing">找不到圖片：{value}</div>
        ) : (
          <img className="image-field-img" src={src} alt={value} draggable={false} onError={() => setBroken(true)} onClick={() => openImageViewer(value)} title="點一下放大" />
        )
      ) : (
        <button type="button" className="image-field-placeholder" onClick={choose}>選擇圖片，或拖進來、Ctrl+V 貼上</button>
      )}
      {value && (
        <div className="image-field-actions">
          <button type="button" className="text-btn" onClick={choose}>換一張</button>
          <button type="button" className="text-btn" onClick={() => onChange('')}>移除</button>
        </div>
      )}
    </div>
  );
}
