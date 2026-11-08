import './platform'; // 先接好 window.api（桌面程式的檔案、選單功能），後面的程式才能用
import { createRoot } from 'react-dom/client';
import { loader } from '@monaco-editor/react';
import monaco from './monaco';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import App from './App';
import './styles.css';

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
loader.config({ monaco });

createRoot(document.getElementById('root')!).render(<App />);
