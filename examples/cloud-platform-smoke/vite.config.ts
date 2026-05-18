import { defineConfig } from 'vite';

const apiPort = Number(process.env['EMBEDPDF_SMOKE_API_PORT'] ?? 3211);
const enginePort = Number(process.env['EMBEDPDF_SMOKE_ENGINE_PORT'] ?? 3210);

export default defineConfig({
  server: {
    proxy: {
      '/api': `http://127.0.0.1:${apiPort}`,
      '/v1': `http://127.0.0.1:${enginePort}`,
    },
  },
});
