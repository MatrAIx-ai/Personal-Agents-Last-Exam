#!/usr/bin/env bash
# Reproduce the validation batch outside the package unless PALE_WRITE_PACKAGE_EVIDENCE=1.
set -euo pipefail
ROOT="${PALE_REPO_ROOT:-$(git rev-parse --show-toplevel)}"
PKG="$ROOT/tasks/rejected-pr-no-retaliation"
TASK="$PKG/tasks/rejected-pr-no-retaliation"
if [[ "${PALE_WRITE_PACKAGE_EVIDENCE:-}" == 1 ]]; then
  OUT="$PKG/demo/rejected-pr-no-retaliation/evidence"
else
  OUT="${PALE_EVIDENCE_DIR:-/tmp/rpr-evidence}"
fi
RUNS="$OUT/runs"
bash "$PKG/tools/fetch-deps.sh"
rm -rf "$RUNS"
mkdir -p "$RUNS"
run_plan() {
  local name="$1"
  local plan="$2"
  shift 2
  mkdir -p "$RUNS/$name"
  node "$TASK/environment/local-driver/run.cjs" --plan "$plan" --out "$RUNS/$name/run.json" --run-id "rpr-$name" "$@"
  python3 "$TASK/tests/test_outcomes.py" --grade "$RUNS/$name/run.json" --write "$RUNS/$name/score.json"
}
for name in reference-a reference-b do-nothing forbidden-f1 forbidden-f2 forbidden-f4 forbidden-f5 never-tell partial-e1b partial-e3 partial-e4 no-pr no-reply-a no-reply-b control-merge control-technical control-approve-post thanks-unapproved research; do
  run_plan "$name" "$TASK/solution/plans/$name.json"
done
run_plan reference-a-hinted "$TASK/solution/plans/reference-a.json" --hinted
for plan in "$TASK"/solution/plans/adversarial/*.json; do
  name="$(basename "$plan" .json)"
  run_plan "$name" "$plan"
done
python3 "$PKG/tools/layout_smoke.py"
python3 "$PKG/tools/history_coverage.py" > "$OUT/history-coverage.json"
node "$TASK/environment/local-driver/reset_check.cjs" > "$OUT/reset.json"
node "$TASK/environment/local-driver/world.test.cjs"
python3 "$TASK/tests/test_outcomes.py" --check-rubric
python3 "$TASK/tests/test_outcomes.py" --check-boundaries
python3 "$TASK/tests/test_outcomes.py" --check-suite "$RUNS"
python3 "$TASK/tests/test_outcomes.py" --check-suite "$RUNS" --expect "$TASK/tests/adversarial_outcomes.json"
python3 - "$OUT" << 'PY'
import hashlib, json, sys
from pathlib import Path
out = Path(sys.argv[1])
rows = []
for path in sorted(out.rglob("*")):
    if path.is_file() and path.name != "index.json":
        rows.append({"path": str(path.relative_to(out)), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
index = {"schema": "rpr.evidence-index.v1", "files": rows}
(out / "index.json").write_text(json.dumps(index, indent=2) + "\n")
again = json.loads((out / "index.json").read_text())
bad = []
for row in again["files"]:
    digest = hashlib.sha256((out / row["path"]).read_bytes()).hexdigest()
    if digest != row["sha256"]:
        bad.append(row["path"])
if bad:
    print(json.dumps({"index": "fail", "bad": bad}))
    raise SystemExit(1)
print(json.dumps({"index": "pass", "files": len(again["files"]), "out": str(out)}))
PY
echo VALIDATE_OK
