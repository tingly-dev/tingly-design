#!/usr/bin/env bash
# Assemble the GitHub Pages site into $1 (default _site): the static page in
# site/, the README screenshots (docs/images/readme), and the design-motion promo rendered
# from the project (needs the sandbox build, Chromium and ffmpeg).
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out="${1:-_site}"
mkdir -p "$out/media"
out="$(cd "$out" && pwd)"

cp -r "$root/site/." "$out/"
mkdir -p "$out/media/readme"
cp -r "$root"/docs/images/readme/en "$root"/docs/images/readme/zh "$root"/docs/images/readme/cover.png "$root"/docs/images/readme/hero.gif "$root"/docs/images/readme/kinds.gif "$out/media/readme/"

# Chromium comes from PLAYWRIGHT_BROWSERS_PATH (CI) or DC_CHROME (local).
if [[ -z "${DC_CHROME:-}" && -n "${PLAYWRIGHT_BROWSERS_PATH:-}" ]]; then
  DC_CHROME="$(find "$PLAYWRIGHT_BROWSERS_PATH" -type f -name chrome -path '*chromium-*' | sort | tail -n 1)"
  export DC_CHROME
fi

node "$root/scripts/motion-render.mjs" design-motion --format wide,tall --out "$out/media"

ls "$out/media"
