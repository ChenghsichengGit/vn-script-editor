// 劇本編輯器（Monaco）只載入用得到的部分
// 整包的 'monaco-editor' 會帶進幾十種程式語言的上色和 JSON／CSS／HTML／TypeScript 的語言功能，劇本都用不到
// 這裡只載入編輯器核心 + 下面列的功能；其他檔案一律 import monaco from './monaco'，不要直接 import 'monaco-editor'
// 要加功能時，到 node_modules/monaco-editor/esm/vs/editor/editor.all.js 找對應的那一行加進來
import 'monaco-editor/esm/vs/editor/browser/coreCommands.js'; // 基本游標移動、選取、刪除
import 'monaco-editor/esm/vs/editor/browser/widget/codeEditor/codeEditorWidget.js'; // 編輯器本體
import 'monaco-editor/esm/vs/editor/contrib/bracketMatching/browser/bracketMatching.js'; // 括號配對
import 'monaco-editor/esm/vs/editor/contrib/caretOperations/browser/caretOperations.js';
import 'monaco-editor/esm/vs/editor/contrib/clipboard/browser/clipboard.js'; // 複製、剪下、貼上
import 'monaco-editor/esm/vs/editor/contrib/comment/browser/comment.js'; // Ctrl+/ 註解
import 'monaco-editor/esm/vs/editor/contrib/contextmenu/browser/contextmenu.js'; // 右鍵選單
import 'monaco-editor/esm/vs/editor/contrib/cursorUndo/browser/cursorUndo.js';
import 'monaco-editor/esm/vs/editor/contrib/dnd/browser/dnd.js'; // 拖曳搬移選取的文字
import 'monaco-editor/esm/vs/editor/contrib/find/browser/findController.js'; // Ctrl+F 尋找、Ctrl+H 取代
import 'monaco-editor/esm/vs/editor/contrib/folding/browser/folding.js'; // 摺疊
import 'monaco-editor/esm/vs/editor/contrib/gotoError/browser/gotoError.js'; // F8 跳到下一個錯誤
import 'monaco-editor/esm/vs/editor/contrib/hover/browser/hoverContribution.js'; // 滑鼠移上去的說明（紅線的錯誤訊息）
import 'monaco-editor/esm/vs/editor/contrib/indentation/browser/indentation.js';
import 'monaco-editor/esm/vs/editor/contrib/lineSelection/browser/lineSelection.js';
import 'monaco-editor/esm/vs/editor/contrib/linesOperations/browser/linesOperations.js'; // Alt+↑↓ 搬移行、複製行
import 'monaco-editor/esm/vs/editor/contrib/multicursor/browser/multicursor.js'; // 多游標
import 'monaco-editor/esm/vs/editor/contrib/suggest/browser/suggestController.js'; // 自動補齊清單
import 'monaco-editor/esm/vs/editor/contrib/wordHighlighter/browser/wordHighlighter.js'; // 相同字反白
import 'monaco-editor/esm/vs/editor/contrib/wordOperations/browser/wordOperations.js'; // Ctrl+←→ 一次跳一個字
import 'monaco-editor/esm/vs/editor/contrib/wordPartOperations/browser/wordPartOperations.js';
import 'monaco-editor/esm/vs/editor/common/standaloneStrings.js';
import 'monaco-editor/esm/vs/base/browser/ui/codicons/codiconStyles.js'; // 圖示字型
import 'monaco-editor/esm/vs/editor/standalone/browser/quickAccess/standaloneCommandsQuickAccess.js'; // F1 指令面板
import 'monaco-editor/esm/vs/editor/standalone/browser/quickAccess/standaloneGotoLineQuickAccess.js'; // Ctrl+G 跳到第幾行
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';

export default monaco;
