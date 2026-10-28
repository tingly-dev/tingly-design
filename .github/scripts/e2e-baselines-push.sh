#!/usr/bin/env bash
# After `DC_RECORD=1 python3 e2e/run.py baseline`: replaces the pictures on the
# e2e-baselines branch with e2e/out/baselines-new/, as one commit naming the
# commit they were taken from (FROM). The branch holds only the pictures and
# shares no history with main. Needs contents: write.
set -euo pipefail

BRANCH=e2e-baselines
NEW=e2e/out/baselines-new
[ -n "$(ls -A "$NEW" 2>/dev/null)" ] || { echo "no pictures in $NEW" >&2; exit 1; }

WORK="$(mktemp -d)"
if git fetch -q origin "$BRANCH"; then
  git worktree add -q "$WORK" FETCH_HEAD
  git -C "$WORK" checkout -q -B "$BRANCH"
else
  git worktree add -q --detach "$WORK"
  git -C "$WORK" checkout -q --orphan "$BRANCH"
fi
git -C "$WORK" rm -rqf --ignore-unmatch .
git -C "$WORK" clean -fdxq
cp "$NEW"/*.png "$WORK"/
git -C "$WORK" add -A
if git -C "$WORK" diff --cached --quiet; then
  echo "the baselines did not change"
  exit 0
fi
git -C "$WORK" commit -qm "Record the screenshot baselines from ${FROM:0:12}"
git -C "$WORK" push -q origin "$BRANCH"
echo "pushed $(find "$NEW" -name '*.png' | wc -l) pictures to $BRANCH"
