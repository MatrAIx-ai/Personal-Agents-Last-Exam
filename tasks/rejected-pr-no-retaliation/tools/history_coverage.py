#!/usr/bin/env python3
"""Count distinct history dates in the seeded Apps. One zone: America/Los_Angeles."""
import json
import re
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

PACKAGE = Path(__file__).resolve().parents[1]
WS = PACKAGE / "tasks" / "rejected-pr-no-retaliation" / "environment" / "workspace"
ZONE = ZoneInfo("America/Los_Angeles")
CUTOFF = datetime.fromisoformat("2025-01-01T00:00:00-08:00")
FIRST_SESSION = datetime.fromisoformat("2026-02-09T20:40:00-08:00")
DT = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})")
DATE = re.compile(r"(?<!\d)(\d{4}-\d{2}-\d{2})(?!T)")

SOURCES = {
    "forkyard": WS / "forkyard" / "seed.json",
    "postyard": WS / "postyard" / "seed.json",
    "mail": WS / "mail" / "seed.json",
    "notes": WS / "notes" / "seed.json",
    "calendar": WS / "calendar" / "seed.json",
    "files": WS / "files" / "seed.json",
    "web": WS / "web" / "seed.json",
}


def collect(path):
    text = path.read_text()
    stamps = []
    for match in DT.finditer(text):
        raw = match.group(0).replace("Z", "+00:00")
        stamps.append(datetime.fromisoformat(raw).astimezone(ZONE))
    date_only = []
    for match in DATE.finditer(text):
        start = match.start(1)
        if start > 0 and text[start - 1] == "T":
            continue
        # Skip the date prefix of a datetime already counted.
        if start + 10 < len(text) and text[start + 10] == "T":
            continue
        date_only.append(match.group(1))
    return stamps, date_only


def main():
    report = {
        "timezone": "America/Los_Angeles",
        "window_start": "2025-01-01",
        "first_session": "2026-02-09T20:40:00-08:00",
        "sources": {},
    }
    window = set()
    older = set()
    for name, path in SOURCES.items():
        stamps, date_only = collect(path)
        before_session = [stamp for stamp in stamps if stamp < FIRST_SESSION]
        in_window = {stamp.date().isoformat() for stamp in before_session if stamp >= CUTOFF}
        pre = {stamp.date().isoformat() for stamp in before_session if stamp < CUTOFF}
        window |= in_window
        older |= pre
        report["sources"][name] = {
            "file": str(path.relative_to(PACKAGE)),
            "datetime_stamps": len(stamps),
            "distinct_dates_before_first_session_on_or_after_2025_01_01": len(in_window),
            "earliest": min(before_session).isoformat() if before_session else None,
            "latest_before_first_session": max(before_session).isoformat() if before_session else None,
            "pre_2025_dates": sorted(pre),
            "date_only_strings_not_part_of_a_datetime": sorted(set(date_only)),
        }
    report["global_distinct_dates_in_window"] = len(window)
    report["earliest_in_window"] = min(window) if window else None
    report["latest_in_window"] = max(window) if window else None
    report["pre_2025_dates_excluded_from_the_window"] = sorted(older)
    report["exclusions"] = [
        "Timestamps before 2025-01-01 stay in the loaded Forkyard fixture and are listed separately. They are outside the in-window count.",
        "Dana's email, the closure, the bystander comment and the session turns are scenario events. They are outside prior history.",
        "Calendar events on 2026-02-10, 2026-02-11 and 2026-02-12 are the offsite week already on the calendar. Their start times are after the first session, so they are scheduled state rather than prior history.",
        "The web corpus has no ISO timestamps. It is reference material, and it is outside the interaction-date count.",
        "A date that is only the prefix of a datetime is counted once, from the datetime.",
    ]
    report["depth_note"] = "The count is the distinct calendar dates present in the pinned fixtures and the short personal layer. No filler dates were added."
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
