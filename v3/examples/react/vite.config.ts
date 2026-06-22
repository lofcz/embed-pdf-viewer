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
      '@embedpdf-x/geometry': src('geometry'),
      '@embedpdf-x/stage-core': src('stage-core'),
      '@embedpdf-x/plugin-stage': src('plugin-stage'),
      '@embedpdf-x/plugin-interaction': src('plugin-interaction'),
      '@embedpdf-x/plugin-selection': src('plugin-selection'),
      '@embedpdf-x/annotation-core': src('annotation-core'),
      '@embedpdf-x/plugin-annotation': src('plugin-annotation'),
      '@embedpdf-x/plugin-persist': src('plugin-persist'),
      '@embedpdf-x/plugin-render': src('plugin-render'),
      '@embedpdf-x/plugin-page-edit': src('plugin-page-edit'),
      '@embedpdf-x/plugin-metadata': src('plugin-metadata'),
      '@embedpdf-x/plugin-view-manager': src('plugin-view-manager'),
      '@embedpdf-x/react': src('react'),
    },
  },
});
