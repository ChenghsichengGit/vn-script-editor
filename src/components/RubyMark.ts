// 標音（ruby）：本文和讀音是一個整體（用瀏覽器內建的 <ruby> 排版，讀音置中在字的正上方）
// 存成 {本文|讀音}；打字打出這個寫法也會自動變成標音。點一下標音可以改讀音或拿掉
import { InputRule, Node, type Editor } from '@tiptap/core';
import { NodeSelection, Plugin } from '@tiptap/pm/state';
import type MarkdownIt from 'markdown-it';
import { openRubyPrompt } from './RubyPrompt';

const RUBY_TEXT = /\{([^{}|\n]+)\|([^{}|\n]+)\}/;

// Markdown → 文件：{本文|讀音} 先變成 <span data-rt="讀音">本文</span>，再由 parseHTML 讀成標音
function rubyPlugin(md: MarkdownIt) {
  md.inline.ruler.before('emphasis', 'ruby', (state, silent) => {
    if (state.src.charCodeAt(state.pos) !== 0x7b) return false; // {
    const m = new RegExp('^' + RUBY_TEXT.source).exec(state.src.slice(state.pos));
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

const attr = { default: '', rendered: false, parseHTML: () => null };

export const RubyNode = Node.create({
  name: 'ruby',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => ({ base: attr, rt: attr }),
  extendNodeSchema: () => ({ leafText: (node: { attrs: Record<string, string> }) => node.attrs.base }),
  parseHTML: () => [
    { tag: 'span[data-rt]', getAttrs: (el) => ({ base: el.textContent ?? '', rt: el.getAttribute('data-rt') ?? '' }) },
    {
      tag: 'ruby',
      getAttrs: (el) => {
        const rt = el.querySelector('rt')?.textContent ?? '';
        const base = [...el.childNodes].filter((n) => n.nodeName !== 'RT' && n.nodeName !== 'RP').map((n) => n.textContent).join('');
        return { base, rt };
      },
    },
  ],
  renderHTML: ({ node }) => ['ruby', { class: 'ruby' }, node.attrs.base, ['rt', {}, node.attrs.rt]],
  renderText: ({ node }) => node.attrs.base,
  addStorage: () => ({
    markdown: {
      serialize: (state: { write: (s: string) => void }, node: { attrs: { base: string; rt: string } }) => state.write(`{${node.attrs.base}|${node.attrs.rt}}`),
      parse: { setup: (markdownit: MarkdownIt) => markdownit.use(rubyPlugin) },
    },
  }),
  addInputRules() {
    const type = this.type;
    return [
      new InputRule({
        find: new RegExp(RUBY_TEXT.source + '$'),
        handler: ({ state, range, match }) => {
          if (!state.doc.resolve(range.from).parent.type.contentMatch.matchType(type)) return null; // 指令、註解裡照原文
          state.tr.replaceWith(range.from, range.to, type.create({ base: match[1], rt: match[2] }));
        },
      }),
    ];
  },
  addKeyboardShortcuts() {
    return { 'Mod-Shift-r': () => (promptRuby(this.editor), true) };
  },
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        props: {
          // 點一下標音：選起來並打開讀音輸入框
          handleClickOn: (view, pos, node) => {
            if (node.type.name !== 'ruby' || !view.editable) return false;
            view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
            promptRuby(editor);
            return true;
          },
        },
      }),
    ];
  },
});

// 「標音」：選取的文字變成標音；游標在標音上（或選了一個標音）就改它的讀音，清空 = 拿掉
export function promptRuby(editor: Editor) {
  const { state, view } = editor;
  const type = state.schema.nodes.ruby;
  const sel = state.selection;
  const near = sel instanceof NodeSelection ? (sel.node.type === type ? sel.from : null) : sel.empty ? (sel.$from.nodeAfter?.type === type ? sel.from : sel.$from.nodeBefore?.type === type ? sel.from - 1 : null) : null;
  const node = near !== null ? state.doc.nodeAt(near) : null;
  const range = node ? { from: near!, to: near! + node.nodeSize } : sel.empty ? null : { from: sel.from, to: sel.to };
  if (!range) return;
  const base = node ? node.attrs.base : state.doc.textBetween(range.from, range.to, '');
  if (!base.trim() || /[{}|\n]/.test(base)) return;
  const $from = state.doc.resolve(range.from);
  if (!node && !$from.parent.type.contentMatch.matchType(type)) return; // 這一行不能放標音（指令、註解）
  const at = view.coordsAtPos(range.from);
  openRubyPrompt({
    x: at.left,
    y: at.bottom + 6,
    base,
    rt: node?.attrs.rt ?? '',
    onSubmit: (rt) => {
      const tr = editor.state.tr.replaceWith(range.from, range.to, rt ? type.create({ base, rt }) : editor.state.schema.text(base));
      editor.view.dispatch(tr);
    },
    onClose: () => editor.commands.focus(),
  });
}
