#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT/scripts/wasm-dev.sh"
SRC="$ROOT/runtime-src"
TARGET="wasm32"
EMSDK_VERSION="3.1.72"
LOCK_DIR="$ROOT/.cache/wasm-dev"
RUNNING="$LOCK_DIR/running"
PENDING="$LOCK_DIR/pending"

mkdir -p "$LOCK_DIR"

if [[ ! -d "$SRC/.git" && ! -f "$SRC/.git" ]]; then
  echo "runtime-src missing; run: git submodule update --init --recursive packages/pdf-runtime/runtime-src" >&2
  exit 1
fi

for cmd in gn ninja gclient; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "missing $cmd on PATH; install depot_tools and add it to PATH" >&2
    echo "see: https://commondatastorage.googleapis.com/chrome-infra-docs/flat/depot_tools/docs/html/depot_tools_tutorial.html#_setting_up" >&2
    exit 1
  fi
done

ensure_emsdk() {
  local emsdk_dir="$SRC/third_party/emsdk"
  if [[ ! -d "$emsdk_dir/.git" ]]; then
    git clone https://github.com/emscripten-core/emsdk.git "$emsdk_dir"
  fi
  "$emsdk_dir/emsdk" install "$EMSDK_VERSION"
  "$emsdk_dir/emsdk" activate "$EMSDK_VERSION"
  # shellcheck disable=SC1091
  source "$emsdk_dir/emsdk_env.sh"
}

case "$(uname -s)" in
  Darwin) export PDF_RUNTIME_TARGET_OS_LIST="mac emscripten" ;;
  Linux)  export PDF_RUNTIME_TARGET_OS_LIST="linux emscripten" ;;
  *) echo "wasm:dev only supports Darwin or Linux hosts" >&2; exit 1 ;;
esac

build_once() {
  ensure_emsdk
  "$SRC/scripts/embedpdf-runtime/build-target.sh" "$TARGET"
  local artifact
  artifact="$("$SRC/scripts/embedpdf-runtime/package-target.sh" "$TARGET" | tail -n1)"
  "$ROOT/scripts/runtime-use-local.sh" "$TARGET" "$artifact"
  PDF_RUNTIME_BUILD_FILE="$ROOT/pdf-runtime-build.local.json" \
    "$ROOT/scripts/build-target.sh" "$TARGET"
  echo "pdf-runtime wasm refreshed"
}

if [[ "${WASM_DEV_BUILD_ONCE:-}" == "1" ]]; then
  if [[ -f "$RUNNING" ]]; then
    touch "$PENDING"
    echo "build already running; queued rebuild"
    exit 0
  fi
  trap 'rm -f "$RUNNING"' EXIT
  while :; do
    touch "$RUNNING"
    rm -f "$PENDING"
    build_once
    [[ -f "$PENDING" ]] || break
    echo "rebuild requested while building; running again"
  done
  exit 0
fi

CHOKIDAR_BIN="$ROOT/node_modules/.bin/chokidar"
if [[ ! -x "$CHOKIDAR_BIN" ]]; then
  echo "chokidar binary missing at $CHOKIDAR_BIN; run: pnpm install --filter @embedpdf/pdf-runtime" >&2
  exit 1
fi

cd "$SRC"
exec "$CHOKIDAR_BIN" \
  "core/**/*.{cc,cpp,h}" \
  "fpdfsdk/**/*.{cc,cpp,h}" \
  "fxbarcode/**/*.{cc,cpp,h}" \
  "fxjs/**/*.{cc,cpp,h}" \
  "xfa/**/*.{cc,cpp,h}" \
  "public/**/*.h" \
  "constants/**/*.h" \
  --initial \
  --debounce 2000 \
  -c "WASM_DEV_BUILD_ONCE=1 bash '$SCRIPT'"
