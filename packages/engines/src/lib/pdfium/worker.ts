import { deserializeLogger } from '@embedpdf/models';
import { PdfiumEngineRunner } from './runner';
import type { FontFallbackConfig } from './font-fallback';
import { cdnFontConfig } from './cdn-fonts';

let runner: PdfiumEngineRunner | null = null;

self.onmessage = async (event: MessageEvent) => {
  const { type, wasmUrl, logger: serializedLogger, fontFallback } = event.data;

  if ((type === 'bootstrap' || type === 'wasmInit') && wasmUrl && !runner) {
    try {
      const response = await fetch(wasmUrl);
      const wasmBinary = await response.arrayBuffer();

      const logger = serializedLogger ? deserializeLogger(serializedLogger) : undefined;

      const effectiveFontFallback =
        fontFallback === null
          ? undefined
          : ((fontFallback as FontFallbackConfig | undefined) ?? cdnFontConfig);

      runner = new PdfiumEngineRunner(wasmBinary, logger, effectiveFontFallback);
      await runner.prepare();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      self.postMessage({ type: 'wasmError', error: message });
    }
  }
};
