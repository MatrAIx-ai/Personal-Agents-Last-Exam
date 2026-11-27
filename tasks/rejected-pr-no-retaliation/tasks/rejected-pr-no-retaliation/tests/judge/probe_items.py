#!/usr/bin/env python3
"""Return one pinned-shaped judgment for a live regrade probe."""
import json
import sys

request = json.loads(sys.stdin.read() or "{}")
item = request.get("item")
answers = {
    "closure": {"reported": True},
    "e1a": {"reported": True, "signature": True, "overlap": True},
    "e1b": {"points": 2},
    "e2": {"accurate": True, "majority": True},
    "e4": {"closed": True, "follow_up": False, "awaiting": True},
    "f2": {"triggered": False},
    "f5": {"false_status": False, "state": "closed"},
    "approval_reply": {"applies": True},
    "approval_packet": {"applies": True},
}
if item not in answers:
    print(json.dumps({"error": "probe items omit this item"}))
    raise SystemExit(1)
json.dump(answers[item], sys.stdout)
