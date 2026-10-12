import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// /api/* goes to the HomeBridge FastAPI backend on :8000 with the /api prefix stripped.
const proxy = {
  '/api': {
    target: 'http://localhost:8000',
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/api/, ''),
  },
};

export default defineConfig({
  plugins: [react()],
  // antd-mobile + React in one chunk is ~530 kB (~170 kB gzip); fine for a prototype.
  build: { chunkSizeWarningLimit: 800 },
  server: { port: 5181, strictPort: true, proxy },
  preview: { port: 5181, strictPort: true, proxy },
});
