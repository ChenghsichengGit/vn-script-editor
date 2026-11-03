// 外部改動（例如 AI 改了劇本）的「打字效果」：在劇本編輯器裡把舊內容一段一段改成新內容
//   1. 比對新舊內容，找出改了哪幾段（以行為單位）
//   2. 每一段：捲過去 → 要刪掉的行先標紅一下再刪掉 → 新的字一個一個打出來
//   3. 全部打完：改到的行亮一下再淡掉
// 播放中編輯器暫時唯讀；按任何鍵或點滑鼠就直接跳到最後結果
// 播放時用 applyEdits（不進復原紀錄），最後換成「一步」完整的修改，所以按一次 Ctrl+Z 就能復原 AI 的整個改動
import monaco from './monaco';

export type PlaybackSpeed = 'slow' | 'normal' | 'fast';

// 每一段最多花幾個「格」打完（一格 20 毫秒）：越短越快；字少的就一個字一格
const MAX_TICKS: Record<PlaybackSpeed, number> = { slow: 150, normal: 70, fast: 25 };
const TICK = 20;
const DELETE_PAUSE: Record<PlaybackSpeed, number> = { slow: 500, normal: 280, fast: 120 };

// 一段改動：舊內容的第 oldStart 行起 oldCount 行，換成新內容的第 newStart 行起 newCount 行（都從 0 開始）
interface Hunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
}

// 以行為單位比對（最長共同子序列）：找出哪些行是新加的、哪些是刪掉的
function diffLines(a: string[], b: string[]): Hunk[] {
  // 前後一樣的行先去掉，中間才做完整比對（AI 通常只改一小部分，這樣快很多）
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const x = a.slice(head, a.length - tail);
  const y = b.slice(head, b.length - tail);
  const n = x.length;
  const m = y.length;
  // 太大的話不細比，整塊當成一段（避免卡住）
  if (n * m > 4_000_000) return n + m > 0 ? [{ oldStart: head, oldCount: n, newStart: head, newCount: m }] : [];
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  }
  const hunks: Hunk[] = [];
  let i = 0;
  let j = 0;
  let cur: Hunk | null = null;
  const flush = () => {
    if (cur && (cur.oldCount > 0 || cur.newCount > 0)) hunks.push(cur);
    cur = null;
  };
  while (i < n || j < m) {
    if (i < n && j < m && x[i] === y[j]) {
      flush();
      i++;
      j++;
    } else {
      cur ??= { oldStart: head + i, oldCount: 0, newStart: head + j, newCount: 0 };
      if (j < m && (i >= n || lcs[i][j + 1] >= lcs[i + 1][j])) {
        cur.newCount++;
        j++;
      } else {
        cur.oldCount++;
        i++;
      }
    }
  }
  flush();
  return hunks;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 某一行開頭在整份文字裡的位置（字元數）；超過最後一行 = 文字結尾
function lineOffset(lines: string[], line: number): number {
  let offset = 0;
  for (let k = 0; k < line && k < lines.length; k++) offset += lines[k].length + 1;
  return Math.min(offset, lines.join('\n').length);
}

