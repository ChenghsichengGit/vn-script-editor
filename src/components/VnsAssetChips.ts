// 劇本裡的資源參數（例如 #切換立繪 桃花 左 桃花_常服_一般）：有備註名稱的話顯示成帶縮圖的小標籤「桃花 微笑」
// 文件裡存的還是名稱；游標移到它旁邊或裡面時恢復顯示原本的名稱，方便修改
import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { EditorState, Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet, EditorView } from '@tiptap/pm/view';
import { assetArgs, onScriptDataChange } from '../scriptLanguage';
import type { Asset } from '../assets';
import { imageSrc } from '../images';

type Chip = { from: number; to: number; asset: Asset };
type ChipState = { chips: Chip[]; set: DecorationSet; open: number }; // open = 正在顯示原文的那一個（-1 = 沒有）

const key = new PluginKey<ChipState>('vnsAssetChips');

function findChips(doc: PMNode): Chip[] {
  const out: Chip[] = [];
  doc.forEach((node, offset) => {
    if (node.type.name !== 'vnsCommand') return;
    for (const a of assetArgs(node.textContent)) {
      if (a.asset.note) out.push({ from: offset + 1 + a.start, to: offset + 1 + a.end, asset: a.asset });
    }
  });
  return out;
}

function chipWidget(chip: Chip) {
  return (view: EditorView) => {
    const el = document.createElement('span');
    el.className = 'vns-asset-chip';
    el.contentEditable = 'false';
    el.title = `${chip.asset.name}（點一下修改）`;
    if (chip.asset.image) {
      const img = document.createElement('img');
      img.src = imageSrc(chip.asset.path);
      img.alt = '';
      img.draggable = false;
      img.onerror = () => img.remove();
      el.appendChild(img);
    }
    const label = document.createElement('span');
    label.textContent = chip.asset.note;
    el.appendChild(label);
    // 點一下：游標移到名稱後面，標籤就變回原文
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const { state } = view;
      const at = Math.min(chip.to, state.doc.content.size);
      view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, at)));
      view.focus();
    });
    return el;
  };
}

function build(state: EditorState, chips: Chip[]): ChipState {
  const { from, to } = state.selection;
  const open = chips.findIndex((c) => from <= c.to && to >= c.from);
  const decos: Decoration[] = [];
  chips.forEach((c, i) => {
    if (i === open) {
      decos.push(Decoration.inline(c.from, c.to, { class: 'vns-asset-open', title: c.asset.note }));
      return;
    }
    decos.push(Decoration.inline(c.from, c.to, { class: 'vns-asset-raw' }));
    decos.push(Decoration.widget(c.from, chipWidget(c), { side: -1, ignoreSelection: true, key: `a${c.asset.path}\u0000${c.asset.note}\u0000${c.from}` }));
  });
  return { chips, open, set: DecorationSet.create(state.doc, decos) };
}

export const VnsAssetChips = Extension.create({
  name: 'vnsAssetChips',
  addProseMirrorPlugins() {
    return [
      new Plugin<ChipState>({
        key,
        state: {
          init: (_, state) => build(state, findChips(state.doc)),
          apply: (tr, old, _o, state) => {
            if (tr.docChanged || tr.getMeta(key)) return build(state, findChips(state.doc));
            if (!tr.selectionSet) return old;
            const next = build(state, old.chips);
            return next.open === old.open ? old : next; // 只有開著的那個換了才重畫
          },
        },
        props: { decorations: (state) => key.getState(state)?.set },
        view: (view) => {
          // 資源、備註改了會跟著 setScriptData 通知
          const off = onScriptDataChange(() => {
            if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(key, true));
          });
          return { destroy: off };
        },
      }),
    ];
  },
});
