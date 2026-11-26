#!/usr/bin/env python3
"""
Reproducible Task history coverage report per docs/submission-evidence.md §4
for scoped-correction-notice (PR #158).
"""
import hashlib
import json
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

EVIDENCE_DIR = Path(__file__).resolve().parent
PKG_DIR = EVIDENCE_DIR.parent.parent.parent
WS_DIR = PKG_DIR / "tasks" / "scoped-correction-notice" / "environment" / "workspace"
TZ = ZoneInfo("America/New_York")
CUTOFF = datetime.fromisoformat("2026-11-18T09:15:00-05:00")

SOURCES = [
    ("mail", "mail/seed.json", "messages", "received_at"),
    ("messages", "messages/seed.json", "messages", "sent_at"),
    ("notes", "notes/seed.json", "notes", "created_at"),
    ("contacts", "contacts/seed.json", "contacts", "created_at"),
]


def main() -> None:
    per_source = {}
    global_dates = set()
    date_breakdown = defaultdict(list)

    for app_id, rel_path, list_key, date_field in SOURCES:
        p = WS_DIR / rel_path
        raw_bytes = p.read_bytes()
        sha = hashlib.sha256(raw_bytes).hexdigest()
        data = json.loads(raw_bytes.decode("utf-8"))
        records = data[list_key]
        included = 0
        excluded = []
        dates = set()
        for rec in records:
            dt = datetime.fromisoformat(rec[date_field])
            if dt < CUTOFF:
                d_str = dt.astimezone(TZ).date().isoformat()
                dates.add(d_str)
                global_dates.add(d_str)
                date_breakdown[d_str].append(f"{app_id}:{rec['id']}")
                included += 1
            else:
                excluded.append({"id": rec["id"], date_field: rec[date_field], "reason": "at_or_after_session1_cutoff"})

        per_source[app_id] = {
            "seed_file": f"tasks/scoped-correction-notice/environment/workspace/{rel_path}",
            "sha256": sha,
            "date_field": date_field,
            "total_records": len(records),
            "pre_session_records": included,
            "excluded_records": excluded,
            "distinct_dates": len(dates),
            "dates": sorted(dates),
        }

    sorted_global = sorted(global_dates)
    report = {
        "schema_version": "lifepack.history-coverage.v1",
        "task_id": "scoped-correction-notice",
        "timezone": "America/New_York",
        "first_session_cutoff": CUTOFF.isoformat(),
        "scope_note": (
            "Focused single-editor errata scoping task spanning 16 calendar days "
            "(2026-11-02 through 2026-11-18). Fewer than 300 dates because the task tests "
            "a discrete editorial policy note, v1 vs v2 delivery logs, a 15-member Contacts group, "
            "and mid-task co-reader/timing updates."
        ),
        "global_distinct_dates": len(sorted_global),
        "earliest_date": sorted_global[0] if sorted_global else None,
        "latest_date": sorted_global[-1] if sorted_global else None,
        "per_source": per_source,
        "date_breakdown": dict(sorted(date_breakdown.items())),
    }
    out = EVIDENCE_DIR / "history-coverage.json"
    out.write_bytes((json.dumps(report, indent=2) + "\n").encode("utf-8"))
    print(f"Wrote {out} (global_distinct_dates={report['global_distinct_dates']})")


if __name__ == "__main__":
    main()
