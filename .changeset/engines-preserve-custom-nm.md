---
'@embedpdf/engines': patch
---

Preserve custom annotation `/NM` values instead of rewriting them to a UUID v4.

The engine previously overwrote any `/NM` (annotation name) that wasn't a UUID v4 — both when creating new annotations (rewriting the caller's `annotation.id`) and when reading existing ones (mutating the on-disk value as a side effect of opening a PDF). This broke any consumer using a custom identity scheme (e.g. ULIDs, `firm-2024-001`, etc.).

The engine now only generates a UUID v4 when `/NM` is empty or missing; any non-empty value is kept as-is. PDFium's `EPDFPage_GetAnnotByName` lookup only needs a unique string, so no functional behaviour changes for callers that don't supply a custom id.
