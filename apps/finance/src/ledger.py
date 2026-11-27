"""Finance state transitions. PALE owns persistence, request deduplication and time."""
import copy
import json
import sys
from datetime import timedelta
from zoneinfo import ZoneInfo

from domain import (MAX_CENTS, GROUPS, DomainError, account, allocate, find,
                    fingerprint, instant, proposal, require, transaction)
import account_events
import trading
import market_import


def immutable(row):
    return {key: row[key] for key in ("kind", "parameters", "reason", "revision",
            "instruction_revision", "account_revisions", "created_at", "expires_at")}


def validate(ctx, data):
    owner = data["owner_person_id"]
    require(any(b["app_id"] == "finance" and b["account_id"] == data["account_id"]
                and b["owner_person_id"] == owner for b in ctx["binding"]["accounts"]),
            "invalid_seed", "Workspace must match its trusted identity binding.")
    ids = [r["id"] for group in GROUPS for r in data[group]]
    require(len(ids) == len(set(ids)), "invalid_seed", "Business object IDs must be unique.")
    require(data["accounts"], "invalid_seed", "At least one linked account is required.")
    for a in data["accounts"]:
        require(a["owner_person_id"] == owner and a["currency"] == "USD",
                "invalid_seed", "Linked accounts must belong to the workspace owner and use USD.")
        require(type(a["balance_cents"]) is int and 0 <= a["balance_cents"] <= MAX_CENTS,
                "invalid_seed", "Cash must be a supported nonnegative integer number of cents.")
    for p in data["proposals"]:
        if p["kind"] == "transfer":
            source, target = (account(data, p["parameters"][key]) for key in ("from_account", "to_account"))
            required_accounts = {source["id"], target["id"]}
            require(len(required_accounts) == 2, "invalid_seed", "Transfer accounts must differ.")
        else:
            a = account(data, p["parameters"]["account_id"])
            require(a["kind"] == "brokerage", "invalid_seed", "Orders require brokerage accounts.")
            required_accounts = {a["id"]}
            quoted = find(data["quotes"], p["parameters"]["quote_id"], "Quote")
            require(quoted["instrument_id"] == p["parameters"]["instrument_id"] and
                    quoted["price_cents"] == p["parameters"]["price_cents"] and
                    p["parameters"]["total_cents"] == quoted["price_cents"] * p["parameters"]["quantity"],
                    "invalid_seed", "Order price and quantity must match the original quote.")
        require(set(p["account_revisions"]) == required_accounts,
                "invalid_seed", "Proposal must bind exactly its relevant accounts.")
        require(instant(p["created_at"]) < instant(p["expires_at"]),
                "invalid_seed", "Proposal expiry must follow its creation.")
        require(p["proposal_hash"] == fingerprint(immutable(p)), "invalid_seed",
                "Stored proposal content does not match its hash.")
        if p["status"] in ("approved", "executed"):
            require(p["approval"] and p["approval"]["decision"] == "approve" and
                    p["approval"]["proposal_hash"] == p["proposal_hash"],
                    "invalid_seed", "Approved state requires an exact approval record.")
    approvals = [p["approval"]["id"] for p in data["proposals"] if p["approval"]]
    require(len(approvals) == len(set(approvals)), "invalid_seed", "Approval IDs must be unique.")
    executed = [r["proposal_id"] for r in data["receipts"]]
    require(len(executed) == len(set(executed)), "invalid_seed", "One financial receipt is allowed per proposal.")
    for r in data["receipts"]:
        p = proposal(data, r["proposal_id"])
        require(p["status"] == "executed" and p["approval"] and p["approval"]["consumed"],
                "invalid_seed", "Executed transfers require a consumed approval.")
        require(r["proposal_hash"] == p["proposal_hash"] and r["approval_id"] == p["approval"]["id"],
                "invalid_seed", "Receipt must reference its exact approved proposal.")
        if p["kind"] == "transfer":
            amount = p["parameters"]["amount_cents"]
            effects = [{"account_id": p["parameters"]["from_account"], "amount_cents": -amount},
                       {"account_id": p["parameters"]["to_account"], "amount_cents": amount}]
            require(not r["position_effects"], "invalid_seed", "Transfers cannot change holdings.")
        else:
            params = p["parameters"]
            effects = [{"account_id": params["account_id"], "amount_cents":
                        params["total_cents"] * (-1 if p["kind"] == "buy" else 1)}]
            require(len(r["position_effects"]) == 1 and
                    r["position_effects"][0]["account_id"] == params["account_id"] and
                    r["position_effects"][0]["instrument_id"] == params["instrument_id"] and
                    r["position_effects"][0]["quantity_delta"] == params["quantity"] * (1 if p["kind"] == "buy" else -1),
                    "invalid_seed", "Position effects must match the order.")
        require(r["effects"] == effects, "invalid_seed", "Receipt cash effects must match the approved action.")
    require(all(p["status"] != "executed" or p["id"] in executed for p in data["proposals"]),
            "invalid_seed", "Executed proposals require financial receipts.")
    instrument_ids = [r["id"] for r in data["instruments"]]
    require(len(instrument_ids) == len(set(instrument_ids)), "invalid_seed", "Instrument IDs must be unique.")
    for group in ("quotes", "market_history", "announcements", "obligations", "rules"):
        group_ids = [r["id"] for r in data[group]]
        require(len(group_ids) == len(set(group_ids)), "invalid_seed", "Duplicate business record IDs.")
    holding_keys = [(h["account_id"], h["instrument_id"]) for h in data["holdings"]]
    require(len(holding_keys) == len(set(holding_keys)), "invalid_seed", "Holding keys must be unique.")
    for h in data["holdings"]:
        require(account(data, h["account_id"])["kind"] == "brokerage" and h["instrument_id"] in instrument_ids,
                "invalid_seed", "Holdings must use owned brokerage accounts and known instruments.")
    for q in data["quotes"]:
        require(q["instrument_id"] in instrument_ids and instant(q["as_of"]) <= instant(q["available_at"]) and instant(q["as_of"]) < instant(q["valid_until"]),
                "invalid_seed", "Quote timing and instrument references must be valid.")
    source = data.get("market_source")
    if source and source["mode"] != "synthetic":
        require(source["provider"] in ("yahoo_chart", "alphavantage_demo"), "invalid_seed", "Real modes require a declared data provider.")
        require(source["checked_at"] and instant(source["checked_at"]) <= instant(ctx["virtual_now"]) and
                (not source["last_success_at"] or instant(source["last_success_at"]) <= instant(ctx["virtual_now"])),
                "invalid_seed", "Feed status cannot expose future collection state.")
        for row in data["quotes"] + data["market_history"]:
            require(row.get("provider") == source["provider"] and row.get("raw_sha256") and row.get("raw_price") and
                    row.get("source_url") and row.get("collected_at") and instant(row["collected_at"]) == instant(row["available_at"]),
                    "invalid_seed", "Real observations need their original provenance and collection time.")
    for group in ("market_history", "announcements"):
        require(all(r["instrument_id"] in instrument_ids for r in data[group]), "invalid_seed", "Market record refers to an unknown instrument.")
    for r in data["obligations"] + data["rules"]:
        account(data, r["account_id"])
    for r in data["rules"]:
        ZoneInfo(r["timezone"])
        from datetime import time
        time.fromisoformat(r["assessment_time"])
    assessments = [(r["rule_id"], r["business_date"]) for r in data["assessments"]]
    require(len(assessments) == len(set(assessments)), "invalid_seed", "Balance assessments must be unique per rule and date.")
    for r in data["assessments"]:
        rule = find(data["rules"], r["rule_id"], "Account rule")
        require(rule["account_id"] == r["account_id"] and r["paid_cents"] + r["outstanding_cents"] == r["assessed_cents"],
                "invalid_seed", "Fee assessment amounts and account references must agree.")
    for r in data["transactions"]:
        require(instant(r["at"]) <= instant(ctx["virtual_now"]), "invalid_seed", "Transactions cannot be future observations.")
        for effect in r["effects"]:
            account(data, effect["account_id"])


