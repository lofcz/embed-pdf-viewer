---
'@embedpdf/pdfium': patch
---

Fix callout FreeText annotations rendering with a black background when the fill color is transparent.

In `GenerateFreeTextAP`'s callout branch, the text-box rectangle was painted unconditionally with operator `B` (fill + stroke). When `/C` was absent, no fill colour was emitted, so `B` fell back to PDF's default black fill. Now the fill defaults to transparent via `GetColorStringWithDefault` and the paint operator is picked dynamically with `GetPaintOperatorString`, mirroring `GenerateCircleAP` / `GenerateSquareAP`.
