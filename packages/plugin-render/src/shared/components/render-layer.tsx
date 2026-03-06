import { useEffect, useRef, useMemo } from '@framework';
import type { CSSProperties, HTMLAttributes } from '@framework';

import { ignore, PdfErrorCode } from '@embedpdf/models';

import { useRenderCapability } from '../hooks/use-render';
import { useDocumentState } from '@embedpdf/core/@framework';

type RenderLayerProps = Omit<HTMLAttributes<HTMLCanvasElement>, 'style'> & {
  /**
   * The ID of the document to render from
   */
  documentId: string;
  /**
   * The page index to render (0-based)
   */
  pageIndex: number;
  /**
   * Optional scale override. If not provided, uses document's current scale.
   */
  scale?: number;
  /**
   * Optional device pixel ratio override. If not provided, uses the browser device pixel ratio.
   */
  dpr?: number;
  /**
   * Optional rotation override. If not provided, uses page rotation plus document rotation.
   */
  rotation?: Rotation;
  /**
   * Additional styles for the canvas element
   */
  style?: CSSProperties;
};

function paintBitmap(canvas: HTMLCanvasElement, bitmap: ImageBitmap) {
  try {
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('bitmaprenderer')!.transferFromImageBitmap(bitmap);
  } catch {
    // Bitmap was detached
  }
}

/**
 * RenderLayer Component
 *
 * Renders a PDF page with smart prop handling:
 * - If scale/dpr/rotation props are provided, they override document state
 * - If not provided, component uses document's current state values
 * - Automatically re-renders when:
 *   1. Document state changes (scale, rotation)
 *   2. Page is refreshed (via REFRESH_PAGES action in core)
 */
export function RenderLayer({
  documentId,
  pageIndex,
  scale: scaleOverride,
  dpr: dprOverride,
  rotation: rotationOverride,
  style,
  ...props
}: RenderLayerProps) {
  const { provides: renderProvides } = useRenderCapability();
  const documentState = useDocumentState(documentId);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Get refresh version from core state
  const refreshVersion = useMemo(() => {
    if (!documentState) return 0;
    return documentState.pageRefreshVersions[pageIndex] || 0;
  }, [documentState, pageIndex]);

  // Determine actual render options: use overrides if provided, otherwise fall back to document state
  const actualScale = useMemo(() => {
    if (scaleOverride !== undefined) return scaleOverride;
    return documentState?.scale ?? 1;
  }, [scaleOverride, documentState?.scale]);

  const actualDpr = useMemo(() => {
    if (dprOverride !== undefined) return dprOverride;
    return globalThis.devicePixelRatio ?? 1;
  }, [dprOverride]);

  const actualRotation = useMemo(() => {
    if (rotationOverride !== undefined) return rotationOverride;
    const pageRotation =
      documentState?.document?.pages.find((page) => page.index === pageIndex)?.rotation ??
      Rotation.Degree0;
    const documentRotation = documentState?.rotation ?? Rotation.Degree0;
    return ((pageRotation + documentRotation) % 4) as Rotation;
  }, [rotationOverride, documentState?.document, documentState?.rotation, pageIndex]);

  useEffect(() => {
    if (!renderProvides) return;

    let currentBitmap: ImageBitmap | null = null;
    const task = renderProvides.forDocument(documentId).renderPageBitmap({
      pageIndex,
      options: {
        scaleFactor: actualScale,
        dpr: actualDpr,
        rotation: actualRotation,
      },
    });

    task.wait((output) => {
      currentBitmap = output;
      const canvas = canvasRef.current;
      if (canvas) {
        paintBitmap(canvas, output);
        currentBitmap = null; // transferred to canvas
      }
    }, ignore);

    return () => {
      task.abort({
        code: PdfErrorCode.Cancelled,
        message: 'canceled render task',
      });
      if (currentBitmap) {
        currentBitmap.close();
        currentBitmap = null;
      }
    };
  }, [
    documentId,
    pageIndex,
    actualScale,
    actualDpr,
    actualRotation,
    renderProvides,
    refreshVersion,
  ]);

  const elementStyle: CSSProperties = {
    width: '100%',
    height: '100%',
    ...(style || {}),
  };

  return <canvas ref={canvasRef} {...props} style={elementStyle} />;
}
