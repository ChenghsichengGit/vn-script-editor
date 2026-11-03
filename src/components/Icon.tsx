import '../icons.css';

// 一個圖示：VS Code 的線條圖示（codicon）名稱，加上可選的顏色
export interface IconDef {
  name: string; // 例如 'file-code'、'person'；可用的名稱列在 src/icons.css
  color?: string;
}

// 畫出一個 codicon 圖示。icon 可以直接給名稱字串，或給 { name, color }
export default function Icon({ icon, className, title }: { icon: IconDef | string; className?: string; title?: string }) {
  const def = typeof icon === 'string' ? { name: icon } : icon;
  return (
    <span
      className={`codicon codicon-${def.name}${className ? ` ${className}` : ''}`}
      style={def.color ? { color: def.color } : undefined}
      title={title}
      aria-hidden={title ? undefined : true}
    />
  );
}
