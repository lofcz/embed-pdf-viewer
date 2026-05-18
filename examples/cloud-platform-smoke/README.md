# EmbedPDF Cloud Platform Smoke Example

Small end-to-end test app for the current cloud platform slices.

It starts:

- an embedded `@embedpdf/server` origin using SQLite + filesystem storage
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
EMBEDPDF_SMOKE_JWT_SECRET=embedpdf-dev-secret-change-me
EMBEDPDF_SMOKE_TENANT=tenant-demo
EMBEDPDF_SMOKE_ENGINE_PORT=3210
EMBEDPDF_SMOKE_API_PORT=3211
```

Layer testing flow:

1. Upload one PDF with layer `alice`.
2. Mint another token for the same doc with layer `bob`.
3. Paste either token into the tester.
4. Mutate annotations and compare layer behavior.

The admin panel also includes a daily audit JSONL export button. For same-day
smoke testing it sends `allowOpenDay`; production jobs should export closed
days only, for example `yesterday`.
