#!/usr/bin/env bash
# After the e2e patrol: a red run opens one issue labelled e2e-patrol (or
# comments on the open one), a green nightly run closes it. On a release tag
# (EVENT=push, REF_NAME the tag) the same issues are opened or commented on,
# naming the tag, but a green run leaves them alone: the tag need not be main's
# head, so it says nothing about main now. Screenshots that differ
# from their baselines are warnings, not red: they keep one issue labelled
# e2e-baseline open (a comment per night), closed when every picture matches.
# RESULT is the e2e job's result, RUN_URL the run's page, REPORTS the folder
# the e2e-report-* artifacts were downloaded to; needs GH_TOKEN with issues: write.
set -euo pipefail

# open, comment on or close the one open issue with this label: track LABEL TITLE BODY (an empty BODY closes it)
track() {
  local label="$1" title="$2" body="$3" open
  open="$(gh issue list --label "$label" --state open --json number --jq '.[0].number // empty')"
  if [ -z "$body" ]; then
    if [ -n "$open" ] && [ "$EVENT" = schedule ]; then gh issue close "$open" --comment "Green again: $RUN_URL"; fi
  elif [ -n "$open" ]; then
    gh issue comment "$open" --body "$body"
  else
    gh issue create --title "$title" --label "$label" --label "area/e2e" --body "$body"
  fi
}

EVENT="${EVENT:-schedule}"
if [ "$EVENT" = schedule ]; then
  WHERE="the nightly e2e patrol on main"
  PATROL_TITLE="test(e2e): nightly patrol is red"
else
  WHERE="the full e2e set on release tag ${REF_NAME:?} (the release does not wait on it)"
  PATROL_TITLE="test(e2e): full set is red on $REF_NAME"
fi

gh label create e2e-patrol --color B60205 --description "The nightly e2e patrol is red" 2>/dev/null || true
gh label create e2e-baseline --color FBCA04 --description "Editor screenshots differ from their baselines" 2>/dev/null || true

BODY=""
if [ "$RESULT" != "success" ]; then
  BODY="${WHERE^} is $RESULT: $RUN_URL

The \`e2e-report-*\` artifacts on that run (one per slice) have \`report.md\` (which suites failed and their last lines) and every suite's log."
fi
track e2e-patrol "$PATROL_TITLE" "$BODY"

# the reports are missing when the run was cut short; then nothing is known about the pictures, so leave that issue be
shopt -s nullglob
reports=("${REPORTS:-e2e-reports}"/*/report.json)
[ ${#reports[@]} -gt 0 ] || exit 0
WARNINGS="$(jq -r '.suites[] | .warnings // [] | .[] | "- " + .' "${reports[@]}")"
BODY=""
if [ -n "$WARNINGS" ]; then
  BODY="On $WHERE ($RUN_URL) these screenshots differ from the \`e2e-baselines\` branch:

$WARNINGS

The picture, its baseline and a diff of each are in the run's \`e2e-baseline-diffs-*\` artifacts. A change made on purpose: run the E2E patrol workflow by hand with \"record baselines\". Otherwise it is a regression to fix."
fi
track e2e-baseline "test(e2e): screenshots differ from their baselines" "$BODY"
