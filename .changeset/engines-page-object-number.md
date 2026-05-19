---
'@embedpdf/engines': patch
---

Populate `PdfPageObject.objectNumber` from PDFium's `EPDFDoc_GetPageObjectNumberByIndex` in `openDocumentBuffer` and `importPages`, so pages now expose their PDF indirect-object number alongside their index, size, and rotation.
