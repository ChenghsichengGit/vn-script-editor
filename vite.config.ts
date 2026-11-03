import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // 用相對路徑，打包後從程式內部載入 dist/index.html 也找得到檔案
  base: './',
  // 固定用 5173：src-tauri/tauri.conf.json 的 devUrl 指定這個埠
  server: { port: 5173, strictPort: true },
  // Tauri 開發時會自己顯示編譯錯誤，不要讓 Vite 清掉終端機畫面
  clearScreen: false,
});
