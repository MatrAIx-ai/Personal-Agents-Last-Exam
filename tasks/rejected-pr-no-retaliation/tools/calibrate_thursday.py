#!/usr/bin/env python3
"""Run the pinned Thursday prompt on the calibration set.

The command is PALE_JUDGE_COMMAND, the same adapter the grader uses.
Each item keeps the passage, the record, and the verdict this package expects.
The script writes the live verdict beside that expectation. It leaves the
calibration file unchanged.
"""
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TESTS = ROOT / "tasks" / "rejected-pr-no-retaliation" / "tests"
sys.path.insert(0, str(TESTS / "judge"))
import client

SET_PATH = ROOT / "tools" / "thursday_calibration.json"
E3_PATH = ROOT / "tools" / "e3_calibration.json"


def prompt_text(item):
    return (TESTS / "judge" / client.prompt_file(item, {})).read_text()


def main():
    command = (os.environ.get("PALE_JUDGE_COMMAND") or "").strip()
    if not command:
        print(json.dumps({"error": "PALE_JUDGE_COMMAND is required"}))
        return 2
    source = Path(sys.argv[1]) if len(sys.argv) > 1 else SET_PATH
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else source.with_name(source.stem + "-live.json")
    documents = [json.loads(source.read_text())]
    if source == SET_PATH and E3_PATH.exists():
        documents.append(json.loads(E3_PATH.read_text()))
    rows = []
    prompts = {}
    for document in documents:
        for item in document.get("items") or []:
            kind = item.get("item") or "e5_thursday"
            prompts.setdefault(kind, prompt_text(kind))
            extract = item.get("extract") or {}
            payload = {
                "version": client.VERSION,
                "item": kind,
                "model": client.resolved_model(),
                "temperature": client.PIN.get("temperature", 0),
                "prompt": prompts[kind],
                "extract": extract,
            }
            proc = subprocess.run(command, input=json.dumps(payload), text=True, shell=True, capture_output=True, check=False)
            live = None
            error = ""
            if proc.returncode != 0:
                error = "command failed"
            else:
                try:
                    live = json.loads(proc.stdout)
                except json.JSONDecodeError:
                    error = "output is not JSON"
                else:
                    if not client.live_valid(kind, live, extract):
                        error = "output is invalid"
            expected = item.get("expected") or {}
            rows.append({
                "id": item.get("id"),
                "item": kind,
                "expected": expected,
                "live": live,
                "error": error,
                "match": live == expected and not error,
            })
    report = {
        "prompt_sha256": {name: hashlib.sha256(text.encode()).hexdigest() for name, text in prompts.items()},
        "items": rows,
        "matched": sum(1 for row in rows if row["match"]),
        "checked": len(rows),
    }
    out.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"wrote": str(out), "matched": report["matched"], "checked": report["checked"]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
