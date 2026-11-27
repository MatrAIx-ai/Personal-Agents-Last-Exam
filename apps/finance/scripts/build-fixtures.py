"""Build original deterministic fixtures. Opening cash includes historical effects."""
import copy
import json
from datetime import datetime, timedelta
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
NOW = datetime.fromisoformat("2026-12-01T09:00:00-08:00")


def write(path, data):
    target = APP / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(data, indent=2) + "\n")


base = {"account_id": "finance-demo", "owner_person_id": "person-demo", "next_id": 1,
        "instruction": {"revision": 1, "text": "Keep enough cash for obligations. Approve each exact transfer or trade before execution.", "source_ref": "user-instruction-1"},
        "accounts": [{"id": i, "name": n, "kind": k, "owner_person_id": "person-demo", "currency": "USD", "balance_cents": b, "revision": 0}
                     for i, n, k, b in [("checking", "Everyday checking", "bank", 420000), ("savings", "Savings", "bank", 800000), ("investing", "Brokerage cash", "brokerage", 300000)]],
        "holdings": [{"account_id": "investing", "instrument_id": "FUND1", "quantity": 5, "cost_cents": 22500}],
        **{key: [] for key in ["proposals", "receipts", "transactions", "assessments", "quotes", "market_history", "announcements"]},
        "instruments": [{"id": "FUND" + str(i), "name": name} for i, name in enumerate(
            ["Broad Market Fund", "Income Fund", "Short Duration Fund", "Global Equity Fund", "Small Company Fund", "Innovation Fund"], 1)],
        "obligations": [{"id": "rent", "account_id": "checking", "kind": "debit", "amount_cents": 450000,
                         "description": "Monthly rent", "due_at": NOW.isoformat(), "recurrence": "monthly; Infra supplies each occurrence", "source_ref": "lease-terms"},
                        {"id": "payroll", "account_id": "checking", "kind": "credit", "amount_cents": 200000,
                         "description": "Expected payroll", "due_at": (NOW + timedelta(days=1)).isoformat(), "recurrence": "monthly; expected until posted", "source_ref": "payroll-notice"},
                        {"id": "utilities", "account_id": "checking", "kind": "debit", "amount_cents": 12000,
                         "description": "Utilities", "due_at": (NOW + timedelta(days=2)).isoformat(), "recurrence": "monthly; Infra supplies each occurrence", "source_ref": "utilities-notice"}],
        "rules": [{"id": "daily-floor", "account_id": "checking", "minimum_cents": 150000, "fee_cents": 1000,
                   "timezone": "America/Los_Angeles", "assessment_time": "23:59:00", "description": "Daily minimum-balance fee",
                   "source_ref": "checking-account-terms"}]}
for i in range(12):
    account_id = ["checking", "savings", "investing"][i % 3]
    base["transactions"].append({"id": f"history-{i + 1}", "at": (NOW - timedelta(days=24 - i)).isoformat(),
        "kind": "history", "description": f"Opening statement record {i + 1}", "effects": [{"account_id": account_id, "amount_cents": (i + 1) * 100 * (-1 if i % 2 else 1)}],
        "source_ref": f"statement-{i + 1}", "status": "posted", "opening_history": True})
for index, instrument in enumerate(base["instruments"]):
    identity, price = instrument["id"], 5000 + index * 700
    base["quotes"].append({"id": f"quote-{identity}-1", "instrument_id": identity, "price_cents": price,
        "as_of": NOW.isoformat(), "available_at": NOW.isoformat(), "valid_until": (NOW + timedelta(minutes=10)).isoformat()})
    for day in range(60):
        at = NOW - timedelta(days=60 - day)
        base["market_history"].append({"id": f"bar-{identity}-{day}", "instrument_id": identity,
            "price_cents": price - 300 + day * 5 + ((day * 7 + index * 3) % 11 - 5) * 7,
            "as_of": at.isoformat(), "available_at": at.isoformat()})
    for number in range(2):
        at = NOW - timedelta(days=12 - number * 7)
        base["announcements"].append({"id": f"news-{identity}-{number}", "instrument_id": identity,
            "text": f"{instrument['name']}: synthetic {'distribution schedule' if number else 'fund update'} published.",
            "published_at": at.isoformat(), "available_at": at.isoformat()})