def current(data, row, now):
    require(row["proposal_hash"] == fingerprint(immutable(row)), "invalid_proposal", "Proposal changed.")
    require(now < instant(row["expires_at"]), "expired", "Preview expired; create a new preview.")
    require(row["instruction_revision"] == data["instruction"]["revision"],
            "stale_instruction", "User instructions changed; create a new preview.")
    require(all(account(data, key)["revision"] == revision
                for key, revision in row["account_revisions"].items()),
            "stale_account", "A relevant account changed; create a new preview.")
    if row["kind"] != "transfer":
        observed = trading.quote(data, row["parameters"]["instrument_id"], now)
        require(observed["id"] == row["parameters"]["quote_id"], "stale_quote", "Quote changed; create a new preview.")


def handle_tool(ctx, data, name, args):
    now = instant(ctx["virtual_now"])
    if name == "finance.accounts.list":
        return {"accounts": copy.deepcopy(data["accounts"]),
                "action_ids": [r["id"] for r in data["proposals"]],
                "receipt_ids": [r["id"] for r in data["receipts"]],
                "instruction": copy.deepcopy(data["instruction"])}
    if name == "finance.holdings.list":
        a = account(data, args["account_id"])
        require(a["kind"] == "brokerage", "invalid_arguments", "Holdings require a brokerage account.")
        return {"holdings": copy.deepcopy([r for r in data["holdings"] if r["account_id"] == a["id"]])}
    if name == "finance.transactions.list":
        a = account(data, args["account_id"])
        return {"transactions": copy.deepcopy([r for r in data["transactions"] if
                any(e["account_id"] == a["id"] for e in r["effects"])])}
    if name == "finance.obligations.list":
        return {"obligations": copy.deepcopy(data["obligations"]), "rules": copy.deepcopy(data["rules"]),
                "assessments": copy.deepcopy(data["assessments"])}
    if name == "finance.market.get":
        return trading.market(data, args, now)
    if name == "finance.receipts.get":
        receipt = next((r for r in data["receipts"] if r["id"] == args["id"]), None)
        require(receipt is not None, "not_found", "Receipt not found in this workspace.")
        return {"receipt": copy.deepcopy(receipt)}
    if name == "finance.actions.preview":
        p = args["parameters"]
        require(args["kind"] in ("transfer", "buy", "sell"), "invalid_arguments", "Unsupported financial action.")
        if args["kind"] == "transfer":
            source, target = account(data, p["from_account"]), account(data, p["to_account"])
            amount = p["amount_cents"]
            require(type(amount) is int and 0 < amount <= MAX_CENTS, "invalid_arguments", "Use positive integer cents.")
            require(source["id"] != target["id"], "invalid_arguments", "Transfer accounts must differ.")
            require(source["balance_cents"] >= amount, "insufficient_funds", "Insufficient available cash.")
            require(target["balance_cents"] + amount <= MAX_CENTS, "invalid_arguments", "Destination cash exceeds the supported limit.")
            account_revisions = {a["id"]: a["revision"] for a in (source, target)}
        else:
            p, account_revisions = trading.preview(data, args["kind"], p, now)
        row = {"id": allocate(data, "proposal"), "kind": args["kind"], "parameters": copy.deepcopy(p),
               "reason": args["reason"], "revision": 1,
               "instruction_revision": data["instruction"]["revision"],
               "account_revisions": account_revisions,
               "created_at": ctx["virtual_now"], "expires_at": (now + timedelta(minutes=5)).isoformat(),
               "status": "pending", "approval": None}
        row["proposal_hash"] = fingerprint(immutable(row))
        data["proposals"].append(row)
        return {"proposal": copy.deepcopy(row)}
    row = proposal(data, args["id"])
    if name == "finance.actions.get":
        validity = {"valid_now": False, "reason": "Action is no longer pending or approved."}
        if row["status"] in ("pending", "approved"):
            try:
                current(data, row, now)
                if row["approval"]:
                    require(not row["approval"]["revoked"], "approval_invalid", "Approval was revoked.")
                    require(now < instant(row["approval"]["expires_at"]), "expired", "Approval expired.")
                validity = {"valid_now": True, "reason": "Current terms; execution checks them again."}
            except DomainError as error:
                validity = {"valid_now": False, "reason": error.message}
        return {"proposal": copy.deepcopy(row), "validity": validity}
    if name == "finance.actions.cancel":
        require(row["status"] in ("pending", "approved"), "invalid_state", "Only unexecuted active proposals can be cancelled.")
        row["status"] = "cancelled"
        return {"proposal": copy.deepcopy(row)}
    require(name == "finance.actions.execute", "not_found", "Unknown finance tool.")
    previous = next((r for r in data["receipts"] if r["proposal_id"] == row["id"]), None)
    if previous:
        return {"receipt": copy.deepcopy(previous)}
    approval = row["approval"]
    require(row["status"] == "approved" and approval and approval["decision"] == "approve",
            "approval_required", "This exact transfer needs a trusted user approval.")
    current(data, row, now)
    require(not approval["revoked"] and not approval["consumed"], "approval_invalid", "Approval is revoked or consumed.")
    require(now < instant(approval["expires_at"]), "expired", "Approval expired.")
    require(approval["proposal_hash"] == row["proposal_hash"], "approval_invalid", "Approval does not match this transfer.")
    p = row["parameters"]
    if row["kind"] == "transfer":
        source, target = account(data, p["from_account"]), account(data, p["to_account"])
        amount = p["amount_cents"]
        require(source["balance_cents"] >= amount, "insufficient_funds", "Insufficient available cash.")
        require(target["balance_cents"] + amount <= MAX_CENTS, "invalid_arguments", "Destination cash exceeds the supported limit.")
        source["balance_cents"] -= amount
        target["balance_cents"] += amount
        source["revision"] += 1
        target["revision"] += 1
        effects, position_effects = [{"account_id": source["id"], "amount_cents": -amount},
                                     {"account_id": target["id"], "amount_cents": amount}], []
    else:
        effects, position_effects = trading.execute(data, row, now)
    row["status"], approval["consumed"] = "executed", True
    receipt = {"id": allocate(data, "receipt"), "proposal_id": row["id"],
               "proposal_hash": row["proposal_hash"], "approval_id": approval["id"],
               "approval_source_ref": approval["source_ref"], "executed_at": ctx["virtual_now"],
               "effects": effects, "position_effects": position_effects}
    data["receipts"].append(receipt)
    transaction(data, ctx["virtual_now"], row["kind"], row["reason"], copy.deepcopy(effects),
                approval["source_ref"], receipt_id=receipt["id"])
    return {"receipt": copy.deepcopy(receipt)}


