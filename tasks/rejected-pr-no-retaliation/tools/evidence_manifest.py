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


def problems(manifest):
    found = []
    for row in manifest.get("runs") or []:
        label = row.get("label") or row.get("run_id")
        rel = (row.get("artifacts") or {}).get("run")
        path = EVIDENCE / rel
        if not path.exists():
            found.append(label + " trace missing")
            continue
        if row["artifacts"].get("sha256") != digest(path):
            found.append(label + " sha256")
        run = json.loads(path.read_text())
        if row.get("wall") != run.get("wall"):
            found.append(label + " wall")
    return found


def main():
    manifest = json.loads(MANIFEST.read_text())
    if "--write" in sys.argv:
        MANIFEST.write_text(json.dumps(refreshed(manifest), indent=2) + "\n")
        manifest = json.loads(MANIFEST.read_text())
    found = problems(manifest)
    if found:
        print(json.dumps({"evidence_manifest": "fail", "problems": found}))
        return 1
    print(json.dumps({"evidence_manifest": "pass", "runs": len(manifest.get("runs") or [])}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
