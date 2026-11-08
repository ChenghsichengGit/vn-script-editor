// 欄位內容裡的條列：行首「- 」是 • 清單、「1. 」是編號清單（跟 Markdown 一樣，存的就是打的字）

const ITEM = /^(-|(\d+)\.) (.*)$/;

export type ListItem = { ordered: boolean; num: number; text: string };
export type TextBlock = { kind: 'text'; text: string } | { kind: 'list'; ordered: boolean; items: ListItem[] };

export function parseItem(line: string): ListItem | null {
  const m = ITEM.exec(line);
  if (!m) return null;
  return { ordered: m[1] !== '-', num: m[2] ? Number(m[2]) : 0, text: m[3] };
}

export const hasList = (text: string) => text.split('\n').some((l) => ITEM.test(l.replace(/\r$/, '')));

export function parseBlocks(text: string): TextBlock[] {
  const blocks: TextBlock[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const item = parseItem(line);
    const last = blocks[blocks.length - 1];
    if (item) {
      if (last?.kind === 'list' && last.ordered === item.ordered) last.items.push(item);
      else blocks.push({ kind: 'list', ordered: item.ordered, items: [item] });
    } else if (last?.kind === 'text') last.text += '\n' + line;
    else blocks.push({ kind: 'text', text: line });
  }
  return blocks;
}

function renumber(lines: string[], index: number): string[] {
  const out = [...lines];
  const isOrdered = (i: number) => parseItem(out[i] ?? '')?.ordered === true;
  if (!isOrdered(index)) return out;
  let start = index;
  while (start > 0 && isOrdered(start - 1)) start--;
  for (let i = start, n = 1; i < out.length && isOrdered(i); i++, n++) {
    out[i] = out[i].replace(/^\d+\./, `${n}.`);
  }
  return out;
}

export function listKey(text: string, cursor: number, key: 'Enter' | 'Backspace'): { text: string; cursor: number } | null {
  const lineStart = text.lastIndexOf('\n', cursor - 1) + 1;
  const lineEndRaw = text.indexOf('\n', cursor);
  const lineEnd = lineEndRaw < 0 ? text.length : lineEndRaw;
  const line = text.slice(lineStart, lineEnd);
  const item = parseItem(line);
  if (!item) return null;
  const markerLen = line.length - item.text.length; // 「- 」或「12. 」的長度
  const lines = text.split('\n');
  const lineIndex = text.slice(0, lineStart).split('\n').length - 1;
  if (key === 'Backspace') {
    if (cursor !== lineStart + markerLen) return null;
    lines[lineIndex] = item.text;
    const next = renumber(lines, Math.min(lineIndex + 1, lines.length - 1)).join('\n');
    return { text: next, cursor: lineStart };
  }
  if (item.text.trim() === '') {
    lines[lineIndex] = '';
    return { text: lines.join('\n'), cursor: lineStart };
  }
  const before = text.slice(0, cursor);
  const after = text.slice(cursor);
  const marker = item.ordered ? `${item.num + 1}. ` : '- ';
  const joined = before + '\n' + marker + after;
  const next = item.ordered ? renumber(joined.split('\n'), lineIndex).join('\n') : joined;
  return { text: next, cursor: before.length + 1 + marker.length };
}
