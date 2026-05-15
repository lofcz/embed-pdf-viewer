import { useEffect, useRef, useState } from '@framework';
import { ignore, Logger, PdfEngine } from '@embedpdf/models';
import { PDFIUM_WASM_URL } from '@embedpdf/pdfium';
import type { FontFallbackConfig } from '@embedpdf/engines';

interface UsePdfiumEngineProps {
  wasmUrl?: string;
  worker?: boolean;
  logger?: Logger;
  encoderPoolSize?: number;
  /**
   * Font fallback configuration for handling missing fonts in PDFs.
   * Set to `null` to disable the fallback entirely (no external font requests).
   */
  fontFallback?: FontFallbackConfig | null;
  /** URL to the PDFium worker script. Avoids `worker-src blob:` in strict CSP. */
  workerUrl?: string;
  /** URL to the image encoder worker script. Avoids `worker-src blob:` in strict CSP. */
  encoderWorkerUrl?: string;
}

function disposeEngine(engine: PdfEngine | null) {
  engine?.closeAllDocuments?.().wait(() => {
    engine?.destroy?.();
  }, ignore);
}

export function usePdfiumEngine(config?: UsePdfiumEngineProps) {
  const {
    // Package-local WASM next to `@embedpdf/pdfium` — no CDN by default.
    wasmUrl = PDFIUM_WASM_URL,
    worker = true,
    logger,
    encoderPoolSize,
    fontFallback,
    workerUrl,
    encoderWorkerUrl,
  } = config ?? {};

  const [engine, setEngine] = useState<PdfEngine | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const engineRef = useRef<PdfEngine | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { createPdfiumEngine } = worker
          ? await import('@embedpdf/engines/pdfium-worker-engine')
          : await import('@embedpdf/engines/pdfium-direct-engine');

        const pdfEngine = await createPdfiumEngine(wasmUrl, {
          logger,
          encoderPoolSize,
          fontFallback,
          workerUrl,
          encoderWorkerUrl,
        });

        // Effect torn down before we resolved (e.g. Strict Mode's dev
        // remount): discard this engine instead of committing it.
        if (cancelled) {
          disposeEngine(pdfEngine);
          return;
        }

        engineRef.current = pdfEngine;
        setEngine(pdfEngine);
        setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError(e as Error);
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      disposeEngine(engineRef.current);
      engineRef.current = null;
    };
  }, [wasmUrl, worker, logger, fontFallback, workerUrl, encoderWorkerUrl]);

  return { engine, isLoading: loading, error };
}
