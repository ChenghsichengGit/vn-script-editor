import '../icons.css';

export interface IconDef {
  name: string; // 例如 'file-code'、'person'；可用的名稱列在 src/icons.css
  color?: string;
}

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

// 檔案在側邊欄的圖示：劇本、Markdown、其他
export function fileIcon(name: string): IconDef {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  if (ext === 'vns') return { name: 'file-code', color: 'var(--icon-script)' };
  if (ext === 'md') return { name: 'markdown', color: 'var(--icon-markdown)' };
  return { name: 'file' };
}
