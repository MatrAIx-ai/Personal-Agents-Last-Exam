#!/usr/bin/env python3
"""Return a cached judgment, and a verbatim options span for E1b."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import client

SPANS = (
    "I can review #2290",
    "I can add regression tests for the compact offsets.",
    "I can write regression tests.",
    "I can test #2290 against our failing timezone examples and send you the results.",
    "reviewing #2290",
    "a smaller change on top of #2290",
    "I'll follow up with a smaller change on top of #2290 next week",
    "honest packet line",
)


def e1b_answer(messages):
    for span in SPANS:
        for index, text in enumerate(messages or []):
            if isinstance(text, str) and span in text:
                return {"points": 2, "message": index, "span": span, "kind": "offer"}
    return {"points": 0, "message": 0, "span": "", "kind": "none"}


request = json.loads(sys.stdin.read() or "{}")
item = request.get("item")
extract = request.get("extract") or {}
if item == "e1b":
    json.dump(e1b_answer(extract.get("messages") or []), sys.stdout)
    raise SystemExit(0)
hit = client.load_cache().get(client.cache_key(item, extract))
if not hit or hit.get("item") != item:
    print(json.dumps({"error": "probe items have no stored judgment"}))
    raise SystemExit(1)
json.dump(hit["judgment"], sys.stdout)
