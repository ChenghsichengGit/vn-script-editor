import { useEffect, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_FONT_FAMILY, DEFAULT_UI_FONT, FontSizeKey, LIMITS, Settings, resetSettings, updateSettings, useSettings } from '../settings';
import FontPicker from './FontPicker';
import './SettingsDialog.css';
import { useKeys } from '../hooks';
import Icon from './Icon';

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="settings-row">
      <div className="settings-label">
        <div>{label}</div>
        {hint && <div className="settings-hint">{hint}</div>}
      </div>
      <div className="settings-control">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="settings-switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="settings-switch-track" />
    </label>
  );
}

function NumberField({ value, min, max, step, onCommit }: {
  value: number;
  min: number;
  max: number;
  step: number;
  onCommit: (v: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = parseFloat(text);
    if (Number.isFinite(n)) onCommit(n);
    setText(String(value));
  };
  return (
    <div className="settings-number">
      <button type="button" onClick={() => onCommit(value - step)} disabled={value <= min}>
        −
      </button>
      <input
        type="number"
        value={text}
        min={min}
        max={max}
        step={step}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
      <button type="button" onClick={() => onCommit(value + step)} disabled={value >= max}>＋</button>
    </div>
  );
}

function ZoomSlider({ value }: { value: number }) {
  const [draft, setDraft] = useState<number | null>(null); // 拖曳中還沒套用的值
  const draftRef = useRef<number | null>(null);
  draftRef.current = draft;
  const commit = () => {
    if (draftRef.current !== null) updateSettings({ uiZoom: draftRef.current });
    setDraft(null);
  };
  const shown = draft ?? value;
  return (
    <>
      <input
        type="range"
        className="settings-range"
        min={LIMITS.uiZoom.min}
        max={LIMITS.uiZoom.max}
        step={LIMITS.uiZoom.step}
        value={shown}
        onChange={(e) => setDraft(Math.round(parseFloat(e.target.value) * 10) / 10)}
        onPointerDown={() => window.addEventListener('pointerup', commit, { once: true })}
        onKeyUp={commit}
        onBlur={commit}
      />
      <span className="settings-value">{Math.round(shown * 100)}%</span>
    </>
  );
}

type Category = 'look' | 'text' | 'script' | 'save' | 'external';
const CATEGORIES: { id: Category; label: string; icon: string; keys: (keyof Settings)[] }[] = [
  { id: 'look', label: '外觀', icon: 'symbol-color', keys: ['theme', 'uiZoom', 'uiFontFamily'] },
  { id: 'text', label: '內容文字', icon: 'text-size', keys: ['scriptFontFamily', 'scriptFontSize', 'sidebarFontSize', 'cardFontSize', 'viewerFontSize'] },
  { id: 'script', label: '劇本編輯器', icon: 'edit', keys: ['richScript', 'wordWrap', 'minimap', 'minimapScale'] },
  { id: 'save', label: '存檔與專案', icon: 'save', keys: ['autoSave', 'openLastProject'] },
  { id: 'external', label: '外部修改', icon: 'sparkle', keys: ['aiPlayback', 'aiSpeed', 'markExternal'] },
];
let lastCategory: Category = 'look'; // 下次打開停在上次看的分類

const WHEEL_HINT = '在這個區域按住 Ctrl 滾滑鼠滾輪也可以調整';

export default function SettingsDialog({ onClose }: { onClose: () => void }) {
  const s = useSettings();
  useKeys((e) => e.key === 'Escape' && !document.querySelector('.font-dialog') && (onClose(), true), [onClose]); // 字型視窗開著時 Esc 只關它
  const [cat, setCatState] = useState<Category>(lastCategory);
  const setCat = (c: Category) => {
    lastCategory = c;
    setCatState(c);
  };
  const current = CATEGORIES.find((c) => c.id === cat)!;
  const onResetAll = () => {
    if (window.confirm('確定要把所有設定恢復成預設值嗎？')) resetSettings();
  };
  const onResetCat = () => {
    if (window.confirm(`確定要把「${current.label}」的設定恢復成預設值嗎？`)) resetSettings(current.keys);
  };
  const fontRow = (key: FontSizeKey, label: string, hint: string) => (
    <Row label={label} hint={`${hint}；${WHEEL_HINT}`}>
      <NumberField value={s[key]} {...LIMITS[key]} onCommit={(v) => updateSettings({ [key]: v })} />
      <span className="settings-unit">px</span>
    </Row>
  );
  return (
    <div
      className="settings-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="settings-panel" role="dialog" aria-label="設定">
        <div className="settings-header">
          <span className="settings-title">設定</span>
          <button type="button" className="settings-close" onClick={onClose} title="關閉">×</button>
        </div>
        <div className="settings-main">
          <nav className="settings-nav">
            {CATEGORIES.map((c) => (
              <button key={c.id} type="button" className={c.id === cat ? 'on' : ''} onClick={() => setCat(c.id)}>
                <Icon icon={c.icon} /> {c.label}
              </button>
            ))}
          </nav>
        <div className="settings-body">
          <div className="settings-page-head">
            <span className="settings-page-title">{current.label}</span>
            <button type="button" className="settings-link" onClick={onResetCat}>恢復這一類的預設</button>
          </div>
          {cat === 'look' && (
            <>
          <Row label="顏色主題" hint="整個程式和劇本編輯器一起換色">
            <div className="settings-segment">
              {(['dark', 'light', 'hc'] as const).map((v, i) => (
                <button key={v} type="button" className={s.theme === v ? 'on' : ''} onClick={() => updateSettings({ theme: v })}>
                  {['深色', '淺色', '高對比'][i]}
                </button>
              ))}
            </div>
          </Row>
          <Row label="UI 大小" hint="放大縮小按鈕、圖示、間距、選單這些介面；劇本、左邊區域、設定卡、放大檢視的文字照「內容文字」的大小不變"><ZoomSlider value={s.uiZoom} /></Row>
          <FontPicker
            title="UI 字型"
            hint="選單、分頁、按鈕、標題列、側邊欄的檔案和卡片名稱、欄位名稱、對話框這些介面的字"
            fallback={{ family: DEFAULT_UI_FONT, style: 'Segoe UI ＋ 微軟正黑體' }}
            value={s.uiFontFamily}
            onChange={(uiFontFamily) => updateSettings({ uiFontFamily })}
          />
            </>
          )}
          {cat === 'text' && (
            <>
              <div className="settings-note">「內容文字」是你寫的字：劇本、欄位內容、詳細內容、卡片編輯頁和放大檢視的卡片名稱、記憶、搜尋找到的那一段。字型大家共用；大小每個區域各自調整，改「UI 大小」也不會改到這裡的文字。</div>
              <FontPicker
                title="內容字型"
                hint="劇本裡 # 開頭的指令照舊用等寬字型"
                fallback={{ family: DEFAULT_FONT_FAMILY, style: '劇本：Cascadia Code ＋ 微軟正黑體；其他：Segoe UI ＋ 微軟正黑體' }}
                value={s.scriptFontFamily}
                onChange={(scriptFontFamily) => updateSettings({ scriptFontFamily })}
              />
              {fontRow('scriptFontSize', '劇本', '劇本編輯器的文字')}
              {fontRow('sidebarFontSize', '左邊區域', '側邊欄的檔案、卡片清單、展開的欄位，和浮動視窗')}
              {fontRow('cardFontSize', '設定卡', '卡片編輯頁的欄位和詳細內容')}
              {fontRow('viewerFontSize', '放大檢視', '卡片放大視窗的內容')}
            </>
          )}
          {cat === 'script' && (
            <>
          <Row label="Notion 式劇本編輯器" hint="標題、標音直接顯示效果，看不到符號；關掉就改回原本的程式碼式編輯器"><Toggle checked={s.richScript} onChange={(v) => updateSettings({ richScript: v })} /></Row>
          {s.richScript ? (
            <div className="settings-note">「自動換行」和「小地圖」只有程式碼式編輯器才有，關掉上面的 Notion 式劇本編輯器就會出現。</div>
          ) : (
            <>
          <Row label="自動換行" hint="只有程式碼式編輯器有效"><Toggle checked={s.wordWrap} onChange={(v) => updateSettings({ wordWrap: v })} /></Row>
          <Row label="小地圖" hint="右側的縮圖；只有程式碼式編輯器有效">
            <div className="settings-segment">
              {([1, 2, 3] as const).map((n) => (
                <button
                  key={n}
                  type="button"
                  className={s.minimapScale === n ? 'on' : ''}
                  disabled={!s.minimap}
                  onClick={() => updateSettings({ minimapScale: n })}
                >
                  {['小', '中', '大'][n - 1]}
                </button>
              ))}
            </div>
            <Toggle checked={s.minimap} onChange={(v) => updateSettings({ minimap: v })} />
          </Row>
            </>
          )}
            </>
          )}
          {cat === 'save' && (
            <>
          <Row label="自動存檔" hint="關掉後要按 Ctrl+S（存目前的分頁）或 Ctrl+K S（全部存檔）才會存檔">
            <Toggle checked={s.autoSave} onChange={(v) => updateSettings({ autoSave: v })} />
          </Row>
          <Row label="啟動時開啟上次的專案" hint="打開程式就直接回到上次的專案和分頁">
            <Toggle checked={s.openLastProject} onChange={(v) => updateSettings({ openLastProject: v })} />
          </Row>
            </>
          )}
          {cat === 'external' && (
            <>
              <div className="settings-note">「外部修改」= 一起寫的人（例如雲端同步）或 AI 在程式外面改了專案裡的檔案。</div>
          <Row label="外部修改時播放打字效果" hint="AI 等在程式外面改了檔案：切到那個分頁，把改動一個字一個字打出來（按任何鍵可以跳過）">
            <div className="settings-segment">
              {(['slow', 'normal', 'fast'] as const).map((v, i) => (
                <button
                  key={v}
                  type="button"
                  className={s.aiSpeed === v ? 'on' : ''}
                  disabled={!s.aiPlayback}
                  onClick={() => updateSettings({ aiSpeed: v })}
                >
                  {['慢', '中', '快'][i]}
                </button>
              ))}
            </div>
            <Toggle checked={s.aiPlayback} onChange={(v) => updateSettings({ aiPlayback: v })} />
          </Row>
          <Row label="標出外部修改" hint="一起寫的人（或 AI）在程式外面改了檔案：改到的行、欄位、段落用淡黃底標出來，側邊欄也會有黃點；按分頁上方的「清除標記」才會消失">
            <Toggle checked={s.markExternal} onChange={(v) => updateSettings({ markExternal: v })} />
          </Row>
            </>
          )}
        </div>
        </div>
        <div className="settings-footer">
          <button type="button" className="settings-btn" onClick={onResetAll}>全部恢復預設</button>
          <button type="button" className="settings-btn settings-btn-primary" onClick={onClose}>關閉</button>
        </div>
      </div>
    </div>
  );
}
