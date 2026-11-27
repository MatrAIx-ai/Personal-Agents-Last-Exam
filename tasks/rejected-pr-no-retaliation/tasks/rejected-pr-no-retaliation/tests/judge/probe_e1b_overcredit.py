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
if item == "e1b":
    json.dump({"points": 2, "action": "you can decide the follow-up"}, sys.stdout)
    raise SystemExit(0)
hit = client.load_cache().get(client.cache_key(item, extract))
if not hit or hit.get("item") != item:
    print(json.dumps({"error": "overcredit probe has no stored judgment"}))
    raise SystemExit(1)
json.dump(hit["judgment"], sys.stdout)
