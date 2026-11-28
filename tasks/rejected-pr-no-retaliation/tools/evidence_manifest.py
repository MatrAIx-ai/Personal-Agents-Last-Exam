#!/usr/bin/env python3
"""Check the packaged evidence manifest against the delivered traces."""
import hashlib
import json
import sys
from pathlib import Path

PACKAGE = Path(__file__).resolve().parents[1]
EVIDENCE = PACKAGE / "demo" / "rejected-pr-no-retaliation" / "evidence"
MANIFEST = EVIDENCE / "manifest.json"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def refreshed(manifest):
    for row in manifest.get("runs") or []:
        rel = (row.get("artifacts") or {}).get("run")
        if not rel:
            continue
        path = EVIDENCE / rel
        run = json.loads(path.read_text())
        row["wall"] = run.get("wall") or row.get("wall")
        row["artifacts"]["sha256"] = digest(path)
    return manifest


def problems(manifest, evidence=EVIDENCE):
    found = []
    indexed = []
    seen = set()
    for row in manifest.get("runs") or []:
        label = row.get("label") or row.get("run_id")
        rel = (row.get("artifacts") or {}).get("run")
        if not rel:
            found.append(str(label) + " path missing")
            continue
        if rel in seen:
            found.append(str(label) + " duplicate")
        seen.add(rel)
        indexed.append(rel)
        path = evidence / rel
        if not path.exists():
            found.append(str(label) + " trace missing")
            continue
        if row["artifacts"].get("sha256") != digest(path):
            found.append(str(label) + " sha256")
        run = json.loads(path.read_text())
        if row.get("wall") != run.get("wall"):
            found.append(str(label) + " wall")
    delivered = sorted(path.relative_to(evidence).as_posix() for path in (evidence / "runs").glob("*/run.json"))
    missing = [rel for rel in delivered if rel not in seen]
    if missing:
        found.append("omitted " + ",".join(missing))
    extra = [rel for rel in indexed if rel not in delivered and (evidence / rel).exists()]
    if extra:
        found.append("unlisted directory " + ",".join(extra))
    return found


def omission_probe(manifest):
    copy = json.loads(json.dumps(manifest))
    copy["runs"] = [row for row in copy.get("runs") or [] if row.get("label") != "control-approve-post"]
    found = problems(copy)
    if not any(item.startswith("omitted ") and "control-approve-post" in item for item in found):
        return ["omitted control-approve-post was accepted"]
    return []


def main():
    manifest = json.loads(MANIFEST.read_text())
    if "--write" in sys.argv:
        MANIFEST.write_text(json.dumps(refreshed(manifest), indent=2) + "\n")
        manifest = json.loads(MANIFEST.read_text())
    found = problems(manifest) + omission_probe(manifest)
    if found:
        print(json.dumps({"evidence_manifest": "fail", "problems": found}))
        return 1
    print(json.dumps({"evidence_manifest": "pass", "runs": len(manifest.get("runs") or [])}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
