declare module '@embedpdf/pdf-runtime-wasm32' {
  const createModule: (opts?: Record<string, unknown>) => Promise<Record<string, any>>;
  export default createModule;
}

declare module '@embedpdf/pdf-runtime-darwin-arm64';
declare module '@embedpdf/pdf-runtime-darwin-x64';
declare module '@embedpdf/pdf-runtime-linux-x64';
declare module '@embedpdf/pdf-runtime-linux-arm64';
declare module '@embedpdf/pdf-runtime-linuxmusl-x64';
declare module '@embedpdf/pdf-runtime-linuxmusl-arm64';
declare module '@embedpdf/pdf-runtime-win32-x64';
declare module '@embedpdf/pdf-runtime-win32-arm64';
