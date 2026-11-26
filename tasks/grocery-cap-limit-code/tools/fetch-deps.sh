#!/usr/bin/env bash
# Fetch the pinned Keelcard commit into .deps and check every file against deps.lock.json.
# The lock is the hash list named by manifest.json. This script does not push anywhere.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG="$(cd "$HERE/.." && pwd)"
ROOT="$(cd "$PKG/../.." && pwd)"
SHA="c481a2ae10b4bb17725c69f692203f22af793bb9"
URL="https://github.com/suraj-ranganath/Personal-Agents-Last-Exam"
DEST="$PKG/.deps/keelcard"
mkdir -p "$PKG/.deps"
if [[ ! -f "$DEST/app.json" ]]; then
  rm -rf "$DEST"
  mkdir -p "$DEST"
  git -C "$ROOT" fetch "$URL" "$SHA"
  git -C "$ROOT" archive "$SHA" apps/keelcard | tar -x -C "$PKG/.deps" --strip-components=1
fi
if [[ ! -f "$PKG/deps.lock.json" ]]; then
  echo "deps.lock.json is missing. Refusing to treat an unlocked tree as the pin." >&2
  exit 1
fi
node "$HERE/verify-deps.cjs" "$DEST" "$PKG/deps.lock.json"
echo "keelcard $SHA ready at $DEST"
