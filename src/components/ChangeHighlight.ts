import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';

// 詳細內容裡「被別人（外部）改過的段落」：最上層的區塊（段落、標題、整個條列、圖片）整塊加淡黃底
// 標記跟著內容移動；你自己在某一塊裡打字，那一塊的標記就消失
// 要標哪幾塊由外面決定（setChangedBlocks），標記一變就呼叫 onChange 回報目前是第幾塊（存回 changeMarks）

interface HighlightState {
  set: DecorationSet;
  silent: boolean; // 外部整份換掉內容的那一步：標記先清空、馬上會重新設定，這一步不回報
}

export const changeKey = new PluginKey<HighlightState>('changeHighlight');

// 第幾塊（最上層的第 i 個區塊）→ 標記
function decorate(doc: PMNode, blocks: number[]): DecorationSet {
  const want = new Set(blocks);
  const decos: Decoration[] = [];
  doc.forEach((node, offset, i) => {
    if (want.has(i)) decos.push(Decoration.node(offset, offset + node.nodeSize, { class: 'ext-changed-block' }));
  });
  return DecorationSet.create(doc, decos);
}

// 目前有標記的是第幾塊
export function changedBlocks(doc: PMNode, set: DecorationSet): number[] {
  const starts = new Set(set.find().map((d) => d.from));
  const out: number[] = [];
  doc.forEach((_node, offset, i) => {
    if (starts.has(offset)) out.push(i);
  });
  return out;
}

// 這次修改在新文件裡碰到的範圍（每一步的改動都換算到最後的文件位置）
function touched(tr: Transaction): [number, number][] {
  const out: [number, number][] = [];
  tr.mapping.maps.forEach((map, i) => {
    const rest = tr.mapping.slice(i + 1);
    map.forEach((_os, _oe, ns, ne) => out.push([rest.map(ns, -1), rest.map(ne, 1)]));
  });
  return out;
}

// 在交易上註記：blocks = 把標記設成這幾塊；external = 這一步是外部整份換掉內容
export const setChangedBlocksMeta = (tr: Transaction, blocks: number[]) => tr.setMeta(changeKey, { blocks });
export const externalReplaceMeta = (tr: Transaction) => tr.setMeta(changeKey, { external: true });

export interface ChangeHighlightOptions {
  onChange: (blocks: number[]) => void;
}

export const ChangeHighlight = Extension.create<ChangeHighlightOptions>({
  name: 'changeHighlight',
  addOptions() {
    return { onChange: () => {} };
  },
  addProseMirrorPlugins() {
    const report = (blocks: number[]) => this.options.onChange(blocks);
    return [
      new Plugin<HighlightState>({
        key: changeKey,
        state: {
          init: () => ({ set: DecorationSet.empty, silent: false }),
          apply(tr, prev) {
            const meta = tr.getMeta(changeKey) as { blocks?: number[]; external?: boolean } | undefined;
            if (meta?.blocks) return { set: decorate(tr.doc, meta.blocks), silent: false };
            if (meta?.external) return { set: DecorationSet.empty, silent: true };
            if (!tr.docChanged) return prev.silent ? { ...prev, silent: false } : prev;
            let set = prev.set.map(tr.mapping, tr.doc);
            for (const [from, to] of touched(tr)) set = set.remove(set.find(from, to));
            return { set, silent: false };
          },
        },
        props: {
          decorations: (state) => changeKey.getState(state)?.set,
        },
        view: () => ({
          update(view, prevState) {
            const before = changeKey.getState(prevState);
            const after = changeKey.getState(view.state);
            if (!after || after.silent || before?.set === after.set) return;
            report(changedBlocks(view.state.doc, after.set));
          },
        }),
      }),
    ];
  },
});
