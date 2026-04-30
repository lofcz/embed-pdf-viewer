#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$ROOT/../.." && pwd)"
SRC="$ROOT/runtime-src"

if [[ ! -d "$SRC/.git" && ! -f "$SRC/.git" ]]; then
  echo "runtime source checkout missing at $SRC" >&2
  echo "run: git submodule update --init --recursive packages/pdf-runtime/runtime-src" >&2
  exit 1
fi

cat > "$REPO_ROOT/.gclient" <<EOF
solutions = [
  { "name": "packages/pdf-runtime/runtime-src",
    "url":  "https://github.com/embedpdf/pdfium.git",
    "deps_file": "DEPS",
    "managed": False,
    "custom_deps": {},
  },
]
EOF

(
  cd "$SRC"
  gclient sync --no-history --shallow --nohooks --deps=builder
)

rm -f "$REPO_ROOT/.gclient"
