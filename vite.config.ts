import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 3000,
  },
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;

          // React 全家桶
          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/') ||
            id.includes('node_modules/scheduler/')
          ) {
            return 'vendor-react';
          }

          // Firebase
          if (
            id.includes('node_modules/firebase/') ||
            id.includes('node_modules/@firebase/')
          ) {
            return 'vendor-firebase';
          }

          // ExcelJS
          if (
            id.includes('node_modules/exceljs/') ||
            id.includes('node_modules/jszip/') ||
            id.includes('node_modules/unzipper/')
          ) {
            return 'vendor-exceljs';
          }

          // Recharts + 所有 d3 依賴
          if (
            id.includes('node_modules/recharts/') ||
            id.includes('node_modules/d3-')
          ) {
            return 'vendor-recharts';
          }

          // 移除 catch-all
          // 不寫 return 'vendor-misc'，讓 Rollup 自己決定
          // 未被歸類的模組會自動進入「需要它的 chunk」
        },
      },
    },
  },
});