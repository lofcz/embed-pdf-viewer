#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/runtime-src"
TARGET="${1:-wasm32}"

case "$TARGET" in
  wasm32)
    OUT="$SRC/out/wasm32"
    GN_TARGET_OS="wasm"
    GN_TARGET_CPU="wasm"
    ;;
  darwin-arm64)
    OUT="$SRC/out/darwin-arm64"
    GN_TARGET_OS="mac"
    GN_TARGET_CPU="arm64"
    ;;
  darwin-x64)
    OUT="$SRC/out/darwin-x64"
    GN_TARGET_OS="mac"
    GN_TARGET_CPU="x64"
    ;;
  *)
    echo "local build target currently supports wasm32, darwin-arm64, darwin-x64; got $TARGET" >&2
    exit 1
    ;;
esac

if [[ ! -d "$SRC/third_party/llvm-build" ]]; then
  "$ROOT/scripts/runtime-sync.sh"
fi

(
  cd "$SRC"
  gn gen "$OUT" --args="is_debug=false treat_warnings_as_errors=false pdf_use_skia=false pdf_enable_xfa=false pdf_enable_v8=false is_component_build=false clang_use_chrome_plugins=false pdf_is_standalone=true use_debug_fission=false use_custom_libcxx=false use_sysroot=false pdf_is_complete_lib=true pdf_use_partition_alloc=false is_clang=false symbol_level=0 target_os=\"$GN_TARGET_OS\" target_cpu=\"$GN_TARGET_CPU\""
  ninja -C "$OUT" pdfium
)

echo "$OUT"
