import { FIELD_COLORS, FIELD_ICONS } from '../fieldIcons';
import Icon from './Icon';

export default function IconPicker({ x, y, icon, color, allowNone, extraIcons = [], onChange, onClose }: {
  x: number;
  y: number;
  icon?: string;
  color?: string;
  allowNone: boolean;
  extraIcons?: [string, string][];
  onChange: (patch: { icon?: string; color?: string }) => void;
  onClose: () => void;
}) {
  const icons = [...extraIcons.filter(([n]) => !FIELD_ICONS.some(([m]) => m === n)), ...FIELD_ICONS];
  return (
    <div
      className="icon-picker-layer"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="icon-picker" style={{ left: x, top: y }}>
        <div className="icon-picker-label">圖示</div>
        <div className="icon-picker-grid">
          {allowNone && (
            <button type="button" className={`icon-picker-cell none${!icon ? ' on' : ''}`} title="無圖示" onClick={() => onChange({ icon: undefined })}>
              無
            </button>
          )}
          {icons.map(([name, label]) => (
            <button
              type="button"
              key={name}
              className={`icon-picker-cell${icon === name ? ' on' : ''}`}
              title={label}
              onClick={() => onChange({ icon: name })}
            >
              <Icon icon={{ name, color: color ? `var(--pal-${color})` : undefined }} />
            </button>
          ))}
        </div>
        <div className="icon-picker-label">顏色</div>
        <div className="icon-picker-colors">
          <button
            type="button"
            className={`icon-picker-swatch default${!color ? ' on' : ''}`}
            title="預設（跟文字同色）"
            onClick={() => onChange({ color: undefined })}
          />
          {FIELD_COLORS.map(([name, label]) => (
            <button
              type="button"
              key={name}
              className={`icon-picker-swatch${color === name ? ' on' : ''}`}
              title={label}
              style={{ background: `var(--pal-${name})` }}
              onClick={() => onChange({ color: name, ...(icon ? {} : { icon: 'tag' }) })}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function pickerPosition(button: HTMLElement): { x: number; y: number } {
  const box = button.getBoundingClientRect();
  const PANEL_H = 280;
  const y = box.bottom + 4 + PANEL_H > window.innerHeight ? Math.max(8, box.top - 4 - PANEL_H) : box.bottom + 4;
  return { x: box.left, y };
}
