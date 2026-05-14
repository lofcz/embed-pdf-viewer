import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'bin/embedpdf-server': 'src/bin/embedpdf-server.ts',
    'runtime/worker-entry': 'src/runtime/worker-entry.ts',
  },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  dts: true,
  outDir: 'dist',
  splitting: false,
  shims: false,
  clean: true,
  sourcemap: true,
  external: [/^@embedpdf\//, 'fastify', '@fastify/multipart'],
  // `.sql` migrations are imported as string constants. The text
  // loader inlines them at build time so the bundle has no runtime
  // filesystem dependency on the original .sql files. The shim in
  // src/types/sql.d.ts gives TypeScript the matching `default: string`.
  loader: { '.sql': 'text' },
});
