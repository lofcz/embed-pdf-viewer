---
'@cloudpdf/server': minor
'@cloudpdf/admin-api': minor
'@cloudpdf/admin': minor
'@cloudpdf/engine': minor
'@embedpdf/engine-core': minor
'@embedpdf/engine-services': minor
'@embedpdf/engine': minor
---

Initial public release of the CloudPDF server stack and the Engine v3 packages.

- `@cloudpdf/server`: self-hostable Fastify HTTP/REST server fronting a native PDFium worker pool.
- `@cloudpdf/admin` / `@cloudpdf/admin-api`: Node admin SDK and shared HTTP contracts.
- `@cloudpdf/engine`: cloud client speaking the Engine v3 interface over HTTPS.
- `@embedpdf/engine-core`: transport-agnostic Engine v3 core (interfaces, DTOs, wire schemas, conformance harness).
- `@embedpdf/engine-services`: runtime-agnostic Engine v3 service implementations.
- `@embedpdf/engine`: local WASM PDFium engine (renamed from `@embedpdf/engine-local`).
