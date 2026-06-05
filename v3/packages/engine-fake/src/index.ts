import type { Engine, PdfDocument, RenderResult, Size } from '@embedpdf/kernel';

/**
 * A fake engine that satisfies the real `Engine` contract. The actual
 * `@embedpdf/engine` renders via WASM/native PDFium behind an AbortablePromise and
 * returns bitmaps; here we rasterize placeholders to an offscreen canvas and return
 * the RGBA bytes. Nothing else in the system changes when you swap it.
 */
export function createFakeEngine({ pages = 12 }: { pages?: number } = {}): Engine {
  const sizes: Size[] = Array.from({ length: pages }, (_, i) =>
    i % 6 === 2 ? { width: 792, height: 612 } : { width: 612, height: 792 },
  );

  return {
    async open(): Promise<PdfDocument> {
      return { id: 'fake-doc', pageCount: pages, pages: sizes };
    },
    renderPage(pageIndex: number, scale: number): RenderResult {
      const p = sizes[pageIndex];
      const w = Math.max(1, Math.round(p.width * scale));
      const h = Math.max(1, Math.round(p.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.scale(scale, scale); // draw in page units
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
      return { width: w, height: h, data: ctx.getImageData(0, 0, w, h).data };
    },
  };
}
