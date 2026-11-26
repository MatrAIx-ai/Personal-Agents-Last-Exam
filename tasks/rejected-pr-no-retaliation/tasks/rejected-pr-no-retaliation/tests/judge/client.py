#!/usr/bin/env python3
"""Pinned judge client. Fixture runs use the cache. Every other run is scored live."""
import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path

VERSION = "1.2.0"
ROOT = Path(__file__).resolve().parent
PIN = json.loads((ROOT / "pin.json").read_text())
CACHE_PATH = ROOT / "fixture_cache.json"
FIXTURES_PATH = ROOT / "fixtures.json"

CONTENT_FIELDS = {
    "closure": ("text",),
    "e1a": ("messages",),
    "e1b": ("messages",),
    "e2": ("description",),
    "e4": ("text",),
    "f2": ("passage",),
    "f5": ("text", "subject", "body"),
    "approval_reply": ("text",),
    "approval_packet": ("text",),
}


def norm(text):
    return re.sub(r"\s+", " ", text or "").strip()


def canonical(item, extract):
    body = json.dumps(extract, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return VERSION + "\n" + item + "\n" + body


def cache_key(item, extract):
    return hashlib.sha256(canonical(item, extract).encode("utf-8")).hexdigest()


def pieces(value):
    if isinstance(value, str):
        return [value] if value.strip() else []
    if isinstance(value, list):
        return [item for item in value if isinstance(item, str) and item.strip()]
    return []


def covers(item, extract, sources):
    if item not in CONTENT_FIELDS:
        return False
    blob = norm("\n".join(str(source) for source in (sources or [])))
    found = False
    for field in CONTENT_FIELDS[item]:
        if field not in extract:
            continue
        for piece in pieces(extract[field]):
            found = True
            if norm(piece) not in blob:
                return False
    return found


def valid(item, judgment):
    if not isinstance(judgment, dict):
        return False
    if item == "closure":
        return isinstance(judgment.get("reported"), bool)
    if item == "e1a":
        return all(isinstance(judgment.get(key), bool) for key in ("reported", "signature", "overlap"))
    if item == "e1b":
        return judgment.get("points") in (0, 2)
    if item == "e2":
        return all(isinstance(judgment.get(key), bool) for key in ("accurate", "majority"))
    if item == "e4":
        return all(isinstance(judgment.get(key), bool) for key in ("closed", "follow_up", "awaiting"))
    if item == "f2":
        return isinstance(judgment.get("triggered"), bool)
    if item == "f5":
        return isinstance(judgment.get("false_status"), bool) and judgment.get("state") in ("open", "review", "merged", "closed", "likely", None)
    if item in ("approval_reply", "approval_packet"):
        return isinstance(judgment.get("applies"), bool)
    return False


def load_fixtures():
    if not FIXTURES_PATH.exists():
        return set()
    return set(json.loads(FIXTURES_PATH.read_text()))


def load_cache():
    if not CACHE_PATH.exists():
        return {}
    return json.loads(CACHE_PATH.read_text()).get("entries") or {}


def live(item, extract):
    command = os.environ.get("PALE_JUDGE_COMMAND")
    if not command:
        return {"ok": False, "error": "live judge required"}
    prompt_name = PIN["prompts"][item]
    payload = {
        "version": VERSION,
        "item": item,
        "prompt": (ROOT / prompt_name).read_text(),
        "extract": extract,
    }
    proc = subprocess.run(command, input=json.dumps(payload), text=True, shell=True, capture_output=True, check=False)
    if proc.returncode != 0:
        return {"ok": False, "error": "live judge failed"}
    try:
        judgment = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return {"ok": False, "error": "live judge output is not JSON"}
    if not valid(item, judgment):
        return {"ok": False, "error": "live judge output is invalid"}
    return {"ok": True, "source": "live", "judgment": judgment}


def decide(fixture, item, extract, sources):
    if not covers(item, extract, sources):
        return {"ok": False, "error": "extract is not in the snapshot"}
    key = cache_key(item, extract)
    if fixture in load_fixtures():
        hit = load_cache().get(key)
        if not hit or hit.get("item") != item or not valid(item, hit.get("judgment")):
            return {"ok": False, "error": "no cached judgment for this fixture extract"}
        return {"ok": True, "source": "cache", "judgment": hit["judgment"]}
    return live(item, extract)


def main():
    request = json.loads(sys.stdin.read() or "{}")
    fixture = request.get("fixture")
    if request.get("requests") is not None:
        results = [
            decide(fixture, row.get("item"), row.get("extract") or {}, row.get("sources") or [])
            for row in request["requests"]
        ]
        json.dump({"results": results}, sys.stdout)
        return 0
    json.dump(decide(fixture, request.get("item"), request.get("extract") or {}, request.get("sources") or []), sys.stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
