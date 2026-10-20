#!/usr/bin/env bash
# After the nightly e2e patrol: a red run opens one issue labelled e2e-patrol
# (or comments on the open one), a green run closes it. RESULT is the e2e
# job's result, RUN_URL the run's page; needs GH_TOKEN with issues: write.
set -euo pipefail

LABEL=e2e-patrol
gh label create "$LABEL" --color B60205 --description "The nightly e2e patrol is red" 2>/dev/null || true
OPEN="$(gh issue list --label "$LABEL" --state open --json number --jq '.[0].number // empty')"

if [ "$RESULT" = "success" ]; then
  if [ -n "$OPEN" ]; then
    gh issue close "$OPEN" --comment "Green again: $RUN_URL"
  fi
  exit 0
fi

BODY="The nightly e2e patrol on main is $RESULT: $RUN_URL

The \`e2e-report-*\` artifacts on that run (one per slice) have \`report.md\` (which suites failed and their last lines) and every suite's log."
if [ -n "$OPEN" ]; then
  gh issue comment "$OPEN" --body "$BODY"
else
  gh issue create --title "test(e2e): nightly patrol is red" --label "$LABEL" --label "area/e2e" --body "$BODY"
fi
