// 設定頁的字型（UI 字型、內容字型）：設定頁只有一列（目前的字型＋「選擇字型…」），按了才打開字型卡視窗，用那個字型直接畫範例；點了就套用
import { useEffect, useState } from 'react';

// 「預設」那張卡：用哪個字型畫、怎麼說明
interface DefaultFont {
  family: string;
  style: string;
}
import { FONT_OPTIONS, FontOption, findFont, fontValue, loadFont } from '../fonts';
import { useEscape } from '../hooks';

const DEFAULT_SAMPLE = '「欸嘿，今天也要加油喔！」桃花笑著推開咖啡廳的門。';
let lastSample = DEFAULT_SAMPLE; // 改過的範例文字，下次打開設定還在

type Status = 'loading' | 'ok' | 'offline';

function FontCard({ font, fallback, sample, on, onPick }: { font: FontOption | null; fallback: DefaultFont; sample: string; on: boolean; onPick: () => void }) {
  const [status, setStatus] = useState<Status>(font?.web ? 'loading' : 'ok');
  useEffect(() => {
    if (!font?.web) return;
    let alive = true;
    setStatus('loading');
    void loadFont(font, sample + font.label).then((ok) => alive && setStatus(ok ? 'ok' : 'offline'));
    return () => {
      alive = false;
    };
  }, [font, sample]);
  const family = font ? `${fontValue(font)}, ${fallback.family}` : fallback.family;
  return (
    <button type="button" className={`font-card${on ? ' on' : ''}`} onClick={onPick}>
      <span className="font-card-head">
        <span className="font-card-name" style={{ fontFamily: family }}>{font ? font.label : '預設'}</span>
        <span className={`font-card-badge${font?.web ? ' web' : ''}`}>
          {!font ? '內建' : !font.web ? '已安裝' : status === 'loading' ? '載入中…' : status === 'offline' ? '連不上網路' : '線上'}
        </span>
      </span>
      <span className="font-card-style">{font ? font.style : fallback.style}</span>
      <span className="font-card-langs">
        {font ? font.langs : '英・日・台灣字形'}
        {font?.note && <span className="font-card-note">（{font.note}）</span>}
      </span>
      <span className="font-card-sample" style={{ fontFamily: family }}>{sample || DEFAULT_SAMPLE}</span>
    </button>
  );
}

export default function FontPicker({ title, hint, fallback, value, onChange }: {
  title: string; // 例如「UI 字型」「內容字型」
  hint: string;
  fallback: DefaultFont;
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = findFont(value);
  const label = value.trim() === '' ? '預設' : current ? current.label : value.trim();
  useEffect(() => void (current && loadFont(current, label)), [current, label]); // 名稱用那個字型顯示：網路字型先載入
  return (
    <div className="settings-row">
      <div className="settings-label">
        <div>{title}</div>
        <div className="settings-hint">{hint}</div>
      </div>
      <div className="settings-control">
        <span className="font-current" style={{ fontFamily: value.trim() ? `${value}, ${fallback.family}` : fallback.family }}>{label}</span>
        <button type="button" className="settings-btn" onClick={() => setOpen(true)}>選擇字型…</button>
      </div>
      {open && (
        <FontDialog
          title={title}
          fallback={fallback}
          value={value}
          onPick={(v) => {
            onChange(v);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

// 字型選擇視窗：疊在設定頁上面；點字型卡 = 套用並關掉，Esc／點外面／取消 = 不變
function FontDialog({ title, fallback, value, onPick, onClose }: { title: string; fallback: DefaultFont; value: string; onPick: (v: string) => void; onClose: () => void }) {
  useEscape(onClose);
  const [sample, setSampleState] = useState(lastSample);
  const setSample = (s: string) => {
    lastSample = s;
    setSampleState(s);
  };
  const current = findFont(value);
  const [customText, setCustomText] = useState(value.trim() !== '' && !current ? value : '');
  return (
    <div className="font-dialog" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="font-dialog-box" role="dialog" aria-label="選擇字型">
        <div className="settings-header">
          <span className="settings-title">選擇{title}</span>
          <input
            type="text"
            className="settings-text font-picker-sample"
            value={sample}
            placeholder="輸入想預覽的句子"
            onChange={(e) => setSample(e.target.value)}
          />
        </div>
        <div className="font-dialog-body">
          <div className="font-grid">
            <FontCard font={null} fallback={fallback} sample={sample} on={value.trim() === ''} onPick={() => onPick('')} />
            {FONT_OPTIONS.map((f) => (
              <FontCard key={f.family} font={f} fallback={fallback} sample={sample} on={current === f} onPick={() => onPick(fontValue(f))} />
            ))}
          </div>
          <div className="font-custom">
            <span>自訂：</span>
            <input
              type="text"
              className="settings-text"
              value={customText}
              placeholder="電腦上有裝的字型名稱，例如 華康圓體"
              onChange={(e) => setCustomText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && customText.trim() && onPick(customText.trim())}
            />
            <button type="button" className="settings-btn" disabled={!customText.trim()} onClick={() => onPick(customText.trim())}>使用這個字型</button>
            {customText.trim() && (
              <span className="font-custom-preview" style={{ fontFamily: `${customText.trim()}, ${fallback.family}` }}>{sample || DEFAULT_SAMPLE}</span>
            )}
          </div>
        </div>
        <div className="settings-footer">
          <span />
          <button type="button" className="settings-btn" onClick={onClose}>取消</button>
        </div>
      </div>
    </div>
  );
}
