import { PdfiumEngineRunner } from '../src/lib/pdfium/worker-runtime';
import pdfiumWasm from 'url:@embedpdf/pdfium/pdfium.wasm';

async function init() {
  const response = await fetch(pdfiumWasm);
  const wasmBinary = await response.arrayBuffer();
  const runner = new PdfiumEngineRunner(wasmBinary);
  await runner.prepare();
}

init();
