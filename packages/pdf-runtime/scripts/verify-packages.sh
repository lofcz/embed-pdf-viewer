#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
target="${1:-all}"

check() {
  test -s "$root/$1" || { echo "missing $1" >&2; exit 1; }
}

check_target() {
  case "$1" in
    wasm32)
      check npm/wasm32/pdfium.js
      check npm/wasm32/pdfium.cjs
      check npm/wasm32/pdfium.wasm
      ;;
    win32-*)
      check "npm/$1/pdf-runtime.node"
      check "npm/$1/pdfium.dll"
      ;;
    *)
      check "npm/$1/pdf-runtime.node"
      ;;
  esac
}

if [[ "$target" != "all" ]]; then
  check_target "$target"
  exit 0
fi

for t in wasm32 darwin-arm64 darwin-x64 linux-x64 linux-arm64 \
         linuxmusl-x64 linuxmusl-arm64 win32-x64 win32-arm64; do
  check_target "$t"
done
echo "all pdf-runtime payloads present"
