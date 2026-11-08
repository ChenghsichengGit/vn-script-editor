// 標音（ruby）：在文字上方標讀音或說明，寫法是 {本文|讀音}，例如 {漢字|かんじ}

const RUBY = /\{([^{}|\n]+)\|([^{}|\n]*)\}/g;

export interface RubySpan {
  start: number; // 「{」在這一行的位置（從 0 開始）
  end: number; // 「}」後面一格
  base: string;
  rt: string;
}

export function findRubies(text: string): RubySpan[] {
  const out: RubySpan[] = [];
  RUBY.lastIndex = 0;
  for (let m = RUBY.exec(text); m; m = RUBY.exec(text)) out.push({ start: m.index, end: m.index + m[0].length, base: m[1], rt: m[2] });
  return out;
}

export function rubyProblems(text: string): { start: number; end: number; message: string }[] {
  const out: { start: number; end: number; message: string }[] = [];
  const spans = findRubies(text);
  for (const r of spans) if (!r.rt.trim()) out.push({ start: r.start, end: r.end, message: '標音的讀音是空的' });
  const open = /\{[^{}|\n]*\|[^{}]*$/.exec(text.replace(RUBY, (s) => ' '.repeat(s.length)));
  if (open) out.push({ start: open.index, end: text.length, message: '標音少了「}」' });
  return out;
}

export const wrapRuby = (base: string, rt: string) => (rt.trim() ? `{${base}|${rt.trim()}}` : base);

export const rubyToTmp = (text: string) => text.replace(RUBY, (_s, base: string, rt: string) => `<r=${rt}>${base}</r>`);
export const stripRuby = (text: string) => text.replace(RUBY, (_s, base: string) => base);
