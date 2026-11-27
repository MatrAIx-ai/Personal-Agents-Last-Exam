"""Generate the App-owned Finance contracts with PALE's supported schema subset."""
import copy
import json
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
MAX = 9_000_000_000_000


def write(path, value):
    (APP / path).write_text(json.dumps(value, indent=2) + "\n")


def obj(properties, required=None):
    return {"type": "object", "properties": properties,
            "required": list(properties) if required is None else required, "additionalProperties": False}


def array(items):
    return {"type": "array", "items": items}


def integer(minimum=0, maximum=MAX):
    return {"type": "integer", "minimum": minimum, "maximum": maximum}


def ref(name):
    # Core embeds seed schemas in its administrative input schemas. File-qualified
    # pointers retain their meaning when embedded in a different schema document.
    return {"$ref": "seed.schema.json#/$defs/" + name}


S = {"type": "string", "minLength": 1, "maxLength": 100}
TEXT = {"type": "string", "minLength": 1, "maxLength": 2000}
DATE = {"type": "string", "format": "date-time"}
BOOL = {"type": "boolean"}
HASH = {"type": "string", "pattern": "^[a-f0-9]{64}$"}
VERSION = obj({"epoch": integer(1), "revision": integer()})
DEFS = {
    "account": obj({"id": S, "name": TEXT, "kind": {"enum": ["bank", "brokerage"]},
                    "owner_person_id": S, "currency": {"const": "USD"}, "balance_cents": integer(), "revision": integer()}),
    "instruction": obj({"revision": integer(1), "text": TEXT, "source_ref": S}),
    "transfer": obj({"from_account": S, "to_account": S, "amount_cents": integer(1)}),
    "order_input": obj({"account_id": S, "instrument_id": S, "quantity": integer(1, 1_000_000)}),
    "holding": obj({"account_id": S, "instrument_id": S, "quantity": integer(1, 1_000_000), "cost_cents": integer()}),
    "instrument": obj({"id": S, "name": TEXT}),
    "quote": obj({"id": S, "instrument_id": S, "price_cents": integer(1), "as_of": DATE, "available_at": DATE, "valid_until": DATE}),
    "bar": obj({"id": S, "instrument_id": S, "price_cents": integer(1), "as_of": DATE, "available_at": DATE}),
    "announcement": obj({"id": S, "instrument_id": S, "text": TEXT, "published_at": DATE, "available_at": DATE}),
    "effect": obj({"account_id": S, "amount_cents": integer(-MAX)}),
    "position_effect": obj({"account_id": S, "instrument_id": S, "quantity_delta": integer(-1_000_000, 1_000_000), "cost_delta_cents": integer(-MAX)}),
    "obligation": obj({"id": S, "account_id": S, "kind": {"enum": ["credit", "debit"]}, "amount_cents": integer(1),
                       "description": TEXT, "due_at": DATE, "recurrence": TEXT, "source_ref": S}),
    "rule": obj({"id": S, "account_id": S, "minimum_cents": integer(), "fee_cents": integer(1), "timezone": S,
                 "assessment_time": {"type": "string", "pattern": "^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$"}, "description": TEXT, "source_ref": S}),
    "assessment": obj({"id": S, "account_id": S, "rule_id": S, "business_date": {"type": "string", "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"},
                       "at": DATE, "balance_cents": integer(), "assessed_cents": integer(), "paid_cents": integer(), "outstanding_cents": integer()}),
}
NULL = {"type": "null"}
DEFS["instrument"]["properties"]["ticker"] = S
SOURCE_FIELDS = {"provider": {"enum": ["yahoo_chart", "alphavantage_demo"]}, "source_url": TEXT,
                 "collected_at": DATE, "raw_sha256": HASH, "raw_price": S,
                 "delay_seconds": {"anyOf": [integer(), NULL]},
                 "interval": {"enum": ["1d", "15m", "quote"]},
                 "price_kind": {"enum": ["last_trade", "daily_reference", "intraday_reference"]}}
for definition in ("quote", "bar"):
    DEFS[definition]["properties"].update(SOURCE_FIELDS)
DEFS["bar"]["properties"].update({"bar_start_at": DATE, "bar_complete": BOOL,
    **{name + "_price": S for name in ("open", "high", "low", "close")},
    "volume": {"anyOf": [integer(), NULL]}})
DEFS["feed_error"] = obj({"instrument_id": S, "interval": {"enum": ["1d", "15m"]}, "message": TEXT})
DEFS["market_source"] = obj({"mode": {"enum": ["synthetic", "live", "replay"]},
    "provider": {"enum": ["authored", "yahoo_chart", "alphavantage_demo"]},
    "status": {"enum": ["ready", "degraded", "unavailable"]}, "checked_at": {"anyOf": [DATE, NULL]},
    "last_success_at": {"anyOf": [DATE, NULL]}, "snapshot_id": {"anyOf": [S, NULL]}, "errors": array(ref("feed_error"))})
