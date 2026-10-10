import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server on 5184. /api/* is proxied to the FastAPI backend on :8000 with the /api prefix stripped,
// so the app never needs CORS and works the same behind any reverse proxy.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5184,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  preview: { port: 5184, strictPort: true },
  build: { chunkSizeWarningLimit: 900 },
});
