import type { DocumentMeta, Engine, OpenSource, RenderResult, Size } from '@embedpdf/kernel';

/**
 * A fake multi-document engine satisfying the real `Engine` contract. The actual
 * `@embedpdf/engine` renders via WASM/native PDFium behind an AbortablePromise and
 * returns bitmaps; here we rasterize placeholders. One engine, many documents —
 * every call is keyed by `docId`.
 */
export function createFakeEngine(): Engine {
  const docs = new Map<string, Size[]>();
  let seq = 0;

  const makeSizes = (n: number): Size[] =>
    Array.from({ length: n }, (_, i) =>
      i % 6 === 2 ? { width: 792, height: 612 } : { width: 612, height: 792 },
    );

  return {
    async open(source: OpenSource): Promise<DocumentMeta> {
      const id = source.id ?? `doc-${++seq}`;
      const pageCount = typeof source.pages === 'number' ? (source.pages as number) : 12;
      const sizes = makeSizes(pageCount);
      docs.set(id, sizes);
      return { id, name: source.name, pageCount, pages: sizes };
    },
    renderPage(docId: string, pageIndex: number, scale: number): RenderResult {
      const sizes = docs.get(docId) ?? makeSizes(12);
      const p = sizes[pageIndex] ?? sizes[0];
      const w = Math.max(1, Math.round(p.width * scale));
      const h = Math.max(1, Math.round(p.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.scale(scale, scale);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, p.width, p.height);
      ctx.strokeStyle = 'rgba(20,20,20,0.12)';
      ctx.lineWidth = 1;
      for (let i = 1; i < 10; i++) {
        const y = (p.height * i) / 10;
        ctx.beginPath();
        ctx.moveTo(p.width * 0.1, y);
        ctx.lineTo(p.width * 0.9, y);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(20,20,20,0.4)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `700 ${p.width * 0.2}px ui-monospace, Menlo, monospace`;
      ctx.fillText(String(pageIndex + 1), p.width / 2, p.height / 2);
      ctx.font = `${p.width * 0.04}px ui-monospace, Menlo, monospace`;
      ctx.fillStyle = 'rgba(20,20,20,0.3)';
      ctx.fillText(docId, p.width / 2, p.height * 0.07);
      return { width: w, height: h, data: ctx.getImageData(0, 0, w, h).data };
    },
  };
}
