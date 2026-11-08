// .vns 編輯器（TipTap）的打字效果：以「一行＝一個區塊」為單位，把目前內容一段一段改成新內容
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { DELETE_PAUSE, diffLines, findEditor, MAX_TICKS, TICK, wait, type PlaybackSpeed } from '../aiPlayback';
import { blockOf, docToVns, vnsToDoc } from '../vnsDoc';

export interface VnsPlayer {
  el: () => HTMLElement;
  play: (newText: string, speed: PlaybackSpeed) => Promise<void>;
}

const players = new Map<string, VnsPlayer>();

export function registerVnsPlayer(fileId: string, player: VnsPlayer): () => void {
  players.set(fileId, player);
  return () => {
    if (players.get(fileId) === player) players.delete(fileId);
  };
}

export function findVnsPlayer(fileId: string): VnsPlayer | undefined {
  const p = players.get(fileId);
  return p && p.el().offsetParent !== null ? p : undefined;
}

// 同時等 Monaco 和 .vns 編輯器，哪個先出現就用哪個
export async function waitForPlayback(fileId: string) {
  for (let tries = 0; tries < 30; tries++) {
    const player = findVnsPlayer(fileId);
    if (player) return { player };
    const editor = findEditor(fileId);
    if (editor) return { editor };
    await wait(50);
  }
  return null;
}

export function createVnsPlayer(editor: Editor, eol: () => string): VnsPlayer {
  const splitLines = (t: string) => t.split(/\r?\n/);
  const posOf = (doc: PMNode, index: number) => {
    let pos = 0;
    for (let i = 0; i < index && i < doc.childCount; i++) pos += doc.child(i).nodeSize;
    return pos;
  };
  const apply = (fn: (tr: ReturnType<Editor['state']['tr']['setMeta']>) => void) => {
    const tr = editor.state.tr;
    fn(tr);
    editor.view.dispatch(tr.setMeta('vnsPlayback', true).setMeta('addToHistory', false));
  };
  const domOf = (index: number) => {
    const n = editor.view.nodeDOM(posOf(editor.state.doc, index));
    return n instanceof HTMLElement ? n : null;
  };
  const reveal = (index: number) => {
    const el = domOf(index);
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.top < 0 || r.bottom > window.innerHeight) el.scrollIntoView({ block: 'center' });
  };

  const play = async (newText: string, speed: PlaybackSpeed) => {
    const schema = editor.schema;
    const oldLines = splitLines(docToVns(editor.state.doc, eol()));
    const newLines = splitLines(newText);
    const hunks = diffLines(oldLines, newLines);
    if (hunks.length === 0) return;
    let skip = false;
    const stop = () => (skip = true);
    window.addEventListener('keydown', stop, true);
    window.addEventListener('mousedown', stop, true);
    editor.setEditable(false, false);
    try {
      let shift = 0; // 前面幾段造成的行數差
      for (const h of hunks) {
        if (skip) break;
        const at = h.oldStart + shift;
        reveal(Math.min(at, editor.state.doc.childCount - 1));
        let reuse = false; // 整份都被刪光時，留一個空區塊給新內容用
        if (h.oldCount > 0) {
          for (let i = 0; i < h.oldCount; i++) domOf(at + i)?.classList.add('vns-ai-delete');
          await wait(DELETE_PAUSE[speed]);
          for (let i = 0; i < h.oldCount; i++) domOf(at + i)?.classList.remove('vns-ai-delete');
          const doc = editor.state.doc;
          const from = posOf(doc, at);
          const to = posOf(doc, at + h.oldCount);
          if (h.oldCount >= doc.childCount) {
            apply((tr) => tr.replaceWith(from, to, schema.nodes.paragraph.create()));
            reuse = true;
          } else apply((tr) => tr.delete(from, to));
        }
        const lines = newLines.slice(h.newStart, h.newStart + h.newCount);
        const total = lines.reduce((n, l) => n + l.length + 1, 0);
        if (total > 0) {
          const ticks = Math.min(total, MAX_TICKS[speed]);
          const per = Math.ceil(total / ticks);
          const made = [reuse]; // 各行的區塊是否已建立
          const done: boolean[] = [];
          let typed = 0;
          while (typed < total && !skip) {
            typed = Math.min(total, typed + per);
            let left = typed;
            for (let k = 0; k < lines.length && left > 0; k++) {
              const n = Math.min(lines[k].length, left);
              left -= lines[k].length + 1;
              if (done[k]) continue;
              const index = at + k;
              const finished = n === lines[k].length;
              done[k] = finished;
              // 打完的行換成正確的區塊型態（標題、註解、指令、標音）；打到一半的先當一般文字
              const node = finished ? schema.nodeFromJSON(blockOf(lines[k])) : schema.nodes.paragraph.create(null, n > 0 ? schema.text(lines[k].slice(0, n)) : null);
              if (!made[k]) {
                made[k] = true;
                apply((tr) => tr.insert(posOf(tr.doc, index), node));
              } else apply((tr) => tr.replaceWith(posOf(tr.doc, index), posOf(tr.doc, index + 1), node));
              if (left <= 0) reveal(index);
            }
            await wait(TICK);
          }
        }
        shift += h.newCount - h.oldCount;
      }
    } finally {
      window.removeEventListener('keydown', stop, true);
      window.removeEventListener('mousedown', stop, true);
      editor.setEditable(true, false);
    }
    if (docToVns(editor.state.doc, '\n') !== newLines.join('\n')) editor.commands.setContent(vnsToDoc(newText), false);
    // 改過的行短暫亮一下
    const marked = hunks
      .filter((h) => h.newCount > 0)
      .flatMap((h) => Array.from({ length: h.newCount }, (_, i) => domOf(h.newStart + i)))
      .filter((e): e is HTMLElement => !!e);
    marked.forEach((e) => e.classList.add('vns-ai-changed'));
    setTimeout(() => {
      marked.forEach((e) => e.classList.add('vns-ai-fade'));
      setTimeout(() => marked.forEach((e) => e.classList.remove('vns-ai-changed', 'vns-ai-fade')), 1200);
    }, 1500);
  };

  return { el: () => editor.view.dom as HTMLElement, play };
}
