import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // 固定用 5173，啟動編輯器.bat 才知道要開哪個網址
  server: { port: 5173, strictPort: true },
});
