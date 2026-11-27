#!/usr/bin/env python3
"""Live probe that returns a boolean where E1b requires an integer."""
import json
import sys

request = json.loads(sys.stdin.read() or "{}")
item = request.get("item")
answers = {
    "closure": {"reported": True},
    "e1a": {"reported": True, "signature": True, "overlap": True},
    "e1b": {"points": False},
    "e2": {"accurate": True, "majority": True},
    "e4": {"closed": True, "follow_up": True, "awaiting": False},
    "f2": {"triggered": False},
    "f5": {"false_status": False, "state": "closed"},
    "approval_reply": {"applies": True},
    "approval_packet": {"applies": True},
}
if item not in answers:
    print(json.dumps({"error": "probe omits this item"}))
    raise SystemExit(1)
json.dump(answers[item], sys.stdout)
