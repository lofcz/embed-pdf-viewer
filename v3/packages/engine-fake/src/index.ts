import {
  AbortablePromise,
  type DocumentHandle,
  type Engine,
  type OpenInput,
  type PageImageHandle,
  type PageImageOptions,
  type PageRaster,
  type PageRenderOptions,
} from '@embedpdf/engine-core/runtime';

/**
 * A fake engine that satisfies the REAL `@embedpdf/engine-core` `Engine` contract —
 * the same interface implemented by `@embedpdf/engine` (wasm) and `@cloudpdf/engine`
 * (HTTP). It implements the subset the viewer uses (open · pages.list · page.render
 * .raw/.image · close) and casts the handle for services we don't exercise yet, so
 * swapping to the real engine is a zero-change drop-in.
 */
interface PageSize {
  width: number;
  height: number;
}

function pageCountFor(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return 6 + (hash % 10); // 6..15 pages, deterministic per id
}

function sizesFor(id: string): PageSize[] {
  return Array.from({ length: pageCountFor(id) }, (_, i) =>
    i % 6 === 2 ? { width: 792, height: 612 } : { width: 612, height: 792 },
  );
}

function idOf(input: OpenInput): string {
  return input.kind === 'token' ? 'token-doc' : input.id;
}

function scaleOf(options?: PageRenderOptions): number {
  return options?.viewport?.kind === 'scale' ? (options.viewport.scale ?? 1) : 1;
}

/** Draw a placeholder page onto a fresh canvas at the given scale. */
function drawPage(
  docId: string,
  pageIndex: number,
  size: PageSize,
  scale: number,
): HTMLCanvasElement {
  const width = Math.max(1, Math.round(size.width * scale));
  const height = Math.max(1, Math.round(size.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size.width, size.height);
  ctx.strokeStyle = 'rgba(20,20,20,0.12)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 10; i++) {
    const y = (size.height * i) / 10;
    ctx.beginPath();
    ctx.moveTo(size.width * 0.1, y);
    ctx.lineTo(size.width * 0.9, y);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(20,20,20,0.4)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${size.width * 0.2}px ui-monospace, Menlo, monospace`;
  ctx.fillText(String(pageIndex + 1), size.width / 2, size.height / 2);
  ctx.font = `${size.width * 0.04}px ui-monospace, Menlo, monospace`;
  ctx.fillStyle = 'rgba(20,20,20,0.3)';
  ctx.fillText(docId, size.width / 2, size.height * 0.07);
  return canvas;
}

function makeFakeHandle(id: string, sizes: PageSize[]): DocumentHandle {
  const pages = sizes.map((size, index) => ({
    index,
    pageObjectNumber: index + 1,
    label: null,
    width: size.width,
    height: size.height,
    rotation: 0,
    userUnit: 1,
  }));

  const handle = {
    id,
    capabilities: { weakAnnotationEditSessions: 'not-needed', pageEditSessions: 'unsupported' },
    pages: {
      list: () => AbortablePromise.resolveValue({ pageCount: sizes.length, pages }),
      move: () => AbortablePromise.rejectReason(new Error('fake: pages.move not implemented')),
    },
    page: (pon: number) => {
      const pageIndex = pon - 1;
      const size = sizes[pageIndex] ?? sizes[0];
      return {
        pageObjectNumber: pon,
        pageIndex,
        render: {
          raw: (options?: PageRenderOptions): AbortablePromise<PageRaster> => {
            const canvas = drawPage(id, pageIndex, size, scaleOf(options));
            const ctx = canvas.getContext('2d')!;
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            return AbortablePromise.resolveValue({
              width: canvas.width,
              height: canvas.height,
              stride: canvas.width * 4,
              color: 'rgba8',
              premultipliedAlpha: false,
              data: imageData.data.buffer,
            });
          },
          image: (options?: PageImageOptions): AbortablePromise<PageImageHandle> => {
            const canvas = drawPage(id, pageIndex, size, scaleOf(options));
            const url = canvas.toDataURL('image/png');
            const image: PageImageHandle = {
              format: 'png',
              contentType: 'image/png',
              source: { kind: 'url', url },
              objectUrl: async () => ({ url, revoke: () => {} }),
            };
            return AbortablePromise.resolveValue(image);
          },
        },
      };
    },
    close: () => AbortablePromise.resolveValue(undefined),
    download: () => AbortablePromise.resolveValue(new Uint8Array()),
  };

  // Services we don't exercise yet (security/metadata/annotations/text/geometry) are
  // omitted; the cast keeps the fake small while remaining a valid drop-in.
  return handle as unknown as DocumentHandle;
}

export function createFakeEngine(): Engine {
  return {
    open: (input: OpenInput): AbortablePromise<DocumentHandle> => {
      const id = idOf(input);
      return AbortablePromise.resolveValue(makeFakeHandle(id, sizesFor(id)));
    },
    destroy: (): AbortablePromise<void> => AbortablePromise.resolveValue(undefined),
  };
}