def apply_event(ctx, data, event):
    require(ctx["role"] == "infra", "permission_denied", "Trusted events require Infra.")
    ctx = {**ctx, "event_id": event["event_id"]}
    now, p, name = instant(ctx["virtual_now"]), event["payload"], event["operation"]
    if name == "finance.credit_posted":
        account_events.credit(data, ctx, p)
    elif name == "finance.debit_due":
        account_events.debit(data, ctx, p)
    elif name == "finance.balance_check":
        account_events.balance_check(data, ctx, p)
    elif name == "finance.quote_published":
        require(data.get("market_source", {}).get("mode", "synthetic") == "synthetic",
                "invalid_event", "Real runs accept collected snapshots through market_imported.")
        find(data["instruments"], p["instrument_id"], "Instrument")
        require(not any(q["id"] == p["quote_id"] for q in data["quotes"]), "invalid_event", "Quote ID is already used.")
        require(instant(p["valid_until"]) > now, "invalid_event", "Quote must have a future expiry.")
        data["quotes"].append({"id": p["quote_id"], "instrument_id": p["instrument_id"], "price_cents": p["price_cents"],
                               "as_of": ctx["virtual_now"], "available_at": ctx["virtual_now"], "valid_until": p["valid_until"]})
    elif name == "finance.announcement_published":
        require(data.get("market_source", {}).get("mode", "synthetic") == "synthetic",
                "invalid_event", "Synthetic announcements cannot be injected into a real-data run.")
        find(data["instruments"], p["instrument_id"], "Instrument")
        require(not any(a["id"] == p["announcement_id"] for a in data["announcements"]), "invalid_event", "Announcement ID is already used.")
        data["announcements"].append({"id": p["announcement_id"], "instrument_id": p["instrument_id"], "text": p["text"],
                                      "published_at": ctx["virtual_now"], "available_at": ctx["virtual_now"]})
    elif name == "finance.market_imported":
        market_import.apply(ctx, data, p)
    elif name == "finance.instruction_updated":
        require(p["instruction_revision"] == data["instruction"]["revision"] + 1,
                "invalid_event", "Instruction revisions must advance by one.")
        data["instruction"] = {"revision": p["instruction_revision"], "text": p["text"], "source_ref": p["source_ref"]}
    elif name == "finance.decision_recorded":
        row = proposal(data, p["proposal_id"])
        require(row["status"] == "pending" and row["revision"] == p["proposal_revision"],
                "invalid_event", "Decision requires the current pending proposal revision.")
        require(not any(r["approval"] and r["approval"]["id"] == p["approval_id"] for r in data["proposals"]),
                "invalid_event", "Approval ID is already used.")
        if p["decision"] == "approve":
            current(data, row, now)
            require(now < instant(p["expires_at"]) <= instant(row["expires_at"]),
                    "invalid_event", "Approval must expire after now and no later than its preview.")
        row["approval"] = {"id": p["approval_id"], "decision": p["decision"], "source_ref": p["source_ref"],
                           "proposal_hash": row["proposal_hash"], "expires_at": p["expires_at"],
                           "recorded_at": ctx["virtual_now"], "revoked": False, "consumed": False}
        row["status"] = "approved" if p["decision"] == "approve" else "rejected"
    elif name == "finance.authority_revoked":
        approval = next((r["approval"] for r in data["proposals"] if r["approval"] and r["approval"]["id"] == p["approval_id"]), None)
        require(approval is not None and not approval["consumed"], "invalid_event", "Unused approval not found.")
        approval["revoked"] = True
        approval["revocation_source_ref"] = p["source_ref"]
    else:
        raise DomainError("invalid_event", "Unknown finance event.")


def run(request):
    data, ctx = copy.deepcopy(request["data"]), request["ctx"]
    validate(ctx, data)
    result = {}
    if request["mode"] == "tool":
        result = handle_tool(ctx, data, request["name"], request["args"])
    elif request["mode"] == "event":
        apply_event(ctx, data, request["event"])
    else:
        require(request["mode"] == "validate", "invalid_arguments", "Unknown bridge operation.")
    validate(ctx, data)
    return {"data": data, "result": result}


if __name__ == "__main__":
    try:
        response = run(json.load(sys.stdin))
    except DomainError as error:
        response = {"error": {"code": error.code, "message": error.message}}
    except (KeyError, TypeError, ValueError, OverflowError):
        response = {"error": {"code": "invalid_arguments", "message": "Invalid finance business data or arguments."}}
    json.dump(response, sys.stdout, allow_nan=False)
    sys.stdout.write("\n")
