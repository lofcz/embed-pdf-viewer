import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

// The v3 packages resolve straight from source through their own package.json
// `exports` maps (internal-packages pattern: dev entries point at src/), so no
// aliases are needed — and subpath imports (@embedpdf-x/react/annotation, per
// v3/ADAPTERS.md) resolve the same way. Only the root engine packages, whose
// published entries point at dist, still get mapped to source here.
const rootSrc = (p: string) =>
  fileURLToPath(new URL(`../../../packages/${p}/src/index.ts`, import.meta.url));
const rootSrcEntry = (p: string, file: string) =>
  fileURLToPath(new URL(`../../../packages/${p}/src/${file}.ts`, import.meta.url));

export default defineConfig({
  server: { port: 5200, strictPort: true },
  worker: { format: 'es' },
  plugins: [react(), tailwindcss()],
  optimizeDeps: { exclude: ['@embedpdf/pdf-runtime-wasm32', '@embedpdf/engine'] },
  resolve: {
    alias: [
      {
        find: /^@embedpdf\/engine\/worker-entry$/,
        replacement: rootSrcEntry('engine', 'worker/worker-entry'),
      },
      { find: /^@embedpdf\/engine$/, replacement: rootSrc('engine') },
    ],
  },
});