DEFS["market_snapshot"] = obj({"id": S, "provider": SOURCE_FIELDS["provider"], "checked_at": DATE,
    "status": {"enum": ["ready", "degraded", "unavailable"]}, "instruments": {"type": "array", "minItems": 1, "maxItems": 64, "items": ref("instrument")},
    "quotes": {"type": "array", "maxItems": 64, "items": ref("quote")},
    "history": {"type": "array", "maxItems": 1440, "items": ref("bar")}, "errors": array(ref("feed_error"))})
DEFS["order"] = obj({**DEFS["order_input"]["properties"], "quote_id": S, "price_cents": integer(1), "total_cents": integer(1)})
DEFS["approval"] = obj({"id": S, "decision": {"enum": ["approve", "reject"]}, "source_ref": S, "proposal_hash": HASH,
                        "expires_at": DATE, "recorded_at": DATE, "revoked": BOOL, "consumed": BOOL, "revocation_source_ref": S},
                       ["id", "decision", "source_ref", "proposal_hash", "expires_at", "recorded_at", "revoked", "consumed"])
DEFS["proposal"] = obj({"id": S, "kind": {"enum": ["transfer", "buy", "sell"]}, "parameters": {"anyOf": [ref("transfer"), ref("order")]},
                        "reason": TEXT, "revision": integer(1), "instruction_revision": integer(1),
                        "account_revisions": {"type": "object", "additionalProperties": integer()}, "created_at": DATE, "expires_at": DATE,
                        "status": {"enum": ["pending", "approved", "rejected", "cancelled", "executed"]},
                        "approval": {"anyOf": [ref("approval"), {"type": "null"}]}, "proposal_hash": HASH})
DEFS["receipt"] = obj({"id": S, "proposal_id": S, "proposal_hash": HASH, "approval_id": S, "approval_source_ref": S,
                       "executed_at": DATE, "effects": array(ref("effect")), "position_effects": array(ref("position_effect"))})
transaction_properties = {"id": S, "at": DATE, "kind": {"enum": ["history", "credit", "debit", "fee", "transfer", "buy", "sell"]},
                          "description": TEXT, "effects": array(ref("effect")), "source_ref": S,
                          "status": {"enum": ["posted", "paid", "failed"]}, "opening_history": BOOL, "receipt_id": S, "source_event_id": S,
                          "occurrence_id": S, "obligation_id": S, "requested_cents": integer(1),
                          "assessed_cents": integer(), "paid_cents": integer(), "outstanding_cents": integer()}
DEFS["transaction"] = obj(transaction_properties, ["id", "at", "kind", "description", "effects", "source_ref", "status"])
seed = obj({"account_id": S, "owner_person_id": S, "instruction": ref("instruction"), "next_id": integer(1),
            **{key: array(ref(definition)) for key, definition in {
                "accounts": "account", "holdings": "holding", "proposals": "proposal", "receipts": "receipt",
                "transactions": "transaction", "instruments": "instrument", "quotes": "quote", "market_history": "bar",
                "announcements": "announcement", "obligations": "obligation", "rules": "rule", "assessments": "assessment"}.items()}})
seed.update({"$schema": "https://json-schema.org/draft/2020-12/schema", "$defs": DEFS})
seed["properties"]["market_source"] = ref("market_source")
write("schemas/seed.schema.json", seed)

payloads = {
    "finance.credit_posted": obj({"account_id": S, "amount_cents": integer(1), "source_ref": S}),
    "finance.debit_due": obj({"account_id": S, "obligation_id": S, "occurrence_id": S, "amount_cents": integer(1)}),
    "finance.balance_check": obj({"account_id": S, "rule_id": S, "business_date": {"type": "string", "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"}}),
    "finance.quote_published": obj({"quote_id": S, "instrument_id": S, "price_cents": integer(1), "valid_until": DATE}),
    "finance.announcement_published": obj({"announcement_id": S, "instrument_id": S, "text": TEXT}),
    "finance.instruction_updated": obj({"instruction_revision": integer(2), "text": TEXT, "source_ref": S}),
    "finance.decision_recorded": obj({"approval_id": S, "proposal_id": S, "proposal_revision": integer(1),
                                     "decision": {"enum": ["approve", "reject"]}, "expires_at": DATE, "source_ref": S}),
    "finance.authority_revoked": obj({"approval_id": S, "source_ref": S}),
    "finance.market_imported": obj({"mode": {"enum": ["live", "replay"]}, "snapshot": ref("market_snapshot")}),
}
write("schemas/events.schema.json", {"oneOf": [obj({"event_id": S, "at": DATE, "operation": {"const": name}, "payload": p}) for name, p in payloads.items()]})


def tool_ref(name):
    return {"$ref": "schemas/seed.schema.json#/$defs/" + name}


