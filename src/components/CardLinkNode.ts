// 卡片連結：詳細內容裡寫 [[卡片名稱]]，顯示成帶區塊圖示的小標籤；找不到這張卡時畫成紅色虛線
// 寫資源的名稱（[[桃花_常服_一般]]）會顯示成帶縮圖的備註名稱，點了開啟資源的編輯分頁
// 閱讀（側邊欄、放大檢視）點一下打開那張卡的放大檢視；編輯頁要 Ctrl＋點，雙擊可以改連到哪張卡
import { InputRule, Node, type Editor } from '@tiptap/core';
import { NodeSelection, Plugin } from '@tiptap/pm/state';
import type MarkdownIt from 'markdown-it';
import { onLinkCardsChange, openLinkedCard, resolveCardLink } from '../cardLinks';
import { openRubyPrompt } from './RubyPrompt';
import { assetNamed, assetTitle, onAssetsChange, openAsset } from '../assets';
import { imageSrc } from '../images';

const LINK_TEXT = /\[\[([^[\]\n]+)\]\]/;

// Markdown → 文件：[[名稱]] 先變成 <span data-card-link="名稱">名稱</span>，再由 parseHTML 讀成連結
function cardLinkPlugin(md: MarkdownIt) {
  md.inline.ruler.before('link', 'card_link', (state, silent) => {
    if (state.src.charCodeAt(state.pos) !== 0x5b || state.src.charCodeAt(state.pos + 1) !== 0x5b) return false; // [[
    const m = new RegExp('^' + LINK_TEXT.source).exec(state.src.slice(state.pos));
    if (!m || !m[1].trim()) return false;
    if (!silent) {
      state.push('card_link_open', 'span', 1).attrs = [['data-card-link', m[1].trim()]];
      state.push('text', '', 0).content = m[1].trim();
      state.push('card_link_close', 'span', -1);
    }
    state.pos += m[0].length;
    return true;
  });
}

export const CardLinkNode = Node.create({
  name: 'cardLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => ({ name: { default: '', rendered: false, parseHTML: () => null } }),
  extendNodeSchema: () => ({ leafText: (node: { attrs: Record<string, string> }) => `[[${node.attrs.name}]]` }),
  parseHTML: () => [{ tag: 'span[data-card-link]', getAttrs: (el) => ({ name: el.getAttribute('data-card-link') ?? '' }) }],
  renderHTML: ({ node }) => ['span', { 'data-card-link': node.attrs.name, class: 'card-link' }, node.attrs.name],
  renderText: ({ node }) => `[[${node.attrs.name}]]`,
  addNodeView() {
    return ({ node, editor }) => {
      const dom = document.createElement('span');
      const icon = document.createElement('span');
      const label = document.createElement('span');
      dom.append(icon, label);
      dom.setAttribute('data-card-link', node.attrs.name);
      let name: string = node.attrs.name;
      const thumb = document.createElement('img');
      thumb.className = 'card-link-thumb';
      thumb.alt = '';
      thumb.draggable = false;
      thumb.onerror = () => (thumb.style.display = 'none');
      const paint = () => {
        const hit = resolveCardLink(name);
        const asset = hit ? undefined : assetNamed(name); // 不是卡片的話看看是不是資源
        thumb.remove();
        if (asset) {
          dom.className = 'card-link asset-link';
          icon.className = asset.image ? '' : 'codicon codicon-file-media';
          icon.style.color = '';
          if (asset.image) {
            thumb.style.display = '';
            thumb.src = imageSrc(asset.path);
            dom.insertBefore(thumb, label);
          }
          label.textContent = assetTitle(asset);
          dom.title = `${asset.note ? `${asset.note}（${asset.name}）` : asset.name}\n${editor.isEditable ? 'Ctrl＋點一下開啟這個資源，雙擊改連到哪裡' : '點一下開啟這個資源'}`;
          return;
        }
        dom.className = `card-link${hit ? '' : ' missing'}`;
        icon.className = hit ? `codicon codicon-${hit.icon.name}` : 'codicon codicon-link';
        icon.style.color = hit?.icon.color ?? '';
        label.textContent = name;
        dom.title = hit
          ? editor.isEditable ? `Ctrl＋點一下看「${name}」，雙擊改連到哪張卡` : `看「${name}」`
          : `找不到「${name}」這張卡或資源`;
      };
      paint();
      const offs = [onLinkCardsChange(paint), onAssetsChange(paint)];
      const off = () => offs.forEach((f) => f());
      return {
        dom,
        update: (next) => {
          if (next.type.name !== 'cardLink') return false;
          name = next.attrs.name;
          paint();
          return true;
        },
        destroy: off,
      };
    };
  },
  addStorage: () => ({
    markdown: {
      serialize: (state: { write: (s: string) => void }, node: { attrs: { name: string } }) => state.write(`[[${node.attrs.name}]]`),
      parse: { setup: (markdownit: MarkdownIt) => markdownit.use(cardLinkPlugin) },
    },
  }),
  addInputRules() {
    const type = this.type;
    return [
      new InputRule({
        find: new RegExp(LINK_TEXT.source + '$'),
        handler: ({ state, range, match }) => {
          if (!match[1].trim() || !state.doc.resolve(range.from).parent.type.contentMatch.matchType(type)) return null;
          state.tr.replaceWith(range.from, range.to, type.create({ name: match[1].trim() }));
        },
      }),
    ];
  },
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            click: (view, event) => {
              const el = (event.target as HTMLElement | null)?.closest?.('[data-card-link]');
              if (!el) return false;
              if (view.editable && !(event.ctrlKey || event.metaKey)) return false; // 編輯中一般點擊 = 選取
              event.preventDefault();
              const name = el.getAttribute('data-card-link') ?? '';
              const asset = resolveCardLink(name) ? undefined : assetNamed(name);
              if (asset) openAsset(asset.path);
              else openLinkedCard(name);
              return true;
            },
          },
          handleDoubleClickOn: (view, pos, node) => {
            if (node.type.name !== 'cardLink' || !view.editable) return false;
            view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
            promptCardLink(editor, pos);
            return true;
          },
        },
      }),
    ];
  },
});

// 改連到哪張卡；清空 = 換回一般文字
function promptCardLink(editor: Editor, pos: number) {
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return;
  const at = editor.view.coordsAtPos(pos);
  openRubyPrompt({
    x: at.left,
    y: at.bottom + 6,
    base: '連到',
    rt: node.attrs.name,
    placeholder: '卡片名稱',
    submitLabel: '確定',
    onSubmit: (value) => {
      const { state } = editor;
      const range = { from: pos, to: pos + node.nodeSize };
      const tr = value
        ? state.tr.replaceWith(range.from, range.to, node.type.create({ name: value }))
        : state.tr.replaceWith(range.from, range.to, state.schema.text(node.attrs.name));
      editor.view.dispatch(tr);
    },
    onClose: () => editor.commands.focus(),
  });
}
