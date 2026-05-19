---
'@embedpdf/pdfium': patch
---

Fix page layout shifting after editing PDFs whose `/Contents` is a split-stream array (e.g. after redaction).

PDF renders `/Contents` as one continuous program, so graphics state set in one stream carries into the next. The previous behaviour rewrote only the dirty streams while keeping the original split boundaries, which could corrupt the graphics-state handoff between streams and shift the visible layout. `CPDF_PageContentGenerator::GenerateContent` now collapses all active page objects into a single canonical content stream when the page has been edited, via `GenerateCanonicalPageStream` + `CPDF_PageContentManager::ReplaceWithSingleStream`. Form XObjects keep their existing single-stream behaviour.
