import { useEffect, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { useKeys } from '../hooks';

export type HelpTopic = 'shortcuts' | 'syntax' | 'about';

const SHORTCUTS: [string, string][] = [
  ['Ctrl+P', '快速開啟劇本或設定卡'],
  ['Ctrl+Shift+P', '指令面板（找所有功能）'],
  ['Ctrl+S', '存檔（目前的分頁）'],
  ['Ctrl+K S', '全部存檔（先按 Ctrl+K，再按 S）'],
  ['Ctrl+W', '關閉分頁'],
  ['Ctrl+O', '開啟專案資料夾'],
  ['Ctrl+Shift+N', '新視窗'],
  ['Ctrl+,', '設定'],
  ['Ctrl+B', '收起／打開左側欄'],
  ['Ctrl+Shift+M', '打開／收起問題面板'],
  ['Ctrl+Shift+F', '在整個專案中搜尋／取代'],
  ['Ctrl+\\', '向右分割'],
  ['Ctrl+K Ctrl+\\', '向下分割'],
  ['Ctrl+/', '劇本：加上／拿掉 // 註解'],
  ['Ctrl+Shift+R', '標音（選取的文字加上讀音；在標音上按是修改讀音）'],
  ['Ctrl+Space', '劇本：在指令行打開自動補齊（Notion 式編輯器）'],
  ['Ctrl+F／Ctrl+H', '劇本：尋找／取代'],
  ['Ctrl+G', '劇本：跳到第幾行'],
  ['F8', '劇本：跳到下一個錯誤'],
  ['Alt+↑／↓', '劇本：上下搬移這一行'],
  ['Ctrl+滑鼠滾輪', '劇本：放大／縮小文字'],
  ['F1', '劇本編輯器的指令面板'],
  ['滑鼠中鍵', '在分頁上按：關閉分頁'],
];

const SYNTAX: [string, string][] = [
  ['小明：早安。', '一般的一行：對白或旁白，照原樣輸出'],
  ['#fade in 2', '行首是 # 的是指令；參數用空白分開。打 # 會自動列出可以用的指令'],
  ['// 這裡之後要改', '// 到行尾是註解，不會輸出。Ctrl+/ 可以整行加上或拿掉'],
  ['= 第一章', '大標題；== 中標題、=== 小標題（= 後面要有空格）。只用來分段，右邊的大綱會列出來，不會輸出。前面加 // 就是註解掉的標題'],
  ['{漢字|かんじ}', '標音：讀音顯示在本文上方；設定卡的詳細內容也能用'],
  ['設定 →「Notion 式劇本編輯器」（預設開啟）', '標題、標音直接顯示效果（看不到 = 和 {|}），註解的 // 照常顯示。行首打「= 」「== 」「=== 」變標題，Ctrl+/ 可以把標題註解掉，要變回一般文字用右鍵或工具列的「一般文字」；行首 # 是指令、// 是註解'],
  ['#name [名字]', '指令卡的格式：[名字] 從清單選；[t:int] 整數、[x:float] 小數；[t:int=0]、[note?] 可以不填；in/out 只能選其中一個'],
];

export default function HelpDialog({ topic, onClose }: { topic: HelpTopic; onClose: () => void }) {
  const [version, setVersion] = useState('');
  useEffect(() => void getVersion().then(setVersion, () => setVersion('')), []);
  useKeys((e) => (e.key === 'Escape' || (topic === 'about' && e.key === 'Enter')) && (onClose(), true), [topic, onClose]);
  const title = topic === 'shortcuts' ? '鍵盤快捷鍵' : topic === 'syntax' ? '劇本語法說明' : '關於';
  return (
    <div className="close-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="close-panel help-panel" role="dialog" aria-label={title}>
        <div className="help-title">{title}</div>
        {topic === 'shortcuts' && (
          <table className="help-table">
            <tbody>
              {SHORTCUTS.map(([key, what]) => (
                <tr key={key}>
                  <td><kbd>{key}</kbd></td>
                  <td>{what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {topic === 'syntax' && (
          <table className="help-table">
            <tbody>
              {SYNTAX.map(([code, what]) => (
                <tr key={code}>
                  <td><code>{code}</code></td>
                  <td>{what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {topic === 'about' && (
          <div className="help-about">
            <div className="help-app">VN Script Editor {version}</div>
            <div>視覺小說劇本編輯器</div>
            <div className="help-dim">https://github.com/ChenghsichengGit/vn-script-editor</div>
          </div>
        )}
        <div className="close-buttons"><button type="button" className="close-btn primary" onClick={onClose} autoFocus>關閉</button></div>
      </div>
    </div>
  );
}
