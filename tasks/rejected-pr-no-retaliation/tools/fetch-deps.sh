#!/usr/bin/env bash
# Fetch the pinned Forkyard and Postyard commits into .deps and check file hashes.
# Re-running is safe. This script does not push to those branches.
set -euo pipefail
ROOT="${PALE_REPO_ROOT:-$(git rev-parse --show-toplevel)}"
PKG="$ROOT/tasks/rejected-pr-no-retaliation"
LOCK="$PKG/deps.lock.json"
URL="https://github.com/suraj-ranganath/Personal-Agents-Last-Exam"

fetch_tree() {
  local sha="$1" app="$2" branch="$3"
  local dest="$PKG/.deps/$app"
  if [[ -f "$dest/.pin" && "$(cat "$dest/.pin")" == "$sha" && -f "$dest/app.json" ]]; then
    return
  fi
  if ! git -C "$ROOT" cat-file -e "${sha}^{commit}" 2>/dev/null; then
    git -C "$ROOT" fetch "$URL" "$sha" || git -C "$ROOT" fetch "$URL" "refs/heads/${branch}:refs/fetched/${app}"
  fi
  if ! git -C "$ROOT" cat-file -e "${sha}^{commit}" 2>/dev/null; then
    echo "missing commit $sha" >&2
    exit 1
  fi
  rm -rf "$dest"
  mkdir -p "$dest"
  git -C "$ROOT" archive "$sha" "apps/$app" | tar -x -C "$dest" --strip-components=2
  printf '%s\n' "$sha" > "$dest/.pin"
}

mkdir -p "$PKG/.deps"
mapfile -t DEP < <(python3 -c 'import json,sys; d=json.load(open(sys.argv[1]));
[print(x["name"]+" "+x["commit"]+" "+x["branch"]) for x in d["dependencies"]]' "$LOCK")
for row in "${DEP[@]}"; do
  read -r name sha branch <<<"$row"
  fetch_tree "$sha" "$name" "$branch"
done

python3 - "$LOCK" "$PKG" << 'PY'
import hashlib, json, sys
from pathlib import Path
lock = json.loads(Path(sys.argv[1]).read_text())
root = Path(sys.argv[2])
bad = []

def tree_digest(directory):
    digest = hashlib.sha256()
    files = sorted(path for path in directory.rglob("*") if path.is_file() and path.name != ".pin")
    for path in files:
        rel = path.relative_to(directory).as_posix()
        digest.update(rel.encode())
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest(), len(files)

for dep in lock["dependencies"]:
    base = root / ".deps" / dep["name"]
    got, count = tree_digest(base)
    if got != dep.get("tree_sha256") or count != dep.get("tree_files"):
        bad.append(dep["name"] + " tree")
    for rel, digest in dep["files"].items():
        path = base / rel
        if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            bad.append(dep["name"] + "/" + rel)
print(json.dumps({"fetch_deps": "fail" if bad else "pass", "bad": bad}))
if bad:
    sys.exit(1)
PY
