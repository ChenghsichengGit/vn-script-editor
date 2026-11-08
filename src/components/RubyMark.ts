import { Mark, getMarkRange, type Editor } from '@tiptap/core';
import type MarkdownIt from 'markdown-it';
import { openRubyPrompt } from './RubyPrompt';

function rubyPlugin(md: MarkdownIt) {
  md.inline.ruler.before('emphasis', 'ruby', (state, silent) => {
    if (state.src.charCodeAt(state.pos) !== 0x7b) return false; // {
    const m = /^\{([^{}|\n]+)\|([^{}|\n]+)\}/.exec(state.src.slice(state.pos));
    if (!m) return false;
    if (!silent) {
      state.push('ruby_open', 'span', 1).attrs = [['data-rt', m[2]]];
      state.push('text', '', 0).content = m[1];
      state.push('ruby_close', 'span', -1);
    }
    state.pos += m[0].length;
    return true;
  });
}

export const RubyMark = Mark.create({
  name: 'ruby',
  inclusive: false, // 在標音後面接著打字，不會被算進標音裡
  addAttributes() {
    return { rt: { default: '', parseHTML: (el) => el.getAttribute('data-rt') ?? '', renderHTML: (attrs) => ({ 'data-rt': attrs.rt }) } };
  },
  parseHTML() {
    return [{ tag: 'span[data-rt]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', { ...HTMLAttributes, class: 'ruby' }, 0];
  },
  addStorage() {
    return {
      markdown: {
        serialize: { open: '{', close: (_state: unknown, mark: { attrs: { rt: string } }) => `|${mark.attrs.rt}}`, expelEnclosingWhitespace: true },
        parse: {
          setup(markdownit: MarkdownIt) {
            markdownit.use(rubyPlugin);
          },
        },
      },
    };
  },
  addKeyboardShortcuts() {
    return { 'Mod-Shift-r': () => (promptRuby(this.editor), true) };
  },
});

export function promptRuby(editor: Editor) {
  const { state, view } = editor;
  const type = state.schema.marks.ruby;
  const { from, to, empty } = state.selection;
  const existing = getMarkRange(state.doc.resolve(empty ? from : from + 1), type);
  const inside = existing && existing.from <= from && to <= existing.to ? existing : null;
  const range = inside ?? (empty ? null : { from, to });
  if (!range) return;
  const base = state.doc.textBetween(range.from, range.to, ' ');
  if (!base.trim()) return;
  const rt: string = inside ? (state.doc.nodeAt(inside.from)?.marks.find((m) => m.type === type)?.attrs.rt ?? '') : '';
  const at = view.coordsAtPos(range.from);
  openRubyPrompt({
    x: at.left,
    y: at.bottom + 6,
    base,
    rt,
    onSubmit: (value) => {
      const chain = editor.chain().focus().setTextSelection(range);
      (value ? chain.setMark('ruby', { rt: value }) : chain.unsetMark('ruby')).run();
    },
    onClose: () => editor.commands.focus(),
  });
}
