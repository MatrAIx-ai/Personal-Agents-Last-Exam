#!/usr/bin/env python3
"""Live stand-in that breaks one Thursday citation on purpose."""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import probe_offer

request = json.loads(sys.stdin.read() or "{}")
answer = probe_offer.answer(request.get("item"), request.get("extract") or {})
mode = os.environ.get("PALE_CITE_MODE") or "short"
if request.get("item") == "e5_thursday" and answer.get("verdicts"):
    row = answer["verdicts"][0]
    if mode == "short":
        row["span"] = row["span"][:40]
    elif mode == "invented":
        row["packet"] = True
        row["file_span"] = "invented excerpt that is not in the file"
    elif mode == "empty":
        row["packet"] = True
        row["file_span"] = ""
    elif mode == "missing-next":
        row.pop("next", None)
if answer is None:
    print(json.dumps({"error": "unsupported item"}))
    raise SystemExit(1)
json.dump(answer, sys.stdout)
