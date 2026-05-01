import { defineConfig } from 'vite';

export default defineConfig({
  optimizeDeps: { exclude: ['@embedpdf/pdf-runtime-wasm32'] },
});
