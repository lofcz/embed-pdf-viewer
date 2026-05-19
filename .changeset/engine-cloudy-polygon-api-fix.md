---
'@embedpdf/engines': patch
---

Fix two bugs that caused polygon (and square/circle) annotations created via the `createAnnotation` API with `strokeStyle: PdfAnnotationBorderStyle.CLOUDY` to be saved as a half-built stub missing `/C`, `/IC`, `/CA`, `/F`, `/BE`, `/RD`, and `/AP`:

- Normalise `PdfAnnotationBorderStyle.CLOUDY` to `SOLID` inside `setBorderStyle` before calling PDFium's `EPDFAnnot_SetBorderStyle`. Cloudy is not a `/BS/S` value — it is conveyed via the separate `/BE` (border effect) dict, which `setBorderEffect` already writes. PDFium previously rejected the call and aborted the rest of `addPolyContent` / `addShapeContent`, so the cloudy effect, colors, opacity, flags, and appearance stream were never written.
- Fix the rollback path in `createPageAnnotation` so failed content-add calls actually remove the partially-built annotation. The previous code called `FPDFPage_RemoveAnnot(pagePtr, annotationPtr)`, but PDFium's C signature is `FPDFPage_RemoveAnnot(FPDF_PAGE, int index)` — the annotation pointer was interpreted as an out-of-range index and silently no-op'd, leaving the stub annotation in the page. It now uses `removeAnnotationByName` (via `EPDFPage_RemoveAnnotByName`) and closes the annotation handle.

The `PdfAnnotationBorderStyle.CLOUDY` enum value is now treated as a deprecated alias for `SOLID + cloudyBorderIntensity` and is slated for removal in the next major release.
