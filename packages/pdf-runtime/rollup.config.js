import commonjs from '@rollup/plugin-commonjs';
import nodeResolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';
import dts from 'rollup-plugin-dts';

const SRC = 'src';
const DIST = 'dist';
const ENTRY = `${SRC}/index.ts`;

const optionalRuntimePackages = [
  '@embedpdf/pdf-runtime-wasm32',
  '@embedpdf/pdf-runtime-darwin-arm64',
  '@embedpdf/pdf-runtime-darwin-x64',
  '@embedpdf/pdf-runtime-linux-x64',
  '@embedpdf/pdf-runtime-linux-arm64',
  '@embedpdf/pdf-runtime-linuxmusl-x64',
  '@embedpdf/pdf-runtime-linuxmusl-arm64',
  '@embedpdf/pdf-runtime-win32-x64',
  '@embedpdf/pdf-runtime-win32-arm64',
];

const external = (id) =>
  id === 'node:module' ||
  id === 'detect-libc' ||
  optionalRuntimePackages.some((pkg) => id === pkg || id.startsWith(`${pkg}/`));

const stubNativeForBrowser = () => ({
  name: 'stub-native-for-browser',
  resolveId(source) {
    if (source === './native/native-runtime') {
      return '\0virtual:native-runtime-stub';
    }
  },
  load(id) {
    if (id === '\0virtual:native-runtime-stub') {
      return `export async function createNativeRuntime() {
        throw new Error('native runtime not available in browser bundle');
      }`;
    }
  },
});

const common = {
  input: ENTRY,
  external,
  plugins: [typescript(), nodeResolve({ extensions: ['.js', '.ts'] })],
};

export default [
  {
    ...common,
    plugins: [stubNativeForBrowser(), ...common.plugins],
    output: { file: `${DIST}/index.browser.js`, format: 'esm', sourcemap: true },
  },
  {
    ...common,
    output: { file: `${DIST}/index.js`, format: 'esm', sourcemap: true },
  },
  {
    ...common,
    output: { file: `${DIST}/index.cjs`, format: 'cjs', exports: 'named', sourcemap: true },
    plugins: [...common.plugins, commonjs({ strictRequires: true })],
  },
  {
    input: ENTRY,
    external,
    plugins: [dts()],
    output: { file: `${DIST}/index.d.ts`, format: 'es' },
  },
  {
    input: ENTRY,
    external,
    plugins: [dts()],
    output: { file: `${DIST}/index.d.cts`, format: 'es' },
  },
];
