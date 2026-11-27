"""Trusted import of collected observations. No network or clock reads."""
import copy
from domain import instant, require


def merge(rows, incoming, *, history=False):
    existing = {r["id"]: r for r in rows}
    metadata = {"available_at", "collected_at", "raw_sha256", "source_url"} if history else set()
    for row in incoming:
        prior = existing.get(row["id"])
        if prior:
            require({k: v for k, v in prior.items() if k not in metadata} == {k: v for k, v in row.items() if k not in metadata},
                    "invalid_event", "Observation ID cannot identify changed market content.")
        else:
            existing[row["id"]] = copy.deepcopy(row)
    return list(existing.values())


def apply(ctx, data, payload):
    current = data.get("market_source", {}).get("mode", "synthetic")
    require(current in ("live", "replay") and current == payload["mode"],
            "invalid_event", "Real data and replay use a separately initialized run.")
    snapshot = payload["snapshot"]
    require(data["market_source"]["provider"] == snapshot["provider"], "invalid_event", "Changing providers requires a new run.")
    require(instant(snapshot["checked_at"]) == instant(ctx["virtual_now"]),
            "invalid_event", "The feed event time must match its recorded collection barrier.")
    instruments = {r["id"]: r for r in data["instruments"]}
    incoming_ids = {r["id"] for r in snapshot["instruments"]}
    require(incoming_ids == set(instruments), "invalid_event", "Changing the ticker universe requires a new run.")
    for row in snapshot["quotes"] + snapshot["history"]:
        require(row["instrument_id"] in instruments and row["provider"] == snapshot["provider"] and
                instant(row["available_at"]) <= instant(snapshot["checked_at"]),
                "invalid_event", "Collected observation references or times are invalid.")
    data["instruments"] = copy.deepcopy(snapshot["instruments"])
    data["quotes"] = merge(data["quotes"], snapshot["quotes"])
    data["market_history"] = merge(data["market_history"], snapshot["history"], history=True)
    # Raw captures preserve the full sequence. Keep the App's working set bounded;
    # immutable quotes referenced by any action always survive compaction.
    pinned = {p["parameters"]["quote_id"] for p in data["proposals"] if p["kind"] != "transfer"}
    quotes = []
    history = []
    for identity in instruments:
        rows = sorted([q for q in data["quotes"] if q["instrument_id"] == identity], key=lambda q: (instant(q["as_of"]), instant(q["available_at"])))
        keep = {q["id"] for q in rows[-32:]} | pinned
        quotes.extend(q for q in rows if q["id"] in keep)
        for interval in ("1d", "15m"):
            rows = sorted([b for b in data["market_history"] if b["instrument_id"] == identity and b.get("interval", "1d") == interval],
                          key=lambda b: (instant(b["as_of"]), instant(b["available_at"])))
            history.extend(rows[-300:])
    data["quotes"], data["market_history"] = quotes, history
    prior = data.get("market_source", {})
    data["market_source"] = {"mode": payload["mode"], "provider": snapshot["provider"], "status": snapshot["status"],
                             "checked_at": snapshot["checked_at"], "last_success_at": snapshot["checked_at"] if snapshot["quotes"] else prior.get("last_success_at"),
                             "snapshot_id": snapshot["id"], "errors": copy.deepcopy(snapshot["errors"])}
