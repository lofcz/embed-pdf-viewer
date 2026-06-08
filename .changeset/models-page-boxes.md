---
"@embedpdf/models": patch
---

Add the `PdfPageBoxes` interface and an optional `boxes` field on `PdfPageObject`, exposing each page's Media/Crop (always present) and optional Bleed/Trim/Art boxes in unrotated PDF user space.
