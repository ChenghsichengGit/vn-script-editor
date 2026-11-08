// 劇本行尾的參數提示（灰色小標籤）和問題紅線；一個區塊就是一行
import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { checkScript, missingHint, onScriptDataChange } from '../scriptLanguage';
import { lineOf } from '../vnsDoc';

// 區塊內容的一段：cols 是寫回 .vns 的字數，size 是編輯器裡佔的位置數（文字相同、標音 cols 為 {本文|讀音} 長度而 size 為 1）
export type Part = { cols: number; size: number; atom: boolean };

// 內文欄位（0 起算，在 body 裡）→ 區塊內容位置；落在標音裡面時，起點取標音前、終點取標音後
export function columnToOffset(parts: Part[], col: number, end: boolean): number {
  let cs = 0;
  let pos = 0;
  for (const p of parts) {
    const ce = cs + p.cols;
    if (col <= cs) return pos;
    if (col < ce) return p.atom ? (end ? pos + p.size : pos) : pos + (col - cs);
    cs = ce;
    pos += p.size;
  }
  return pos;
}

function partsOf(node: PMNode): { parts: Part[]; body: number } {
  const parts: Part[] = [];
  let body = 0;
  node.forEach((c) => {
    const atom = c.type.name === 'ruby';
    const cols = atom ? `{${c.attrs.base}|${c.attrs.rt}}`.length : (c.text?.length ?? 0);
    parts.push({ cols, size: c.nodeSize, atom });
    body += cols;
  });
  return { parts, body };
}

const key = new PluginKey('vnsDiagnostics');

function hintWidget(label: string, more: number) {
  return () => {
    const el = document.createElement('span');
    el.className = 'vns-hint-chip';
    el.contentEditable = 'false';
    const a = document.createElement('span');
    a.className = 'vns-hint-label';
    a.textContent = label;
    el.appendChild(a);
    if (more > 0) {
      const b = document.createElement('span');
      b.className = 'vns-hint-more';
      b.textContent = `+${more}`;
      el.appendChild(b);
    }
    return el;
  };
}

function compute(doc: PMNode): DecorationSet {
  const decos: Decoration[] = [];
  const lines: string[] = [];
  const blocks: { node: PMNode; start: number }[] = [];
  doc.forEach((node, start) => {
    lines.push(lineOf(node));
    blocks.push({ node, start });
  });
  blocks.forEach(({ node, start }, i) => {
    if (node.type.name !== 'vnsCommand') return;
    const hint = missingHint(lines[i]);
    if (!hint) return;
    const slash = lines[i].indexOf('//');
    const at = Math.min(slash < 0 ? lines[i].length : slash, node.content.size);
    decos.push(
      Decoration.widget(start + 1 + at, hintWidget(hint.label, hint.more), {
        side: 1,
        ignoreSelection: true,
        key: `h${hint.label}\u0000${hint.more}`,
      }),
    );
  });
  for (const p of checkScript(lines)) {
    const b = blocks[p.line - 1];
    if (!b) continue;
    const { parts, body } = partsOf(b.node);
    const prefix = lines[p.line - 1].length - body;
    const attrs = { class: 'vns-problem', title: p.message };
    let from = Math.max(0, p.startColumn - 1 - prefix);
    let to = Math.min(body, p.endColumn - 1 - prefix);
    if (to <= from) {
      // 空範圍：至少一個字，還是沒有就整個區塊
      from = Math.min(from, body - 1);
      to = from + 1;
    }
    if (body === 0 || from < 0 || to > body) {
      decos.push(Decoration.node(b.start, b.start + b.node.nodeSize, attrs));
      continue;
    }
    const a = b.start + 1 + columnToOffset(parts, from, false);
    const z = b.start + 1 + columnToOffset(parts, to, true);
    if (z > a) decos.push(Decoration.inline(a, z, attrs));
    else decos.push(Decoration.node(b.start, b.start + b.node.nodeSize, attrs));
  }
  return DecorationSet.create(doc, decos);
}

export const VnsDiagnostics = Extension.create({
  name: 'vnsDiagnostics',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key,
        state: {
          init: (_, state) => compute(state.doc),
          apply: (tr, old, _o, state) => (tr.docChanged || tr.getMeta(key) ? compute(state.doc) : old),
        },
        props: { decorations: (state) => key.getState(state) },
        view: (view) => {
          const off = onScriptDataChange(() => {
            if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(key, true));
          });
          return { destroy: off };
        },
      }),
    ];
  },
});
