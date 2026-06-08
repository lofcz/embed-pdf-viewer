---
"@embedpdf/engines": patch
---

Fix incorrect annotation positions for PDFs with a non-zero MediaBox/CropBox origin (e.g. CAD/technical drawing exports). The engine now reads each page's box origin at open time and applies it in both the PDF-to-CSS and CSS-to-PDF coordinate conversions, so annotations render and round-trip at the position shown by native PDF viewers.
