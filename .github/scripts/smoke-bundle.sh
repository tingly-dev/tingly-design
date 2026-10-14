#!/usr/bin/env bash
# Usage: smoke-bundle.sh <bundle-dir> [expected-version]
#
# Start the bundle the way a host does (PORT=0, a prefix, a fresh projects
# folder, the server exits when stdin closes), wait for its ready line, then
# check /api/health and that the editor and the sandbox runtime are served.
set -euo pipefail

[ "$#" -ge 1 ] || { echo "usage: $0 <bundle-dir> [expected-version]" >&2; exit 2; }
DIR="$(cd "$1" && pwd)" EXPECT="${2:-}"
WORK="$(mktemp -d)"
LOG="$WORK/server.log"
mkfifo "$WORK/stdin"

(cd "$WORK" && PORT=0 DC_BASE_PATH=/design DC_PROJECTS="$WORK/projects" DC_EXIT_WITH_STDIN=1 \
  node "$DIR/server.mjs" < "$WORK/stdin" > "$LOG" 2>&1) &
PID=$!
exec 3> "$WORK/stdin"   # hold stdin open; closing it stops the server
trap 'exec 3>&-; wait "$PID" 2>/dev/null || true; rm -rf "$WORK"' EXIT

READY=""
for _ in $(seq 1 60); do
  READY="$(grep -m1 '^TINGLY_DESIGN_READY ' "$LOG" || true)"
  [ -n "$READY" ] && break
  kill -0 "$PID" 2>/dev/null || { echo "❌ server exited before it was ready:"; cat "$LOG"; exit 1; }
  sleep 0.5
done
[ -n "$READY" ] || { echo "❌ no ready line after 30s:"; cat "$LOG"; exit 1; }
echo "$READY"

PORT="$(node -e 'console.log(JSON.parse(process.argv[1].slice("TINGLY_DESIGN_READY ".length)).port)' "$READY")"
BASE="http://127.0.0.1:$PORT/design"
HEALTH="$(curl -fsS "$BASE/api/health")"
echo "health: $HEALTH"
if [ -n "$EXPECT" ]; then
  GOT="$(node -e 'console.log(JSON.parse(process.argv[1]).version)' "$HEALTH")"
  [ "$GOT" = "$EXPECT" ] || { echo "❌ /api/health says version $GOT, expected $EXPECT"; exit 1; }
fi
curl -fsS -o /dev/null "$BASE/" || { echo "❌ the editor is not served at $BASE/"; exit 1; }
curl -fsS -o /dev/null "$BASE/sandbox/runtime.js" || { echo "❌ the sandbox runtime is not served"; exit 1; }
[ -n "$(ls -A "$WORK/projects" 2>/dev/null)" ] || { echo "❌ the projects folder was not seeded with the samples"; exit 1; }
echo "✅ bundle starts, answers under /design and seeds the samples"
