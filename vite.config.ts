import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // 用相對路徑，之後打包成安裝檔時才能用 file:// 載入 dist/index.html
  base: './',
  // 固定用 5173，npm run dev 的 wait-on 才知道要等哪個埠
  server: { port: 5173, strictPort: true },
});
