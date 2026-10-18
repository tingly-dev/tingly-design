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

# the same folder is the `tingly-design` command (the package's bin)
# `npm i -g` links both names to cli.mjs
node -e 'const b=require(process.argv[1]).bin; if(b["tingly-design"]!=="cli.mjs"||b.td!=="cli.mjs") process.exit(1)' "$DIR/package.json" || { echo "❌ the package bin must give tingly-design and td, both cli.mjs"; exit 1; }
CLI=(node "$DIR/cli.mjs" --projects "$WORK/projects")
[ "$("${CLI[@]}" --version)" = "$(node -p 'require(process.argv[1]).version' "$DIR/package.json")" ] || { echo "❌ tingly-design --version disagrees with package.json"; exit 1; }
"${CLI[@]}" list --json | node -e 'const l=JSON.parse(require("fs").readFileSync(0,"utf8")); if(!l.length) process.exit(1)' || { echo "❌ tingly-design list found no projects"; exit 1; }
"${CLI[@]}" new slides smoke-deck > /dev/null || { echo "❌ tingly-design new failed"; exit 1; }
"${CLI[@]}" check smoke-deck || { echo "❌ a new deck does not pass tingly-design check"; exit 1; }
# the server above is the editor on this projects folder: open finds it instead of starting another
"${CLI[@]}" open smoke-deck --json | node -e 'const o=JSON.parse(require("fs").readFileSync(0,"utf8")); if(!o.running || !o.url.includes("/design/?p=smoke-deck")) process.exit(1)' || { echo "❌ tingly-design open did not find the running server"; exit 1; }
curl -fsS "$BASE/api/projects" | grep -q '"smoke-deck"' || { echo "❌ the running server does not list the deck tingly-design new made"; exit 1; }
"${CLI[@]}" history smoke-deck --json > /dev/null || { echo "❌ tingly-design history failed"; exit 1; }
# the format references ship, and copy into a folder for an agent
"${CLI[@]}" skills add "$WORK/agent" > /dev/null || { echo "❌ tingly-design skills add failed"; exit 1; }
[ -f "$WORK/agent/.claude/skills/slides/SKILL.md" ] || { echo "❌ tingly-design skills add copied no slides skill"; exit 1; }
# the same commands as MCP tools: on stdio, and at the running editor's /mcp
INIT='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"1"}}}'
CALL='{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"check","arguments":{"project":"smoke-deck"}}}'
printf '%s\n%s\n' "$INIT" "$CALL" | "${CLI[@]}" mcp | node -e 'const r=require("fs").readFileSync(0,"utf8").trim().split("\n").map(JSON.parse); if(r.length!==2 || r[0].result.serverInfo.name!=="tingly-design" || r[1].result.isError || !r[1].result.content[0].text.includes("smoke-deck")) process.exit(1)' || { echo "❌ tingly-design mcp did not answer on stdio"; exit 1; }
curl -fsS -H 'content-type: application/json' -d "$CALL" "$BASE/mcp" | grep -q 'smoke-deck' || { echo "❌ the running editor did not answer at /mcp"; exit 1; }
# exports other than zip are drawn by that editor in Chrome (CI runners need its sandbox off)
if "${CLI[@]}" check --json | node -e 'process.exit(JSON.parse(require("fs").readFileSync(0,"utf8")).chrome ? 0 : 1)'; then
  DC_CHROME_SANDBOX=0 "${CLI[@]}" export smoke-deck --as png --slide 1 --out "$WORK/out" > /dev/null || { echo "❌ tingly-design export --as png failed"; exit 1; }
  ls "$WORK/out"/*.png > /dev/null 2>&1 || { echo "❌ tingly-design export --as png wrote no picture"; exit 1; }
else
  echo "(no Chrome here: skipping the picture export)"
fi
echo "✅ bundle starts, answers under /design and seeds the samples; the tingly-design command lists, creates, checks, finds the running server, reads the history, copies the skills, answers MCP and exports a picture"
