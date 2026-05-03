import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  optimizeDeps: { exclude: ['@embedpdf/pdf-runtime-wasm32'] },
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        engine: resolve(import.meta.dirname, 'engine.html'),
      },
    },
  },
});
