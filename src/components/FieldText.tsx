import { parseBlocks } from '../listText';

// 顯示欄位內容：一般文字照原本的換行；條列（行首「- 」「1. 」）畫成清單
// 記號（• 或 1.）往左突出，項目文字對齊；一項太長折行時，第二行對齊這一項的文字
export default function FieldText({ text, className }: { text: string; className?: string }) {
  return (
    <span className={`field-text${className ? ` ${className}` : ''}`}>
      {parseBlocks(text).map((b, i) =>
        b.kind === 'text' ? (
          <span key={i} className="field-text-plain">
            {b.text}
          </span>
        ) : (
          <span key={i} className={`field-list${b.ordered ? ' ordered' : ''}`}>
            {b.items.map((it, j) => (
              <span key={j} className="field-list-item">
                <span className="field-list-marker">{it.ordered ? `${it.num}.` : '•'}</span>
                <span className="field-list-text">{it.text}</span>
              </span>
            ))}
          </span>
        ),
      )}
    </span>
  );
}
