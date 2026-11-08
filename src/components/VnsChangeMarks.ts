// Notion 式劇本編輯器的外部修改標記：一行 = 一個頂層區塊，改過的行淡黃底，刪除點在區塊上緣標紅三角
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import { getLineMarks, setLineMarks, subscribeMarks, type LineMark } from '../changeMarks';

const key = new PluginKey<{ set: DecorationSet; dirty: boolean }>('vnsChangeMarks');
// 外部寫入內容（setContent 等）的 transaction 帶這個 meta，就不當成使用者編輯去清標記
export const VNS_EXTERNAL_META = 'vnsExternalChange';
const REBUILD = 'vnsChangeMarksRebuild';

function build(doc: PMNode, fileId: string): DecorationSet {
  const kinds = new Map<number, { add?: boolean; del?: boolean }>();
  for (const m of getLineMarks(fileId)) kinds.set(m.line - 1, { ...kinds.get(m.line - 1), [m.kind]: true });
  const decos: Decoration[] = [];
  doc.forEach((node, offset, i) => {
    const k = kinds.get(i);
    if (!k) return;
    const cls = [k.add && 'ext-changed-line', k.del && 'ext-del-before'].filter(Boolean).join(' ');
    decos.push(Decoration.node(offset, offset + node.nodeSize, { class: cls }, k));
  });
  return DecorationSet.create(doc, decos);
}

function linesOf(doc: PMNode, set: DecorationSet): LineMark[] {
  const idx = new Map<number, number>();
  doc.forEach((_n, offset, i) => idx.set(offset, i));
  const out: LineMark[] = [];
  for (const d of set.find()) {
    const i = idx.get(d.from);
    if (i === undefined) continue;
    const k = (d as unknown as { spec: { add?: boolean; del?: boolean } }).spec;
    if (k.add) out.push({ line: i + 1, kind: 'add' });
    if (k.del) out.push({ line: i + 1, kind: 'del' });
  }
  return out.sort((a, b) => a.line - b.line);
}

const same = (a: LineMark[], b: LineMark[]) => a.length === b.length && a.every((m, i) => m.line === b[i].line && m.kind === b[i].kind);

export const VnsChangeMarks = Extension.create<{ fileId: string }>({
  name: 'vnsChangeMarks',
  addOptions: () => ({ fileId: '' }),
  addProseMirrorPlugins() {
    const { fileId } = this.options;
    return [
      new Plugin({
        key,
        state: {
          init: (_c, state) => ({ set: build(state.doc, fileId), dirty: false }),
          apply(tr, value) {
            if (tr.getMeta(REBUILD)) return { set: build(tr.doc, fileId), dirty: false };
            if (!tr.docChanged) return value;
            let set = value.set.map(tr.mapping, tr.doc);
            if (tr.getMeta(VNS_EXTERNAL_META) || tr.getMeta('vnsPlayback')) return { set, dirty: false };
            // 使用者改到的區塊：清掉那行的標記
            const hit = new Set<Decoration>();
            tr.mapping.maps.forEach((map, i) => {
              const rest = tr.mapping.slice(i + 1);
              map.forEach((_a, _b, ns, ne) => {
                const s = rest.map(ns, -1);
                const e = rest.map(ne, 1);
                for (const d of set.find()) if (d.from < e && d.to > s) hit.add(d);
              });
            });
            if (hit.size > 0) set = set.remove([...hit]);
            return { set, dirty: true };
          },
        },
        props: { decorations: (state) => key.getState(state)?.set },
        view(view) {
          const unsub = subscribeMarks(() => {
            const cur = key.getState(view.state);
            if (!cur || same(linesOf(view.state.doc, cur.set), getLineMarks(fileId))) return;
            view.dispatch(view.state.tr.setMeta(REBUILD, true).setMeta('addToHistory', false));
          });
          return {
            update(v, prev) {
              const cur = key.getState(v.state);
              if (cur?.dirty && v.state !== prev) setLineMarks(fileId, linesOf(v.state.doc, cur.set));
            },
            destroy: unsub,
          };
        },
      }),
    ];
  },
});
