#!/usr/bin/env bash
# What e2e/run.py needs on a fresh Ubuntu runner: Python Playwright with its
# headless shell (full Chromium in headless mode misplaces clicks inside a
# zoomed artboard; --with-deps also brings the fonts it needs), ffmpeg for the
# video checks, and a git identity for the commits git.py makes.
set -euo pipefail

sudo apt-get update -qq
sudo apt-get install -y -qq ffmpeg >/dev/null

python3 -m pip install --quiet -r e2e/requirements.txt
python3 -m playwright install --with-deps --only-shell chromium

git config --global user.name "e2e"
git config --global user.email "e2e@localhost"