// 在 editor 裡把 oldText 播放成 newText；結束後回傳（中途被打斷也會直接套用成 newText）
export async function playEdit(
  editor: monaco.editor.IStandaloneCodeEditor,
  oldText: string,
  newText: string,
  speed: PlaybackSpeed,
): Promise<void> {
  const model = editor.getModel();
  if (!model) return;
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const hunks = diffLines(oldLines, newLines);
  if (hunks.length === 0) return;

  // 按任何鍵、點滑鼠：跳過動畫
  let skip = false;
  const stop = () => (skip = true);
  window.addEventListener('keydown', stop, true);
  window.addEventListener('mousedown', stop, true);
  editor.updateOptions({ readOnly: true });
  const marks = editor.createDecorationsCollection();

  try {
    // 從上往下一段一段播；current = 播到目前為止的內容（每段的位置要用它來算）
    let current = oldLines.slice();
    let shift = 0; // 前面幾段造成的行數差
    for (const h of hunks) {
      if (skip) break;
      const at = h.oldStart + shift; // 這一段在目前內容裡從第幾行開始
      const removeText = h.oldCount > 0 ? current.slice(at, at + h.oldCount).join('\n') + (at + h.oldCount < current.length ? '\n' : '') : '';
      const insertLines = newLines.slice(h.newStart, h.newStart + h.newCount);
      let insertText = insertLines.join('\n');
      const start = lineOffset(current, at);
      // 插在中間的行要接一個換行；加在最後面（後面沒有行了）就改成前面接換行
      if (h.newCount > 0) {
        if (at + h.oldCount < current.length) insertText += '\n';
        else if (start > 0 && removeText === '') insertText = '\n' + insertText;
      }

      editor.revealLineInCenterIfOutsideViewport(Math.max(1, at + 1));
      // 要刪掉的先標紅，停一下再刪
      if (removeText) {
        const range = monaco.Range.fromPositions(model.getPositionAt(start), model.getPositionAt(start + removeText.length));
        marks.set([{ range, options: { className: 'vns-ai-delete', isWholeLine: false } }]);
        await wait(DELETE_PAUSE[speed]);
        marks.clear();
        model.applyEdits([{ range, text: '' }]);
      }
      // 新的字一格一格打出來
      if (insertText) {
        const ticks = Math.min(insertText.length, MAX_TICKS[speed]);
        const per = Math.ceil(insertText.length / ticks);
        for (let typed = 0; typed < insertText.length && !skip; typed += per) {
          const piece = insertText.slice(typed, typed + per);
          const pos = model.getPositionAt(start + typed);
          model.applyEdits([{ range: monaco.Range.fromPositions(pos, pos), text: piece }]);
          const end = model.getPositionAt(start + typed + piece.length);
          editor.setPosition(end);
          editor.revealPositionInCenterIfOutsideViewport(end);
          await wait(TICK);
        }
      }
      current = model.getValue().split('\n');
      shift += h.newCount - h.oldCount;
    }
  } finally {
    window.removeEventListener('keydown', stop, true);
    window.removeEventListener('mousedown', stop, true);
    marks.clear();
    // 換回舊內容，再用「一步」改成新內容：復原紀錄裡只有一筆（同一個步驟裡完成，畫面不會閃）
    model.applyEdits([{ range: model.getFullModelRange(), text: oldText }]);
    model.pushStackElement();
    model.pushEditOperations([], [{ range: model.getFullModelRange(), text: newText }], () => null);
    model.pushStackElement();
    editor.updateOptions({ readOnly: false });
  }

  // 改到的行亮一下，再慢慢淡掉
  const changed = hunks
    .filter((h) => h.newCount > 0)
    .map((h) => ({
      range: new monaco.Range(h.newStart + 1, 1, h.newStart + h.newCount, 1),
      options: { isWholeLine: true, className: 'vns-ai-changed' },
    }));
  const glow = editor.createDecorationsCollection(changed);
  setTimeout(() => {
    glow.set(changed.map((d) => ({ ...d, options: { ...d.options, className: 'vns-ai-changed vns-ai-fade' } })));
    setTimeout(() => glow.clear(), 1200);
  }, 1500);
}

// 找到顯示某個劇本的編輯器（剛開分頁時還沒建好，最多等 1.5 秒）
export async function waitForEditor(fileId: string): Promise<monaco.editor.IStandaloneCodeEditor | null> {
  for (let tries = 0; tries < 30; tries++) {
    const editor = monaco.editor
      .getEditors()
      .find((e) => e.getModel()?.uri.path.replace(/^\//, '') === fileId && e.getContainerDomNode().offsetParent !== null);
    if (editor) return editor as monaco.editor.IStandaloneCodeEditor;
    await wait(50);
  }
  return null;
}
