import { useEffect, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_FONT_FAMILY, LIMITS, resetSettings, updateSettings, useSettings } from '../settings';
import './SettingsDialog.css';

// 一列設定：左邊標籤（可帶一行小提示），右邊放控制項
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

// 開關：用 checkbox 當底，外觀畫成滑動開關
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="settings-switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="settings-switch-track" />
    </label>
  );
}

// 數字輸入：打字時先存在本地字串，讓使用者可以清空重打；失焦或 Enter 才寫進設定
function NumberField({
  value,
  min,
  max,
  step,
  onCommit,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onCommit: (v: number) => void;
}) {
  const [text, setText] = useState(String(value));

  // 設定從別的地方變動（按鈕、Ctrl＋滾輪、恢復預設）時，同步輸入框的內容
  useEffect(() => setText(String(value)), [value]);

  const commit = () => {
    const n = parseFloat(text);
    if (Number.isFinite(n)) onCommit(n);
    // 不論有沒有寫入，都把輸入框拉回實際的值（被夾回範圍或輸入無效時）
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
      <button type="button" onClick={() => onCommit(value + step)} disabled={value >= max}>
        ＋
      </button>
    </div>
  );
}

// UI 大小的拉桿：拖曳中只更新旁邊的百分比，放開滑鼠（或放開方向鍵）才真的縮放
// 一邊拖一邊縮放的話，拉桿自己也會跟著變大變小、從滑鼠底下跑掉，數值就會在兩格之間來回跳
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
        // 取到小數一位，避免浮點誤差（1.1000000000000001）
        onChange={(e) => setDraft(Math.round(parseFloat(e.target.value) * 10) / 10)}
        // 滑鼠可能在拉桿外面放開，所以聽整個視窗的放開事件
        onPointerDown={() => window.addEventListener('pointerup', commit, { once: true })}
        onKeyUp={commit}
        onBlur={commit}
      />
      <span className="settings-value">{Math.round(shown * 100)}%</span>
    </>
  );
}

export default function SettingsDialog({ onClose }: { onClose: () => void }) {
  const s = useSettings();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onReset = () => {
    if (window.confirm('確定要把所有設定恢復成預設值嗎？')) resetSettings();
  };

  return (
    // 只有直接點在背景上才關閉（點到面板內不算）
    <div
      className="settings-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="settings-panel" role="dialog" aria-label="設定">
        <div className="settings-header">
          <span className="settings-title">設定</span>
          <button type="button" className="settings-close" onClick={onClose} title="關閉">
            ×
          </button>
        </div>

        <div className="settings-body">
          <div className="settings-group">外觀</div>
          <Row label="顏色主題" hint="整個程式和劇本編輯器一起換色">
            <div className="settings-segment">
              {(['dark', 'light', 'hc'] as const).map((v, i) => (
                <button key={v} type="button" className={s.theme === v ? 'on' : ''} onClick={() => updateSettings({ theme: v })}>
                  {['深色', '淺色', '高對比'][i]}
                </button>
              ))}
            </div>
          </Row>
          <Row label="UI 大小" hint="整個程式一起放大縮小">
            <ZoomSlider value={s.uiZoom} />
          </Row>

          <div className="settings-group">劇本編輯器</div>
          <Row label="文字大小" hint="在劇本裡按住 Ctrl 滾滑鼠滾輪也可以調整">
            <NumberField
              value={s.scriptFontSize}
              {...LIMITS.scriptFontSize}
              onCommit={(v) => updateSettings({ scriptFontSize: v })}
            />
          </Row>
          <Row label="字型" hint="輸入字型名稱，例如 微軟正黑體；空白 = 預設">
            <input
              type="text"
              className="settings-text"
              value={s.scriptFontFamily}
              placeholder={`預設（${DEFAULT_FONT_FAMILY}）`}
              title={DEFAULT_FONT_FAMILY}
              onChange={(e) => updateSettings({ scriptFontFamily: e.target.value })}
            />
          </Row>
          <Row label="自動換行">
            <Toggle checked={s.wordWrap} onChange={(v) => updateSettings({ wordWrap: v })} />
          </Row>
          <Row label="小地圖" hint="右側的縮圖">
            {/* 大小：小／中／大 = 放大 1／2／3 倍；關掉小地圖時不能選 */}
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

          <div className="settings-group">設定卡</div>
          <Row label="內文大小">
            <NumberField
              value={s.cardFontSize}
              {...LIMITS.cardFontSize}
              onCommit={(v) => updateSettings({ cardFontSize: v })}
            />
          </Row>

          <div className="settings-group">其他</div>
          <Row label="自動存檔" hint="關掉後要按 Ctrl+S（存目前的分頁）或 Ctrl+K S（全部存檔）才會存檔">
            <Toggle checked={s.autoSave} onChange={(v) => updateSettings({ autoSave: v })} />
          </Row>
          <Row label="啟動時開啟上次的專案" hint="打開程式就直接回到上次的專案和分頁">
            <Toggle checked={s.openLastProject} onChange={(v) => updateSettings({ openLastProject: v })} />
          </Row>
          <Row label="外部修改時播放打字效果" hint="AI 等在程式外面改了檔案：切到那個分頁，把改動一個字一個字打出來（按任何鍵可以跳過）">
            {/* 速度：慢／中／快；關掉打字效果時不能選 */}
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
        </div>

        <div className="settings-footer">
          <button type="button" className="settings-btn" onClick={onReset}>
            全部恢復預設
          </button>
          <button type="button" className="settings-btn settings-btn-primary" onClick={onClose}>
            關閉
          </button>
        </div>
      </div>
    </div>
  );
}
