import './platform'; // 先接好 window.api（桌面程式的檔案、選單功能），後面的程式才能用
import { createRoot } from 'react-dom/client';
import { loader } from '@monaco-editor/react';
import monaco from './monaco';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import App from './App';
import './styles.css';

// 編輯器元件改用本機安裝的版本（不從網路下載），沒有網路也能用
self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
loader.config({ monaco });

// 程式起點：把 App 畫到 index.html 的 #root 裡
createRoot(document.getElementById('root')!).render(<App />);
