#!/usr/bin/env bash
# Compress PNG screenshots before they go to the `pr-assets` branch (colours and size stay visually the same).
#   scripts/compress-pngs.sh <file-or-dir>...     needs pngquant and oxipng
# pngquant (256 colours, quality 85-100; a file it cannot do that well is kept as is) then oxipng (lossless).
set -euo pipefail
command -v pngquant >/dev/null && command -v oxipng >/dev/null || { echo "needs pngquant and oxipng" >&2; exit 1; }
[ $# -gt 0 ] || { echo "usage: $0 <file-or-dir>..." >&2; exit 1; }
find "$@" -name '*.png' -print0 | while IFS= read -r -d '' f; do
  pngquant --quality=85-100 --speed=1 --strip --force --skip-if-larger -o "$f" "$f" || true
  oxipng -q -o 4 --strip safe "$f"
done
