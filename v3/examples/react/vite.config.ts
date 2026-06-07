import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Resolve the v3 packages straight from source so the example runs without a
// build step (and edits to the libs hot-reload).
const src = (p: string) =>
  fileURLToPath(new URL(`../../packages/${p}/src/index.ts`, import.meta.url));

export default defineConfig({
  server: { port: 5199, strictPort: true },
  plugins: [react()],
  // The wasm runtime is loaded by the engine worker; let it stay un-prebundled.
  optimizeDeps: { exclude: ['@embedpdf/pdf-runtime-wasm32'] },
  resolve: {
    alias: {
      '@embedpdf-x/kernel': src('kernel'),
      '@embedpdf-x/stage-core': src('stage-core'),
      '@embedpdf-x/plugin-stage': src('plugin-stage'),
      '@embedpdf-x/plugin-marker': src('plugin-marker'),
      '@embedpdf-x/plugin-persist': src('plugin-persist'),
      '@embedpdf-x/plugin-render': src('plugin-render'),
      '@embedpdf-x/plugin-view-manager': src('plugin-view-manager'),
      '@embedpdf-x/engine-fake': src('engine-fake'),
      '@embedpdf-x/react': src('react'),
    },
  },
});