def output(fields):
    success = obj({"status": {"enum": ["ok", "committed"]}, "app_id": {"const": "finance"}, "version": VERSION,
                   "duplicate": BOOL, **fields}, ["status", "app_id", "version", *fields])
    error = obj({"status": {"type": "string"}, "message": {"type": "string"}, "applied": {"const": False},
                 "version": VERSION, "current_version": VERSION}, ["status", "message", "applied", "version"])
    return {"type": "object", "anyOf": [success, error]}


quote_view = copy.deepcopy(DEFS["quote"])
quote_view["properties"]["executable"] = BOOL
quote_view["required"].append("executable")
rows = [
    ("accounts.list", True, {}, {"accounts": array(tool_ref("account")), "action_ids": array(S), "receipt_ids": array(S), "instruction": tool_ref("instruction")}, "Read owned accounts, posted cash, current instruction and action/receipt references in this workspace."),
    ("holdings.list", True, {"account_id": S}, {"holdings": array(tool_ref("holding"))}, "Read whole-share positions and total acquisition costs."),
    ("transactions.list", True, {"account_id": S}, {"transactions": array(tool_ref("transaction"))}, "Read posted transactions, failed debit attempts and fees for one owned account."),
    ("obligations.list", True, {}, {"obligations": array(tool_ref("obligation")), "rules": array(tool_ref("rule")), "assessments": array(tool_ref("assessment"))}, "Read public obligations, minimum-balance terms and fee assessments. Expected income is not posted cash."),
    ("market.get", True, {"instrument_id": S}, {"instruments": array(tool_ref("instrument")), "quotes": array(quote_view), "history": array(tool_ref("bar")), "announcements": array(tool_ref("announcement")), "observed_at": DATE, "source": tool_ref("market_source")}, "Read currently available quotes, history and announcements with source/mode metadata. Real observations remain reference prices for simulated fills. Expired quotes are non-executable."),
    ("actions.preview", False, {"kind": {"enum": ["transfer", "buy", "sell"]}, "parameters": {"anyOf": [tool_ref("transfer"), tool_ref("order_input")]}, "reason": TEXT}, {"proposal": tool_ref("proposal")}, "Store an exact transfer or whole-share buy/sell preview. No financial effect occurs before a trusted approval and execution."),
    ("actions.get", True, {"id": S}, {"proposal": tool_ref("proposal"), "validity": obj({"valid_now": BOOL, "reason": TEXT})}, "Read a proposal, its trusted approval and current validity without modifying state."),
    ("actions.cancel", False, {"id": S}, {"proposal": tool_ref("proposal")}, "Cancel a pending or approved unexecuted action."),
    ("actions.execute", False, {"id": S}, {"receipt": tool_ref("receipt")}, "Execute exactly one current approved action. Re-execution returns the original financial receipt."),
    ("receipts.get", True, {"id": S}, {"receipt": tool_ref("receipt")}, "Read original committed cash and position effects."),
]
tools = []
for suffix, read_only, inputs, outputs, description in rows:
    inputs = {**inputs, **({} if read_only else {"expected_version": VERSION, "request_id": S})}
    input_schema = obj(inputs, [] if suffix == "market.get" else None)
    if suffix == "actions.preview":
        input_schema["oneOf"] = [{"properties": {"kind": {"const": kind}, "parameters": tool_ref("transfer" if kind == "transfer" else "order_input")}}
                                 for kind in ("transfer", "buy", "sell")]
    name = "finance." + suffix
    tools.append({"name": name, "description": description, "read_only": read_only, "scope": name,
                  "resource_target": "owned accounts in the bound finance workspace", "inputSchema": input_schema, "outputSchema": output(outputs)})
write("tools.json", tools)
write("fixtures/policies.json", {profile: {"allow": [t["name"] for t in tools], "constraints": {}}
                                 for profile in ("scenario", "sandbox")})
manifest = json.loads((APP / "app.json").read_text())
manifest["event_types"] = list(payloads)
manifest["capabilities"]["ui"] = "App-owned business GUI through the public Web Host"
manifest["limitations"] = ["Simulated USD accounts and immediate whole-share fills at observed reference prices; default data is synthetic.",
                           "Action-specific user approval arrives through a separate trusted Infra connection.",
                           "No live accounts, real payments, settlement, partial fills, margin, queues or account closure."]
write("app.json", manifest)
contribution = json.loads((APP / "contribution/contribution.json").read_text())
contribution["interfaces"][0]["operations"] = [{"name": t["name"], "effect": "read" if t["read_only"] else "write", "caller": "agent"} for t in tools]
contribution["events"]["accepts"] = [{"type": n, "schema_ref": "schemas/events.schema.json", "status": "implemented"} for n in payloads]
contribution["gui_ref"] = "gui.json"
write("contribution/contribution.json", contribution)
