---
'@embedpdf/models': patch
---

Add `objectNumber: number` to `PdfPageObject`, populated by the engine from `EPDFDoc_GetPageObjectNumberByIndex`. Lets consumers correlate pages with their PDF indirect-object numbers (e.g. for linking, debugging, or round-tripping raw object references). `PdfPageObject` is engine-owned — only the engine constructs it — so this is additive for all practical consumers.
