#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/runtime-src"
TARGET="wasm32"

build_once() {
  "$ROOT/scripts/runtime-build-local.sh" "$TARGET"
  local artifact
  artifact="$("$ROOT/scripts/runtime-package-local.sh" "$TARGET")"
  "$ROOT/scripts/runtime-use-local.sh" "$TARGET" "$artifact"
  PDF_RUNTIME_BUILD_FILE="$ROOT/pdf-runtime-build.local.json" "$ROOT/scripts/build-target.sh" "$TARGET"
  echo "pdf-runtime wasm refreshed"
}

build_once

if ! command -v watchexec >/dev/null 2>&1; then
  echo "watchexec not found; ran one build and exiting"
  exit 0
fi

cd "$SRC"
watchexec --exts cc,cpp,h --ignore 'third_party/**' --restart --shell bash -- "$(declare -f build_once); ROOT='$ROOT'; TARGET='$TARGET'; build_once"
