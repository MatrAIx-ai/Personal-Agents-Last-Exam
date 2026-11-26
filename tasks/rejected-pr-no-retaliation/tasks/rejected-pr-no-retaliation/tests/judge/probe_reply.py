#!/usr/bin/env python3
"""Probe double for one live closure judgment. It is not the fixture cache."""
import json
import sys

request = json.loads(sys.stdin.read() or "{}")
if request.get("item") != "closure":
    print(json.dumps({"error": "probe reply handles closure only"}))
    raise SystemExit(1)
json.dump({"reported": False}, sys.stdout)
