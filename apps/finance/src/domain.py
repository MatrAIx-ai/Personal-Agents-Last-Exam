"""Shared business helpers. No runtime, network or filesystem state."""
import hashlib
import json
from datetime import datetime

MAX_CENTS = 9_000_000_000_000
GROUPS = ("accounts", "proposals", "receipts", "transactions", "assessments",
          "instruments", "quotes", "market_history", "announcements", "obligations", "rules")


class DomainError(Exception):
    def __init__(self, code, message):
        self.code, self.message = code, message


def require(condition, code, message):
    if not condition:
        raise DomainError(code, message)


def instant(value):
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    require(parsed.tzinfo is not None, "invalid_time", "Time requires a UTC offset.")
    return parsed


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def find(rows, identity, label):
    row = next((r for r in rows if r["id"] == identity), None)
    require(row is not None, "not_found", f"{label} not found in this workspace.")
    return row


def account(data, identity):
    return find(data["accounts"], identity, "Account")


def proposal(data, identity):
    return find(data["proposals"], identity, "Proposal")


def allocate(data, prefix):
    used = {r["id"] for group in GROUPS for r in data[group]}
    while True:
        identity = f"{prefix}-{data['next_id']}"
        data["next_id"] += 1
        if identity not in used:
            return identity


def transaction(data, at, kind, description, effects, source_ref, **fields):
    row = {"id": allocate(data, "transaction"), "at": at, "kind": kind,
           "description": description, "effects": effects, "source_ref": source_ref,
           "status": "posted", **fields}
    data["transactions"].append(row)
    return row
