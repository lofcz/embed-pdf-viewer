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
}

export function usePdfiumEngine(config?: UsePdfiumEngineProps) {
  const {
    // Package-local WASM next to `@embedpdf/pdfium` — no CDN by default.
    wasmUrl = PDFIUM_WASM_URL,
    worker = true,
    logger,
    encoderPoolSize,
    fontFallback,
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
        });
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
      engineRef.current?.closeAllDocuments?.().wait(() => {
        engineRef.current?.destroy?.();
        engineRef.current = null;
      }, ignore);
    };
  }, [wasmUrl, worker, logger, fontFallback]);

  return { engine, isLoading: loading, error };
}
