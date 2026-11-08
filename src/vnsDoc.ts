// 劇本（.vns）文字 ↔ Notion 式編輯器的文件：一行一個區塊，存回去時一字不差
//   = 標題（== ===，= 後面要有空白）→ 標題區塊（記住前面的縮排和 = 後面的空白）
//   //= 標題          → 標題區塊，comment: true（被註解掉的標題）
//   // 註解           → 註解區塊（整行原文照存，看得到 //）
//   #指令 參數        → 指令區塊（原文照存）
//   其他              → 一般文字，裡面的 {本文|讀音} 變成標音
import type { JSONContent } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';

const RUBY = /\{([^{}|\n]+)\|([^{}|\n]+)\}/g;
export const HEADING_LINE = /^(\s*)(\/\/)?(={1,3})(?!=)(\s+)(.*)$/;
export const isCommentText = (text: string) => /^\s*\/\//.test(text);
export const isCommandText = (text: string) => /^\s*#/.test(text);

const text = (t: string): JSONContent[] => (t ? [{ type: 'text', text: t }] : []);

// 一般文字：切出標音
export function inlineOf(line: string): JSONContent[] {
  const out: JSONContent[] = [];
  let last = 0;
  for (const m of line.matchAll(RUBY)) {
    out.push(...text(line.slice(last, m.index)), { type: 'ruby', attrs: { base: m[1], rt: m[2] } });
    last = m.index! + m[0].length;
  }
  return [...out, ...text(line.slice(last))];
}

export function blockOf(line: string): JSONContent {
  const h = HEADING_LINE.exec(line);
  if (h) return { type: 'heading', attrs: { level: h[3].length, indent: h[1], sep: h[4], comment: !!h[2] }, content: inlineOf(h[5]) };
  if (isCommentText(line)) return { type: 'vnsComment', content: text(line) };
  if (isCommandText(line)) return { type: 'vnsCommand', content: text(line) };
  return { type: 'paragraph', content: inlineOf(line) };
}

export const vnsToDoc = (source: string): JSONContent => ({ type: 'doc', content: source.split(/\r?\n/).map(blockOf) });

// 區塊裡的文字：標音寫回 {本文|讀音}
export const inlineText = (node: PMNode) => {
  let out = '';
  node.forEach((child) => (out += child.type.name === 'ruby' ? `{${child.attrs.base}|${child.attrs.rt}}` : (child.text ?? '')));
  return out;
};

export function lineOf(node: PMNode): string {
  const body = inlineText(node);
  if (node.type.name !== 'heading') return body;
  const { indent, comment, level, sep } = node.attrs;
  // sep 不能是空的，不然存回去就不是標題了
  return `${indent ?? ''}${comment ? '//' : ''}${'='.repeat(level)}${sep || ' '}${body}`;
}

export function docToVns(doc: PMNode, eol = '\n'): string {
  const lines: string[] = [];
  doc.forEach((block) => lines.push(lineOf(block)));
  return lines.join(eol);
}
