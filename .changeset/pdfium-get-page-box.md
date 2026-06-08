---
"@embedpdf/pdfium": patch
---

Add `EPDF_GetPageBoxByIndex` API (with the `EPDF_PAGE_BOX_TYPE` enum) to read a page's Media/Crop/Bleed/Trim/Art box without loading or parsing the page. MediaBox is resolved through page-tree inheritance (falling back to the default page size), CropBox falls back to MediaBox, and Bleed/Trim/Art return false when absent.
