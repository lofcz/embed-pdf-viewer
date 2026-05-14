import { createConfig } from '@embedpdf/build/vite';

export default createConfig({
  tsconfigPath: './tsconfig.json',
  entryPath: {
    index: 'index.ts',
    runtime: 'runtime.ts',
    wire: 'wire.ts',
    conformance: 'conformance.ts',
  },
});
