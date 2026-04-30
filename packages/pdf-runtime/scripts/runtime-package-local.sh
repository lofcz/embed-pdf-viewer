#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/runtime-src"
TARGET="${1:-wasm32}"

case "$TARGET" in
  wasm32)
    OUT="$SRC/out/wasm32"
    LIB="$OUT/obj/libpdfium.a"
    ;;
  darwin-arm64)
    OUT="$SRC/out/darwin-arm64"
    LIB="$OUT/obj/libpdfium.a"
    ;;
  darwin-x64)
    OUT="$SRC/out/darwin-x64"
    LIB="$OUT/obj/libpdfium.a"
    ;;
  *)
    echo "local package target currently supports wasm32, darwin-arm64, darwin-x64; got $TARGET" >&2
    exit 1
    ;;
esac

if [[ ! -f "$LIB" ]]; then
  echo "missing $LIB; run runtime-build-local.sh $TARGET first" >&2
  exit 1
fi

ARTIFACT_DIR="$ROOT/build/local-artifacts"
STAGING="$ROOT/build/local-staging/$TARGET"
ARCHIVE="$ARTIFACT_DIR/libembedpdf-pdf-runtime-$TARGET-local.tar.gz"

rm -rf "$STAGING"
mkdir -p "$STAGING/include" "$STAGING/lib" "$STAGING/LICENSES" "$ARTIFACT_DIR"

cp -R "$SRC/public/." "$STAGING/include/"
cp "$LIB" "$STAGING/lib/libpdfium.a"
cp "$OUT/args.gn" "$STAGING/args.gn"
cp "$SRC/LICENSE" "$STAGING/LICENSES/PDFIUM_LICENSE"

cat > "$STAGING/BUILD-METADATA.json" <<EOF
{
  "fork": "embedpdf/pdfium",
  "target": "$TARGET",
  "sha": "$(git -C "$SRC" rev-parse HEAD)",
  "createdAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "local": true
}
EOF

tar -czf "$ARCHIVE" -C "$STAGING" .
echo "$ARCHIVE"
