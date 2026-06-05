// @ts-check
/**
 * A stand-in for @embedpdf/engine. The real one returns a DocumentHandle and
 * renders via WASM/native PDFium behind an AbortablePromise; here we synthesize
 * page sizes and paint placeholder pages to a 2D context. The ONLY thing the rest
 * of the system knows is: open() -> { pageCount, pages } and renderPage(ctx,...).
 */
export function createFakeEngine({ pages = 12 } = {}) {
  const sizes = Array.from({ length: pages }, (_, i) =>
    i % 6 === 2 ? { width: 792, height: 612 } : { width: 612, height: 792 },
  );

  return {
    async open() {
      return { pageCount: pages, pages: sizes };
    },
    /** Paint a page into a 2D context already sized to `displaySize` (CSS px). */
    renderPage(ctx, pageIndex, displaySize) {
      const p = sizes[pageIndex];
      ctx.save();
      ctx.scale(displaySize.width / p.width, displaySize.height / p.height); // draw in page units
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
      ctx.restore();
    },
  };
}
