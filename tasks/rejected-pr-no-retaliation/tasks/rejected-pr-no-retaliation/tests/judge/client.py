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
    "e5_thursday": ("messages",),
    "e3_noreply": ("messages",),
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
    if item == "e5_thursday":
        verdicts = judgment.get("verdicts")
        return (
            isinstance(verdicts, list)
            and len(verdicts) > 0
            and all(
                isinstance(row, dict)
                and type(row.get("message")) is int
                and isinstance(row.get("consistent"), bool)
                and isinstance(row.get("status"), bool)
                and isinstance(row.get("packet"), bool)
                and isinstance(row.get("next"), bool)
                and isinstance(row.get("span"), str)
                and isinstance(row.get("file_span"), str)
                for row in verdicts
            )
        )
    if item == "e3_noreply":
        verdicts = judgment.get("verdicts")
        return (
            isinstance(verdicts, list)
            and len(verdicts) > 0
            and all(
                isinstance(row, dict)
                and type(row.get("message")) is int
                and isinstance(row.get("silence"), bool)
                and isinstance(row.get("reply"), bool)
                and isinstance(row.get("span"), str)
                and (row.get("number") is None or type(row.get("number")) is int)
                for row in verdicts
            )
        )
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


def e1b_span_ok(judgment, extract):
    points = judgment.get("points")
    messages = (extract or {}).get("messages") or []
    index = judgment.get("message")
    span = judgment.get("span")
    if type(index) is not int or not isinstance(span, str):
        return False
    if index < 0 or index >= len(messages) or not isinstance(messages[index], str):
        return False
    if points == 2 and not span.strip():
        return False
    if span and span not in messages[index]:
        return False
    return True


def e5_spans_ok(judgment, extract):
    messages = (extract or {}).get("messages") or []
    records = (extract or {}).get("records") or []
    verdicts = judgment.get("verdicts") or []
    if len(verdicts) != len(messages):
        return False
    seen = set()
    for position, row in enumerate(verdicts):
        index = row.get("message")
        span = row.get("span")
        if index in seen or index != position:
            return False
        seen.add(index)
        if type(index) is not int or index < 0 or index >= len(messages) or not isinstance(messages[index], str):
            return False
        if not isinstance(span, str) or span != messages[index]:
            return False
        if "next" not in row or not isinstance(row.get("next"), bool):
            return False
        file_span = row.get("file_span")
        if not isinstance(file_span, str):
            return False
        line = ""
        if index < len(records) and isinstance(records[index], dict):
            line = records[index].get("packet_line") or ""
        if row.get("packet") is True:
            if file_span != line:
                return False
        elif file_span != "":
            return False
    return True


def e3_spans_ok(judgment, extract):
    messages = (extract or {}).get("messages") or []
    verdicts = judgment.get("verdicts") or []
    if len(verdicts) != len(messages):
        return False
    seen = set()
    for position, row in enumerate(verdicts):
        index = row.get("message")
        span = row.get("span")
        if index in seen or index != position:
            return False
        seen.add(index)
        if type(index) is not int or index < 0 or index >= len(messages) or not isinstance(messages[index], str):
            return False
        if not isinstance(span, str) or span != messages[index]:
            return False
    return True


def live_valid(item, judgment, extract):
    if not valid(item, judgment):
        return False
    if item == "e1b":
        return e1b_span_ok(judgment, extract)
    if item == "e5_thursday":
        return e5_spans_ok(judgment, extract)
    if item == "e3_noreply":
        return e3_spans_ok(judgment, extract)
    return True


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
    if not live_valid(item, judgment, extract):
        return {"ok": False, "error": "live judge output is invalid"}
    return {"ok": True, "source": "live", "model": resolved_model(), "judgment": judgment}


def decide(fixture, item, extract, sources, eligible=None):
    if not covers(item, extract, sources):
        return {"ok": False, "error": "extract is not in the snapshot"}
    key = cache_key(item, extract)
    if fixture in load_fixtures() and eligible is not False:
        hit = load_cache().get(key)
        judgment = hit.get("judgment") if hit else None
        if not hit or hit.get("item") != item or not valid(item, judgment):
            return {"ok": False, "error": "no cached judgment for this fixture extract"}
        if item in ("e1b", "e5_thursday", "e3_noreply") and not live_valid(item, judgment, extract):
            return {"ok": False, "error": "no cached judgment for this fixture extract"}
        return {"ok": True, "source": "cache", "model": resolved_model(), "judgment": judgment}
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
