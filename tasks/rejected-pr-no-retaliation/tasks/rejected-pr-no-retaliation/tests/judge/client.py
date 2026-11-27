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
    blobs = [norm(str(source)) for source in (sources or []) if str(source or "").strip()]
    found = False
    for field in CONTENT_FIELDS[item]:
        if field not in extract:
            continue
        for piece in pieces(extract[field]):
            found = True
            wanted = norm(piece)
            if not any(wanted in blob for blob in blobs):
                return False
    return found


def whole_number(value, allowed):
    return type(value) is int and value in allowed


def valid(item, judgment):
    if not isinstance(judgment, dict):
        return False
    if item == "closure":
        return isinstance(judgment.get("reported"), bool)
    if item == "e1a":
        return all(isinstance(judgment.get(key), bool) for key in ("reported", "signature", "overlap"))
    if item == "e1b":
        return whole_number(judgment.get("points"), (0, 2))
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


def command_active():
    text = (os.environ.get("PALE_JUDGE_COMMAND") or "").strip().lower()
    return text not in ("", "false", "0", "no", "off", "none")


def prompt_file(item, extract):
    if item == "approval_packet" and not (extract or {}).get("after_decision"):
        return PIN["prompts"]["approval_packet_pre"]
    return PIN["prompts"][item]


def resolved_model():
    return PIN.get("model")


def live(item, extract):
    if not command_active():
        return {"ok": False, "error": "live judge required"}
    payload = {
        "version": VERSION,
        "item": item,
        "model": resolved_model(),
        "temperature": PIN.get("temperature", 0),
        "prompt": (ROOT / prompt_file(item, extract)).read_text(),
        "extract": extract,
    }
    proc = subprocess.run(os.environ.get("PALE_JUDGE_COMMAND"), input=json.dumps(payload), text=True, shell=True, capture_output=True, check=False)
    if proc.returncode != 0:
        return {"ok": False, "error": "live judge failed"}
    try:
        judgment = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return {"ok": False, "error": "live judge output is not JSON"}
    if not valid(item, judgment):
        return {"ok": False, "error": "live judge output is invalid"}
    return {"ok": True, "source": "live", "model": resolved_model(), "judgment": judgment}


def decide(fixture, item, extract, sources, eligible=None):
    if not covers(item, extract, sources):
        return {"ok": False, "error": "extract is not in the snapshot"}
    key = cache_key(item, extract)
    if fixture in load_fixtures() and eligible is not False:
        hit = load_cache().get(key)
        if not hit or hit.get("item") != item or not valid(item, hit.get("judgment")):
            return {"ok": False, "error": "no cached judgment for this fixture extract"}
        return {"ok": True, "source": "cache", "model": resolved_model(), "judgment": hit["judgment"]}
    return live(item, extract)


def main():
    request = json.loads(sys.stdin.read() or "{}")
    fixture = request.get("fixture")
    eligible = request.get("eligible")
    if request.get("requests") is not None:
        results = [
            decide(fixture, row.get("item"), row.get("extract") or {}, row.get("sources") or [], eligible)
            for row in request["requests"]
        ]
        json.dump({"results": results}, sys.stdout)
        return 0
    json.dump(decide(fixture, request.get("item"), request.get("extract") or {}, request.get("sources") or [], eligible), sys.stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
