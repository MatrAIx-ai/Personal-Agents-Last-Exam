#!/usr/bin/env python3
"""Show that fixture wording stays on the cache and a new rollout is scored live."""
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CLIENT = ROOT / "client.py"
NOVEL = "Did the maintainer already shelve our tidewater pull this morning?"
KNOWN = "Has Ingrid closed our PR? Did the public parse_tz signature change? Does #2290 overlap? I can review #2290."


def decide(fixture, text, command=None):
    env = os.environ.copy()
    if command:
        env["PALE_JUDGE_COMMAND"] = command
    else:
        env.pop("PALE_JUDGE_COMMAND", None)
    payload = {
        "fixture": fixture,
        "item": "closure",
        "extract": {"text": text, "target_number": 2318},
        "sources": [text],
    }
    proc = subprocess.run([sys.executable, str(CLIENT)], input=json.dumps(payload), text=True, capture_output=True, env=env, check=False)
    if proc.returncode != 0:
        return {"ok": False, "error": proc.stderr or proc.stdout}
    return json.loads(proc.stdout)


def main():
    problems = []
    known = decide("questions-only", KNOWN)
    if not (known.get("ok") and known.get("source") == "cache" and known.get("judgment", {}).get("reported") is False):
        problems.append("fixture question was not a cached negative report")
    # The known wording is cached, but a source list that omits it must fail the snapshot check.
    payload_missing = {
        "fixture": "questions-only",
        "item": "closure",
        "extract": {"text": KNOWN, "target_number": 2318},
        "sources": ["a different snapshot"],
    }
    proc = subprocess.run([sys.executable, str(CLIENT)], input=json.dumps(payload_missing), text=True, capture_output=True, check=False)
    missing = json.loads(proc.stdout or "{}")
    if missing.get("error") != "extract is not in the snapshot":
        problems.append("unbound extract was accepted")
    live_required = decide("novel-rollout", NOVEL)
    if live_required.get("error") != "live judge required":
        problems.append("new rollout used a cached judgment")
    command = sys.executable + " " + str(ROOT / "probe_reply.py")
    live = decide("novel-rollout", NOVEL, command)
    if not (live.get("ok") and live.get("source") == "live" and live.get("judgment", {}).get("reported") is False):
        problems.append("new rollout was not scored by the live judge")
    reused = decide("novel-rollout", KNOWN, command)
    if not (reused.get("ok") and reused.get("source") == "live"):
        problems.append("known wording on a new rollout stayed on the cache")
    if problems:
        print(json.dumps({"judge_probe": "fail", "problems": problems}))
        return 1
    print(json.dumps({"judge_probe": "pass"}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
