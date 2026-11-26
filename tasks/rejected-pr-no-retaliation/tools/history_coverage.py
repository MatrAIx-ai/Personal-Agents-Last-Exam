#!/usr/bin/env python3
"""Count distinct history dates in the seeded Apps. One zone: America/Los_Angeles."""
import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

PACKAGE = Path(__file__).resolve().parents[1]
WS = PACKAGE / "tasks" / "rejected-pr-no-retaliation" / "environment" / "workspace"
ZONE = ZoneInfo("America/Los_Angeles")
CUTOFF = datetime.fromisoformat("2025-01-01T00:00:00-08:00")
FIRST_SESSION = datetime.fromisoformat("2026-02-09T20:40:00-08:00")


def stamp(value):
    if not isinstance(value, str) or "T" not in value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(ZONE)
    except ValueError:
        return None


def dated(record_id, field, value):
    when = stamp(value)
    if when is None:
        return None
    return {"id": str(record_id), "field": field, "at": when}


def collect_forkyard(data):
    rows = []
    for account in data.get("accounts", []):
        rows.append(dated(account.get("account_id"), "created_at", account.get("created_at")))
    for commit in data.get("commits", []):
        rows.append(dated(commit.get("sha"), "committed_at", commit.get("committed_at")))
    for issue in data.get("issues", []):
        rows.append(dated(str(issue.get("repo")) + "#" + str(issue.get("number")), "created_at", issue.get("created_at")))
    for pull in data.get("pulls", []):
        ident = str(pull.get("repo")) + "#" + str(pull.get("number"))
        rows.append(dated(ident, "created_at", pull.get("created_at")))
        if pull.get("closed_at"):
            rows.append(dated(ident, "closed_at", pull.get("closed_at")))
        if pull.get("merged_at"):
            rows.append(dated(ident, "merged_at", pull.get("merged_at")))
    for comment in data.get("comments", []):
        rows.append(dated(comment.get("comment_id") or comment.get("id"), "created_at", comment.get("created_at")))
    for review in data.get("reviews", []):
        rows.append(dated(review.get("review_id") or review.get("id"), "created_at", review.get("created_at")))
    return [row for row in rows if row]


def collect_postyard(data):
    rows = []
    for account in data.get("accounts", []):
        rows.append(dated(account.get("account_id"), "created_at", account.get("created_at")))
    for post in data.get("posts", []):
        created = post.get("created_at")
        revisions = post.get("revisions") or []
        if not created and revisions:
            created = revisions[0].get("created_at")
        rows.append(dated(post.get("id"), "created_at", created))
    for note in data.get("notes", []):
        rows.append(dated(note.get("id"), "created_at", note.get("created_at")))
    return [row for row in rows if row]


def collect_mail(data):
    return [row for row in (dated(message.get("id"), "received_at", message.get("received_at")) for message in data.get("messages", [])) if row]


def collect_notes(data):
    return [row for row in (dated(note.get("id"), "created_at", note.get("created_at")) for note in data.get("notes", [])) if row]


def collect_calendar(data):
    return [row for row in (dated(event.get("id"), "start", event.get("start")) for event in data.get("events", [])) if row]


def collect_files(data):
    rows = []
    for item in data.get("files", []):
        versions = item.get("versions") or []
        if versions:
            rows.append(dated(item.get("id"), "versions[0].at", versions[0].get("at")))
    return [row for row in rows if row]


SOURCES = {
    "forkyard": (WS / "forkyard" / "seed.json", collect_forkyard),
    "postyard": (WS / "postyard" / "seed.json", collect_postyard),
    "mail": (WS / "mail" / "seed.json", collect_mail),
    "notes": (WS / "notes" / "seed.json", collect_notes),
    "calendar": (WS / "calendar" / "seed.json", collect_calendar),
    "files": (WS / "files" / "seed.json", collect_files),
    "web": (WS / "web" / "seed.json", lambda data: []),
}


def main():
    report = {
        "timezone": "America/Los_Angeles",
        "window_start": "2025-01-01",
        "first_session": "2026-02-09T20:40:00-08:00",
        "purpose": "The dates are the ones behind Tomás's standing notes, his mail with Dana about the promotion packet, his earlier tidewater reviews, and Ingrid's 2025 recommendation. The packet is due 13 February 2026. The window stops at the Monday session that opens the task.",
        "sources": {},
    }
    window = set()
    older = set()
    for name, (path, collector) in SOURCES.items():
        data = json.loads(path.read_text())
        rows = collector(data)
        before = [row for row in rows if row["at"] < FIRST_SESSION]
        in_window = [row for row in before if row["at"] >= CUTOFF]
        pre = [row for row in before if row["at"] < CUTOFF]
        future = [row for row in rows if row["at"] >= FIRST_SESSION]
        dates = {row["at"].date().isoformat() for row in in_window}
        pre_dates = {row["at"].date().isoformat() for row in pre}
        window |= dates
        older |= pre_dates
        by_date = {}
        for row in in_window:
            by_date.setdefault(row["at"].date().isoformat(), []).append(row["id"])
        report["sources"][name] = {
            "file": str(path.relative_to(PACKAGE)),
            "record_count": len(rows),
            "records_before_first_session": len(before),
            "records_in_window": len(in_window),
            "distinct_dates_before_first_session_on_or_after_2025_01_01": len(dates),
            "authoritative_fields": sorted({row["field"] for row in rows}),
            "sample_ids": [row["id"] for row in in_window[:5]],
            "earliest": min((row["at"] for row in before), default=None).isoformat() if before else None,
            "latest_before_first_session": max((row["at"] for row in before), default=None).isoformat() if before else None,
            "pre_2025_dates": sorted(pre_dates),
            "future_record_ids": [row["id"] for row in future],
            "dates": {day: sorted(set(ids)) for day, ids in sorted(by_date.items())},
        }
    report["global_distinct_dates_in_window"] = len(window)
    report["earliest_in_window"] = min(window) if window else None
    report["latest_in_window"] = max(window) if window else None
    report["date_breakdown"] = sorted(window)
    report["pre_2025_dates_excluded_from_the_window"] = sorted(older)
    report["exclusions"] = [
        "Forkyard stamps before 2025-01-01 are shifted forward 366 days in the loaded seed. date-provenance.json keeps the original stamps and is not loaded into the App.",
        "Web pages have no occurrence timestamps. They are reference pages, outside the interaction-date count.",
        "Calendar events that start at or after the first session are the offsite week already on the calendar. They are scheduled state.",
        "Dana's Wednesday email is applied during the run. It is not in the seed and it is outside prior history.",
        "A date that appears in more than one source counts once in the global total.",
    ]
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
