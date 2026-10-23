#!/usr/bin/env bash
# Rebuild the README's moving pictures from the design-motion sample, with the app's own renderer.
#   scripts/readme-assets.sh        needs Chromium (DC_CHROME) and ffmpeg
# hero.gif is the idea → edit → more scenes, kinds.gif the six kinds; cover.png is the piece's cover.
set -euo pipefail
cd "$(dirname "$0")/.."
out=docs/images/readme
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
pnpm --filter @dc/sandbox build
pnpm -s tingly-design export projects/design-motion --as mp4 --format wide --out "$tmp"
cp "$tmp/design-motion-wide-cover.png" "$out/cover.png"
gif() { # start seconds, length, output
  ffmpeg -loglevel error -y -ss "$1" -t "$2" -i "$tmp/design-motion-wide.mp4" \
    -vf "fps=15,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" "$3"
}
gif 3 14 "$out/hero.gif"
gif 18 14.5 "$out/kinds.gif"
