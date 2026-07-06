import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Resolve the v3 packages straight from source so the example runs without a
// build step (and edits to the libs hot-reload).
const src = (p: string) =>
  fileURLToPath(new URL(`../../packages/${p}/src/index.ts`, import.meta.url));

// A non-default package entry (e.g. the `/internal` host surface). Aliasing to
// source bypasses the package's `exports`, so each subpath needs its own entry —
// listed BEFORE the bare-package alias, since the first matching alias wins.
const srcEntry = (p: string, file: string) =>
  fileURLToPath(new URL(`../../packages/${p}/src/${file}.ts`, import.meta.url));

const rootSrc = (p: string) =>
  fileURLToPath(new URL(`../../../packages/${p}/src/index.ts`, import.meta.url));
const rootSrcEntry = (p: string, file: string) =>
  fileURLToPath(new URL(`../../../packages/${p}/src/${file}.ts`, import.meta.url));

export default defineConfig({
  server: { port: 5199, strictPort: true },
  worker: { format: 'es' },
  plugins: [react()],
  // The wasm runtime is loaded by the engine worker; let it stay un-prebundled.
  optimizeDeps: { exclude: ['@embedpdf/pdf-runtime-wasm32', '@embedpdf/engine'] },
  resolve: {
    alias: [
      { find: '@embedpdf-x/kernel', replacement: src('kernel') },
      { find: '@embedpdf-x/geometry', replacement: src('geometry') },
      { find: '@embedpdf-x/stage-core', replacement: src('stage-core') },
      { find: '@embedpdf-x/plugin-stage', replacement: src('plugin-stage') },
      { find: '@embedpdf-x/plugin-interaction', replacement: src('plugin-interaction') },
      { find: '@embedpdf-x/plugin-selection', replacement: src('plugin-selection') },
      { find: '@embedpdf-x/annotation-core', replacement: src('annotation-core') },
      // More specific first: the host (`/internal`) surface, then the bare package.
      {
        find: '@embedpdf-x/plugin-annotation/internal',
        replacement: srcEntry('plugin-annotation', 'internal'),
      },
      { find: '@embedpdf-x/plugin-form', replacement: src('plugin-form') },
      { find: '@embedpdf-x/plugin-search', replacement: src('plugin-search') },
      { find: '@embedpdf-x/plugin-annotation', replacement: src('plugin-annotation') },
      { find: '@embedpdf-x/plugin-persist', replacement: src('plugin-persist') },
      { find: '@embedpdf-x/plugin-render', replacement: src('plugin-render') },
      { find: '@embedpdf-x/plugin-page-edit', replacement: src('plugin-page-edit') },
      { find: '@embedpdf-x/plugin-metadata', replacement: src('plugin-metadata') },
      { find: '@embedpdf-x/plugin-view-manager', replacement: src('plugin-view-manager') },
      { find: '@embedpdf-x/react', replacement: src('react') },
      {
        find: /^@embedpdf\/engine\/worker-entry$/,
        replacement: rootSrcEntry('engine', 'worker/worker-entry'),
      },
      { find: /^@embedpdf\/engine$/, replacement: rootSrc('engine') },
    ],
  },
});
