---
'@embedpdf/snippet': patch
---

Re-export the annotation API surface from `@embedpdf/models` through the snippet bundle so consumers can use named enums and typed annotation shapes instead of hardcoding numeric subtype/border-style values.

Newly exported from `@embedpdf/snippet`:

- Enums: `PdfAnnotationBorderStyle`, `PdfAnnotationLineEnding`, `PdfAnnotationFlags`, `PdfAnnotationName`, `PdfAnnotationIcon`, `PdfAnnotationState`, `PdfAnnotationStateModel`, `PdfAnnotationReplyType`, `PdfAnnotationObjectStatus`, `PdfBlendMode`, `PdfStampFit`, `AppearanceMode`.
- Annotation flag helpers: `PdfAnnotationFlagName`, `flagsToNames`, `namesToFlags`.
- Annotation object types: `PdfAnnotationObjectBase`, `PdfAnnotationObject`, `PdfSupportedAnnoObject`, `PdfUnsupportedAnnoObject`, `PdfTextAnnoObject`, `PdfLinkAnnoObject`, `PdfFreeTextAnnoObject`, `PdfLineAnnoObject`, `PdfSquareAnnoObject`, `PdfCircleAnnoObject`, `PdfPolygonAnnoObject`, `PdfPolylineAnnoObject`, `PdfHighlightAnnoObject`, `PdfUnderlineAnnoObject`, `PdfSquigglyAnnoObject`, `PdfStrikeOutAnnoObject`, `PdfCaretAnnoObject`, `PdfInkAnnoObject`, `PdfInkListObject`, `PdfPopupAnnoObject`, `PdfFileAttachmentAnnoObject`, `PdfWidgetAnnoObject`, `PdfRedactAnnoObject`, `PdfRectDifferences`, `LinePoints`, `LineEndings`, `PdfAnnotationOf`.
- Create-context types: `AnnotationCreateContext`, `AnnotationContextMap`.
- Geometry / color: `Position`, `Size`, `Rect`, `WebColor`.

`PdfAnnotationSubtype` and `PdfStampAnnoObject` were already exported and continue to work unchanged.
