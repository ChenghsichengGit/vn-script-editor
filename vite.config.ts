import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import monacoZhTw from './monacoZhTw';

export default defineConfig({
  plugins: [react(), monacoZhTw()], // monacoZhTw：劇本編輯器內建的文字換成繁體中文
  base: './',
  server: { port: 5173, strictPort: true },
  clearScreen: false,
});
