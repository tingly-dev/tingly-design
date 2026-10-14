#!/usr/bin/env bash
# Usage: npm-publish.sh <tarball> <dist-tag> <name>...
#
# Publish one packed bundle under each npm name (with provenance, public,
# under <dist-tag>). The contents are the same for every name; only "name" in
# package.json differs. Idempotent: a version already on the registry is a
# skip, so a re-run after a partial failure finishes the rest.
set -euo pipefail

[ "$#" -ge 3 ] || { echo "usage: $0 <tarball> <dist-tag> <name>..." >&2; exit 2; }
TARBALL="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")" DIST_TAG="$2"
shift 2

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
tar -xzf "$TARBALL" -C "$WORK"
VERSION="$(node -p 'require(process.argv[1]).version' "$WORK/package/package.json")"

for name in "$@"; do
  if npm view "$name@$VERSION" version >/dev/null 2>&1; then
    echo "⏭️  $name@$VERSION is already on npm"
    continue
  fi
  node -e 'const f=process.argv[1],p=require(f);p.name=process.argv[2];require("fs").writeFileSync(f,JSON.stringify(p,null,2)+"\n")' \
    "$WORK/package/package.json" "$name"
  echo "📦 publishing $name@$VERSION (dist-tag $DIST_TAG)"
  (cd "$WORK/package" && npm publish --provenance --access public --tag "$DIST_TAG")
done
