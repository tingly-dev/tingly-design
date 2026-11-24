#!/usr/bin/env bash
# After the e2e patrol: a red run opens one issue labelled e2e-patrol (or
# comments on the open one); a green nightly run closes it, a green run on a
# release tag leaves it alone (the tag need not be main's head). RESULT is the
# e2e job's result, RUN_URL the run's page, EVENT the trigger (schedule or a
# tag push), REF_NAME the tag; needs GH_TOKEN with issues: write.
set -euo pipefail

LABEL=e2e-patrol
gh label create "$LABEL" --color B60205 --description "The nightly e2e patrol is red" 2>/dev/null || true
OPEN="$(gh issue list --label "$LABEL" --state open --json number --jq '.[0].number // empty')"

EVENT="${EVENT:-schedule}"

if [ "$RESULT" = "success" ]; then
  if [ "$EVENT" = "schedule" ] && [ -n "$OPEN" ]; then
    gh issue close "$OPEN" --comment "Green again: $RUN_URL"
  fi
  exit 0
fi

if [ "$EVENT" = "schedule" ]; then
  WHAT="The nightly e2e patrol on main is $RESULT"
  TITLE="test(e2e): nightly patrol is red"
else
  WHAT="The full e2e set on release tag ${REF_NAME:?} is $RESULT (the release itself does not wait on it)"
  TITLE="test(e2e): full set is red on $REF_NAME"
fi
BODY="$WHAT: $RUN_URL

The \`e2e-report-*\` artifacts on that run (one per slice) have \`report.md\` (which suites failed and their last lines) and every suite's log."
if [ -n "$OPEN" ]; then
  gh issue comment "$OPEN" --body "$BODY"
else
  gh issue create --title "$TITLE" --label "$LABEL" --label "area/e2e" --body "$BODY"
fi