for scene in range(3):
    data = copy.deepcopy(base)
    data["holdings"] = [{"account_id": "investing", "instrument_id": f"FUND{i + 1}", "quantity": 5 + i, "cost_cents": 22500 + 5000 * i} for i in range(scene + 1)]
    if scene == 1:
        data["accounts"][0]["balance_cents"] = 80000
        data["obligations"][0]["amount_cents"] = 250000
    if scene == 2:
        data["instruction"]["text"] = "Keep the revised cash target available in two months; seek approval for each exact action."
    write(f"fixtures/scenes/scene-{scene + 1}.json", data)
    mail = {"account_id": "mail-demo", "owner_person_id": "person-demo", "address": "demo@example.test", "messages": []}
    for i in range(6):
        mail["messages"].append({"id": f"finance-notice-{i + 1}", "thread_id": f"finance-notice-{i + 1}", "account_id": "mail-demo",
            "from": "notices@example.test", "to": [mail["address"]], "subject": ["Cash need revised", "Rent reminder", "Payroll date", "Account terms", "Utilities estimate", "Planning context"][i],
            "body": ["The cash target is now $5,000 in two months. Review the plan; execute only separately approved financial actions. You may create or update a calendar reminder to review it tomorrow at 10:00 Pacific.",
                     f"Rent is ${data['obligations'][0]['amount_cents'] // 100:,} and due December 1.", "Payroll of $2,000 is expected December 2; it is not posted cash.",
                     "The checking account minimum is $1,500; the daily close fee is $10.", "Utilities are expected to be $120.", "Keep the current commitments visible while revising the plan."][i],
            "received_at": (NOW - timedelta(days=6 - i)).isoformat(), "folder": "inbox", "read": False, "attachments": []})
    calendar = {"account_id": "calendar-demo", "owner_person_id": "person-demo", "calendar_id": "calendar-personal", "timezone": "America/Los_Angeles", "events": []}
    for i in range(3):
        at = NOW + timedelta(days=i + 2, hours=3)
        calendar["events"].append({"id": f"finance-calendar-{i + 1}", "uid": f"finance-calendar-{i + 1}@example.test", "account_id": "calendar-demo", "calendar_id": "calendar-personal",
            "title": ["Cash planning review", "Monthly bills", "Savings check-in"][i], "start": at.isoformat(), "end": (at + timedelta(hours=1)).isoformat(),
            "timezone": "America/Los_Angeles", "organizer_person_id": "person-demo", "attendees": ["person-demo"], "location": "", "status": "confirmed", "sequence": 0, "attachments": []})
    write(f"fixtures/scenes/scene-{scene + 1}-mail.json", mail)
    write(f"fixtures/scenes/scene-{scene + 1}-calendar.json", calendar)
    write(f"fixtures/scenes/scene-{scene + 1}-events.json", [
        {"event_id": "rent-attempt-1", "at": NOW.isoformat(), "operation": "finance.debit_due", "payload": {"account_id": "checking", "obligation_id": "rent", "occurrence_id": "rent-december", "amount_cents": data["obligations"][0]["amount_cents"]}},
        {"event_id": "delayed-payroll", "at": (NOW + timedelta(days=1)).isoformat(), "operation": "finance.credit_posted", "payload": {"account_id": "checking", "amount_cents": 200000, "source_ref": "payroll-posting"}},
        {"event_id": "rent-attempt-2", "at": (NOW + timedelta(days=1, minutes=1)).isoformat(), "operation": "finance.debit_due", "payload": {"account_id": "checking", "obligation_id": "rent", "occurrence_id": "rent-december", "amount_cents": data["obligations"][0]["amount_cents"]}},
        {"event_id": "minimum-balance", "at": "2026-12-02T23:59:00-08:00", "operation": "finance.balance_check", "payload": {"account_id": "checking", "rule_id": "daily-floor", "business_date": "2026-12-02"}}])
write("fixtures/minimal.json", base)
record_groups = ["accounts", "proposals", "receipts", "transactions", "assessments", "instruments", "quotes", "market_history", "announcements", "obligations", "rules"]
dataset = json.loads((APP / "contribution/dataset.json").read_text())
dataset.update(dataset_id="finance-synthetic-v1", description="Three reproducible fictional Finance scenes; deterministic authored prices, no external market data.")
dataset["sources"][0]["generation"] = {"method": "deterministic Python standard-library generation", "tool": "scripts/build-fixtures.py", "tool_version": "0.1.0", "seed": 0,
    "parameters": {"scenes": 3, "accounts_per_scene": 3, "history_per_scene": 12, "instruments": 6, "bars": 360, "announcements": 12, "mail_per_scene": 6, "calendar_per_scene": 3}}
dataset["expected_counts"] = {"records": sum(len(base[g]) for g in record_groups), "assets": 0}
write("contribution/dataset.json", dataset)
