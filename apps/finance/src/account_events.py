"""Infra-applied account occurrences and published balance rules."""
from datetime import date, datetime, time
from zoneinfo import ZoneInfo
from domain import MAX_CENTS, account, allocate, find, instant, require, transaction


def credit(data, ctx, payload):
    a = account(data, payload["account_id"])
    require(a["balance_cents"] + payload["amount_cents"] <= MAX_CENTS, "invalid_event", "Cash exceeds the supported limit.")
    a["balance_cents"] += payload["amount_cents"]
    a["revision"] += 1
    transaction(data, ctx["virtual_now"], "credit", "External credit", [
        {"account_id": a["id"], "amount_cents": payload["amount_cents"]}], payload["source_ref"], source_event_id=ctx["event_id"])


def debit(data, ctx, payload):
    a, obligation = account(data, payload["account_id"]), find(data["obligations"], payload["obligation_id"], "Obligation")
    require(obligation["kind"] == "debit" and obligation["account_id"] == a["id"] and
            obligation["amount_cents"] == payload["amount_cents"], "invalid_event", "Debit must match its published obligation.")
    require(instant(ctx["virtual_now"]) >= instant(obligation["due_at"]), "invalid_event", "Debit is not due yet.")
    attempts = [r for r in data["transactions"] if r.get("occurrence_id") == payload["occurrence_id"]]
    require(all(r["obligation_id"] == obligation["id"] and r["effects"][0]["account_id"] == a["id"] and
                r["requested_cents"] == payload["amount_cents"] for r in attempts),
            "invalid_event", "Occurrence ID already identifies a different debit.")
    if any(r["status"] == "paid" for r in attempts):
        return
    paid = a["balance_cents"] >= payload["amount_cents"]
    if paid:
        a["balance_cents"] -= payload["amount_cents"]
        a["revision"] += 1
    transaction(data, ctx["virtual_now"], "debit", obligation["description"], [
        {"account_id": a["id"], "amount_cents": -payload["amount_cents"] if paid else 0}],
        obligation["source_ref"], status="paid" if paid else "failed", occurrence_id=payload["occurrence_id"],
        obligation_id=obligation["id"], requested_cents=payload["amount_cents"], source_event_id=ctx["event_id"])


def balance_check(data, ctx, payload):
    a, rule = account(data, payload["account_id"]), find(data["rules"], payload["rule_id"], "Account rule")
    require(rule["account_id"] == a["id"], "invalid_event", "Rule belongs to another account.")
    business_date = date.fromisoformat(payload["business_date"])
    local = instant(ctx["virtual_now"]).astimezone(ZoneInfo(rule["timezone"]))
    cutoff = datetime.combine(business_date, time.fromisoformat(rule["assessment_time"]), ZoneInfo(rule["timezone"]))
    require(local.date() == business_date and local >= cutoff, "invalid_event", "Assessment must occur at the published local daily cutoff.")
    if any(r["rule_id"] == rule["id"] and r["business_date"] == payload["business_date"] for r in data["assessments"]):
        return
    balance = a["balance_cents"]
    assessed = rule["fee_cents"] if balance < rule["minimum_cents"] else 0
    paid = min(balance, assessed)
    assessment = {"id": allocate(data, "assessment"), "account_id": a["id"], "rule_id": rule["id"],
                  "business_date": payload["business_date"], "at": ctx["virtual_now"],
                  "balance_cents": balance, "assessed_cents": assessed, "paid_cents": paid,
                  "outstanding_cents": assessed - paid}
    data["assessments"].append(assessment)
    if assessed:
        a["balance_cents"] -= paid
        a["revision"] += 1
        transaction(data, ctx["virtual_now"], "fee", rule["description"], [
            {"account_id": a["id"], "amount_cents": -paid}], rule["source_ref"],
            assessed_cents=assessed, paid_cents=paid, outstanding_cents=assessed - paid, source_event_id=ctx["event_id"])
