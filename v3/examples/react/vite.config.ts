import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Resolve the v3 packages straight from source so the example runs without a
// build step (and edits to the libs hot-reload).
const src = (p: string) =>
  fileURLToPath(new URL(`../../packages/${p}/src/index.ts`, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@embedpdf/kernel': src('kernel'),
      '@embedpdf/stage-core': src('stage-core'),
      '@embedpdf/stage': src('stage'),
      '@embedpdf/plugin-marker': src('plugin-marker'),
      '@embedpdf/plugin-persist': src('plugin-persist'),
      '@embedpdf/engine-fake': src('engine-fake'),
      '@embedpdf/react': src('react'),
    },
  },
});
