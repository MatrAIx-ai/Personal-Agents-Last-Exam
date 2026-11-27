"""Whole-share simulation and time-filtered synthetic or collected observations."""
import copy
from domain import MAX_CENTS, account, find, instant, require


def visible(rows, now, time_field):
    return [r for r in rows if instant(r[time_field]) <= now and instant(r["available_at"]) <= now]


def quote(data, instrument_id, now, executable=True):
    find(data["instruments"], instrument_id, "Instrument")
    rows = [r for r in visible(data["quotes"], now, "as_of") if r["instrument_id"] == instrument_id]
    require(rows, "unavailable", "No observed quote is available for this instrument.")
    row = max(enumerate(rows), key=lambda pair: (instant(pair[1]["as_of"]), pair[0]))[1]
    if executable:
        require(now < instant(row["valid_until"]), "expired", "Quote expired; wait for a current quote.")
    return row


def position(data, account_id, instrument_id):
    return next((p for p in data["holdings"] if p["account_id"] == account_id and p["instrument_id"] == instrument_id), None)


def preview(data, kind, parameters, now):
    a = account(data, parameters["account_id"])
    require(a["kind"] == "brokerage", "invalid_arguments", "Trading requires a brokerage account.")
    quantity = parameters["quantity"]
    require(type(quantity) is int and 1 <= quantity <= 1_000_000,
            "invalid_arguments", "Quantity must be a positive whole number of shares.")
    observed = quote(data, parameters["instrument_id"], now)
    total = observed["price_cents"] * quantity
    require(total <= MAX_CENTS, "invalid_arguments", "Order value exceeds the supported limit.")
    held = position(data, a["id"], parameters["instrument_id"])
    if kind == "buy":
        require(a["balance_cents"] >= total, "insufficient_funds", "Insufficient brokerage cash.")
        require((held["quantity"] if held else 0) + quantity <= 1_000_000 and
                (held["cost_cents"] if held else 0) + total <= MAX_CENTS,
                "invalid_arguments", "Resulting holding exceeds the supported limit.")
    else:
        require(held and held["quantity"] >= quantity, "insufficient_shares", "Insufficient owned shares.")
        require(a["balance_cents"] + total <= MAX_CENTS, "invalid_arguments", "Resulting cash exceeds the supported limit.")
    return {**copy.deepcopy(parameters), "quote_id": observed["id"], "price_cents": observed["price_cents"],
            "total_cents": total}, {a["id"]: a["revision"]}


def execute(data, row, now):
    p, kind = row["parameters"], row["kind"]
    observed = quote(data, p["instrument_id"], now)
    require(observed["id"] == p["quote_id"] and observed["price_cents"] == p["price_cents"],
            "stale_quote", "The quote changed; preview and approve the new terms.")
    # Repeat balance/position checks immediately before committing the fill.
    preview(data, kind, {key: p[key] for key in ("account_id", "instrument_id", "quantity")}, now)
    a, held = account(data, p["account_id"]), position(data, p["account_id"], p["instrument_id"])
    if kind == "buy":
        if held is None:
            held = {"account_id": a["id"], "instrument_id": p["instrument_id"], "quantity": 0, "cost_cents": 0}
            data["holdings"].append(held)
        cost_delta, quantity_delta, cash_delta = p["total_cents"], p["quantity"], -p["total_cents"]
    else:
        cost_delta = -(held["cost_cents"] * p["quantity"] // held["quantity"])
        quantity_delta, cash_delta = -p["quantity"], p["total_cents"]
    held["quantity"] += quantity_delta
    held["cost_cents"] += cost_delta
    if held["quantity"] == 0:
        data["holdings"].remove(held)
    a["balance_cents"] += cash_delta
    a["revision"] += 1
    return [{"account_id": a["id"], "amount_cents": cash_delta}], [
        {"account_id": a["id"], "instrument_id": p["instrument_id"],
         "quantity_delta": quantity_delta, "cost_delta_cents": cost_delta}]


def market(data, args, now):
    instrument_id = args.get("instrument_id")
    instruments = [find(data["instruments"], instrument_id, "Instrument")] if instrument_id else data["instruments"]
    ids = {i["id"] for i in instruments}
    quotes = []
    for identity in ids:
        rows = [q for q in visible(data["quotes"], now, "as_of") if q["instrument_id"] == identity]
        if rows:
            row = max(enumerate(rows), key=lambda pair: (instant(pair[1]["as_of"]), pair[0]))[1]
            quotes.append({**copy.deepcopy(row), "executable": now < instant(row["valid_until"])})
    revisions = {}
    for row in sorted(visible(data["market_history"], now, "as_of"), key=lambda r: (instant(r["available_at"]), instant(r["as_of"]))):
        if row["instrument_id"] in ids:
            revisions[(row["instrument_id"], row.get("interval", "1d"), row.get("bar_start_at", row["as_of"]))] = row
    return {"instruments": copy.deepcopy(instruments), "quotes": sorted(quotes, key=lambda q: q["instrument_id"]),
            "history": copy.deepcopy(sorted(revisions.values(), key=lambda r: (r["instrument_id"], r.get("interval", "1d"), instant(r["as_of"])))),
            "announcements": copy.deepcopy([r for r in visible(data["announcements"], now, "published_at") if r["instrument_id"] in ids]),
            "observed_at": now.isoformat(), "source": copy.deepcopy(data.get("market_source", {
                "mode": "synthetic", "provider": "authored", "status": "ready", "checked_at": None,
                "last_success_at": None, "snapshot_id": None, "errors": []}))}
