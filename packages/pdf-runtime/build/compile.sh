#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${PDF_RUNTIME_TARGET:-wasm32}"
LIB_DIR="$ROOT/build/libpdfium/$TARGET"
OUT_DIR="$ROOT/npm/wasm32"
GEN_DIR="$ROOT/build/generated"

mkdir -p "$OUT_DIR"

em++ "$LIB_DIR/lib/libpdfium.a" \
  -sENVIRONMENT=node,worker,web,shell \
  -sMODULARIZE=1 \
  -sWASM=1 \
  -sALLOW_MEMORY_GROWTH=1 \
  -sALLOW_TABLE_GROWTH=1 \
  -sEXPORT_NAME=createPdfRuntimeWasm \
  -sASSERTIONS=1 \
  -sEXPORTED_RUNTIME_METHODS="$(cat "$GEN_DIR/exported-runtime-methods.txt")" \
  -sEXPORTED_FUNCTIONS="$(cat "$GEN_DIR/exported-functions.txt")" \
  -I"$LIB_DIR/include" \
  -std=c++17 \
  -Wall \
  --no-entry \
  -o "$OUT_DIR/pdfium.cjs"
