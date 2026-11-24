import { parseBlocks } from '../listText';
import InlineText from './InlineText';

export default function FieldText({ text, className }: { text: string; className?: string }) {
  return (
    <span className={`field-text${className ? ` ${className}` : ''}`}>
      {parseBlocks(text).map((b, i) =>
        b.kind === 'text' ? (
          <span key={i} className="field-text-plain"><InlineText text={b.text} /></span>
        ) : (
          <span key={i} className={`field-list${b.ordered ? ' ordered' : ''}`}>
            {b.items.map((it, j) => (
              <span key={j} className="field-list-item">
                <span className="field-list-marker">{it.ordered ? `${it.num}.` : '•'}</span>
                <span className="field-list-text"><InlineText text={it.text} /></span>
              </span>
            ))}
          </span>
        ),
      )}
    </span>
  );
}
