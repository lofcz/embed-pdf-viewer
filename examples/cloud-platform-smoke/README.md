# EmbedPDF Cloud Platform Smoke Example

Small end-to-end test app for the current cloud platform slices.

It starts:

- an embedded `@cloudpdf/server` origin using SQLite + filesystem storage
- a tiny Node admin helper that keeps the HS256 secret server-side
- a Vite browser UI for admin upload, layer-specific token minting, and cloud-engine actions

## Run

```bash
pnpm --filter @embedpdf/example-cloud-platform-smoke build:deps
pnpm --filter @embedpdf/example-cloud-platform-smoke dev
```

Open the Vite URL, usually:

```txt
http://127.0.0.1:5178
```

The example stores local data under:

```txt
examples/cloud-platform-smoke/.data
```

## Useful Env

```bash
CLOUDPDF_SMOKE_JWT_SECRET=cloudpdf-dev-secret-change-me
CLOUDPDF_SMOKE_STATIC_KMS_KEK=<base64-encoded-32-byte-key>
CLOUDPDF_SMOKE_TENANT=tenant-demo
CLOUDPDF_SMOKE_ENGINE_PORT=3210
CLOUDPDF_SMOKE_API_PORT=3211
```

`CLOUDPDF_SMOKE_STATIC_KMS_KEK` is optional for local smoke testing; the
dev server supplies an in-memory-only development key when it is omitted.

Layer testing flow:

1. Upload one PDF with layer `alice`.
2. Mint another token for the same doc with layer `bob`.
3. Paste either token into the tester.
4. Mutate annotations and compare layer behavior.

The admin panel also includes a daily audit JSONL export button. For same-day
smoke testing it sends `allowOpenDay`; production jobs should export closed
days only, for example `yesterday`.
