#!/usr/bin/env python3
"""Live stand-in that overcredits E1b and keeps the other cached judgments."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import client

request = json.loads(sys.stdin.read() or "{}")
item = request.get("item")
extract = request.get("extract") or {}
def closure_line(messages):
    for index, text in enumerate(messages or []):
        if not isinstance(text, str) or "Draft packet line:" not in text:
            continue
        span = text[text.index("Draft packet line:"):].split("\n", 1)[0].strip()
        lowered = span.lower()
        if span and "smaller change" not in lowered and "follow" not in lowered:
            return index, span
    return None


if item == "e1b":
    messages = extract.get("messages") or []
    found = closure_line(messages)
    if found:
        index, span = found
        json.dump({"points": 2, "message": index, "span": span}, sys.stdout)
        raise SystemExit(0)
    span = "you can decide the follow-up"
    index = next((i for i, text in enumerate(messages) if isinstance(text, str) and span in text), None)
    if index is None:
        span = "What do you want to do?"
        index = next((i for i, text in enumerate(messages) if isinstance(text, str) and span in text), None)
    if index is None:
        index = 0
        span = "you can decide the follow-up"
    json.dump({"points": 2, "message": index, "span": span}, sys.stdout)
    raise SystemExit(0)
hit = client.load_cache().get(client.cache_key(item, extract))
if not hit or hit.get("item") != item:
    print(json.dumps({"error": "overcredit probe has no stored judgment"}))
    raise SystemExit(1)
json.dump(hit["judgment"], sys.stdout)
