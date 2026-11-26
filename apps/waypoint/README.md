# Waypoint Rewards App

Transferable bank points for PALE tasks: a member's points ledger, household pooling that only the sending member can start, and irreversible transfers to partner programs in fixed increments, instant or delayed, with time-boxed transfer bonuses. Credits reach [Skyline](../skyline/) and [Harbor](../harbor/) through Messaging on the shared loyalty-credit contract. Package version 1.0.0, Core API 1.2.0, synthetic data. Environment proposal: [#193](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/193).

## Run locally

Requires Node.js 18 or newer. From the repository root:

```sh
node --test apps/waypoint/tests/business.test.cjs
node apps/waypoint/examples/run.cjs
node runtime/cli.cjs verify --app apps/waypoint --output .artifacts/waypoint.json
npm run example:points-trip
```

With only this folder, run `node --test tests/business.test.cjs` and `node examples/run.cjs` inside it. `node build/schemas.cjs` regenerates `tools.json`, the seed, event, loyalty-credit payload and wire schemas from one source; `--check` fails on drift and the business tests run it when the public runtime is present.

## Workflows

| Workflow | How it works |
| --- | --- |
| Balance and ledger | Every change is a ledger entry with the running balance. The balance never goes negative, and the last entry always equals it. |
| Partner transfer | `waypoint.transfer(partner_id, points)`: points must be at least the partner minimum and a multiple of its increment (1,000 in the fixture). They leave the balance at once and the transfer is `pending`. The partner credit is `points × ratio`, plus the bonus active at that moment, rounded down; the ratio is kept on the transfer. There is no cancel: a transfer is irreversible. |
| Delayed transfer | A partner with `delay_minutes > 0` releases the credit that long after the transfer (`available_at`, same UTC offset). Before then the message cannot be built (`not_due`) and the transfer cannot be settled. |
| Transfer bonus | A bonus applies to one partner from `starts_at` (inclusive) to `ends_at` (exclusive). Bonuses are announced and ended early by Infra events. |
| Household combine | `waypoint.combine(to_person_id, points)` sends the member's own points to another household member's Waypoint account. The tool has no source-member argument, so nobody can pull points from someone else's account; the sending member's own connection must make the call. |
| Delivery and settlement | `waypoint.transfer.outbound(id)` builds the stable CloudEvent. The host publishes it with `router.publish`; the receiver credits its member and returns a receipt. The host then applies `waypoint.transfer.settle`: `credited` with the receipt, or `rejected` with a refund to the balance. Receiver credit and sender settlement are separate commits. |

## Who can do what

| Caller | Operations |
| --- | --- |
| Agent (8 MCP tools) | `waypoint.balance`, `waypoint.partners`, `waypoint.bonuses`, `waypoint.transfers.list`, `waypoint.transfers.get`, `waypoint.transfer.outbound`; writes `waypoint.transfer` and `waypoint.combine`. The fixture `scenario` profile allows only the six reads. |
| Infra events (`env.apply_event`) | `waypoint.receive` (Messaging), `waypoint.transfer.settle` (the host after publishing), `waypoint.bonus.start`, `waypoint.bonus.end`. |

Each Waypoint instance holds one member's account. Core 1.2 has no separate user role, so household pooling is sender-only by construction: the user harness holds the other member's Agent business connection and makes her `waypoint.combine` call; the evaluated Agent gets only its own member's connection. The workflow example shows the Agent's connection cannot see or spend the other member's points.

## Events

One example of each (`{event_id, at, operation, payload}`):

```json
{"event_id": "router-0c1d", "at": "2027-08-25T07:40:00-05:00", "operation": "waypoint.receive",
 "payload": {"recipient_account_id": "waypoint-daniel", "message": {"specversion": "1.0", "id": "credit-…", "source": "urn:pale:app:waypoint:account:waypoint-mei", "type": "org.pale.loyalty.credit.v1", "time": "2027-08-25T07:35:00-05:00", "datacontenttype": "application/json", "dataschema": "urn:pale:loyalty-credit:1",
   "data": {"channel": "channel.loyalty-credit", "recipient": {"kind": "app_account_ref", "app_id": "waypoint", "id": "waypoint-daniel"}, "source_object": {"app_id": "waypoint", "account_id": "waypoint-mei", "object_type": "combine", "object_id": "combine-1"}, "content": {"kind": "household_combine", "member_person_id": "person-daniel", "member_number": null, "points": 166000, "base_points": 166000, "bonus_pct": 0}, "extensions": []}}}}
{"event_id": "settle-transfer-2", "at": "2027-08-24T21:00:02-05:00", "operation": "waypoint.transfer.settle",
 "payload": {"transfer_id": "transfer-2", "outcome": "credited", "receipt": {"event_id": "router-5be1…", "target_app_id": "skyline", "target_account_id": "skyline-daniel"}}}
{"event_id": "settle-transfer-3", "at": "2027-08-25T21:00:01-05:00", "operation": "waypoint.transfer.settle",
 "payload": {"transfer_id": "transfer-3", "outcome": "rejected", "rejection": {"code": "receiver_rejected", "reason": "permission_denied"}}}
{"event_id": "bonus-harbor-october", "at": "2027-08-25T09:00:00-05:00", "operation": "waypoint.bonus.start",
 "payload": {"bonus": {"id": "bonus-2", "partner_id": "harbor", "percent": 20, "starts_at": "2027-10-01T00:00:00-05:00", "ends_at": "2027-10-15T00:00:00-05:00"}}}
{"event_id": "bonus-1-ends-early", "at": "2027-09-05T12:00:00-05:00", "operation": "waypoint.bonus.end", "payload": {"bonus_id": "bonus-1"}}
```

| Event | Effect | Refused when |
| --- | --- | --- |
| `waypoint.receive` | Credits a household combine (`combine_in`), keeping the sender account, message ID and producer time. | Wrong recipient (`invalid_event`); not a household combine (`invalid_event`); the sender is not another bound household member, or the credit names another member (`permission_denied`); the event ID, or the same sender's combine (`source_object.object_id`) under another event ID, was already credited (`already_exists`). |
| `waypoint.transfer.settle` | `credited`: stores the receipt, status `completed`. `rejected`: refunds the points in a `refund` ledger entry, status `rejected`. | Unknown transfer (`not_found`); before `available_at` (`not_due`); already settled (`invalid_state`); the receipt names another account or the payload carries both or neither outcome (`invalid_event`). |
| `waypoint.bonus.start` | Adds a bonus window for a partner. | Unknown partner (`not_found`); existing ID (`already_exists`); empty or past window (`invalid_event`); overlaps another bonus for that partner (`invalid_seed`). |
| `waypoint.bonus.end` | Ends a running bonus now. | The bonus has not started or has ended (`invalid_state`). |

## Delivery, failures and reconciliation

`src/settlement.cjs` is the host's helper. `deliverable(data, now)` lists pending transfers whose release time has come. `settleEvent(transfer, receipt, at)` turns a `router.publish` result into the settle event:

- `committed` → `credited` with the receipt's event ID and target account;
- a definitive non-delivery (`receiver_rejected`, `recipient_unavailable`, `recipient_not_authorized`, `incompatible_contract`) → `rejected`, which refunds;
- anything else (`unknown`, `run_halted`, a configuration error) → `null`: no event. The transfer stays `pending`, the run stops, and nobody refunds, republishes under a new ID or resumes automatically until the receiver's records have been inspected.

The message ID is derived from the transfer and its content, so a republish of the same transfer is deduplicated by Messaging and returns the original receipt. Settle event IDs are `settle-<transfer_id>`, so a retried settlement returns Core's original receipt. A receiver rejection halts that run in Messaging; the refund is a separate, idempotent Waypoint event. Credits are routed by the partner's `recipient_account_id` (or the household member's account), so Skyline and Harbor accounts of the same person are never confused.

## State and time

`fixtures/minimal.json` is Daniel's account: 181,600 points after four ledger entries from 2026-01-05, Mei in his household, Skyline (instant) and Harbor (24-hour delay) as partners, a 30% Skyline bonus from 2027-09-01 to 2027-09-16, and one completed Harbor transfer. `fixtures/clock.json` is 2027-08-24 21:00 Central. Tasks replace these through `env.load_seed`; each household member is a separate instance with their own seed.

All writes use the run's virtual time, `expected_version` and `request_id`. Transfers and bonuses keep an append-only `history`. `validateSeed` runs after every load, tool call and event and rejects a ledger whose running balance is wrong, a partner route to an account the member does not own, a household member without their own Waypoint account, overlapping bonuses, and a transfer without its debit, with a receipt from another account, or with a refund it should not have. Diagnostics carry record IDs and step names only.

## Integration

- **Skyline and Harbor** (receivers): Waypoint publishes `channel.loyalty-credit` (`urn:pale:loyalty-credit-message:1`, type `org.pale.loyalty.credit.v1`, payload `urn:pale:loyalty-credit:1`). Each receiver keeps a byte-identical copy of the payload and wire schema; the business tests compare them when the packages sit side by side.
- **Waypoint** (receiver): household combines arrive on the same contract as `waypoint.receive`.
- **Messaging**: the host runs `runtime/messaging/service.cjs` with a trusted publisher config per member account; see `examples/workflows/points-trip/`.
- No `required_apps`. The package runs on the shared runtime alone.

## GUI

`gui/src/app.js` is a business page for the public Web Host: the balance and ledger, partners and bonuses, transfers by status, and the Transfer and Combine actions. Settlement, bonuses and incoming combines are shown but not editable. Start it with `node runtime/web/server.cjs --app waypoint --registry registry.points.json --profile sandbox`. `gui/src/view.js` is the escaped reviewer renderer.

## Limitations

- No earning from card spending, buying or selling points, points expiry or elite status in Waypoint; history is seeded.
- One member per instance; a household of more than two people is several instances.
- No real bank or program connection. Text only.
- `waypoint` is not added to `apps.registry.json`: `runtime/tests/clock.test.cjs` expects exactly seven Apps there. `registry.points.json` assembles Waypoint, Skyline, Harbor and Mail.

## Package map

```text
app.json, package.json, LICENSE   Identity, commands, MIT license
tools.json                         8 Agent tools (generated by build/schemas.cjs)
build/schemas.cjs                  Single source for tools.json and the seed/event/loyalty-credit schemas
plugin.cjs                         Standard hooks
src/operations.cjs                 Agent tools
src/events.cjs                     receive, transfer.settle, bonus.start, bonus.end
src/messaging.cjs                  Outbound loyalty-credit message and the combine receiver
src/settlement.cjs                 Host helper: deliverable transfers and settle events from router results
src/model.cjs                      Seed and state invariants, credit arithmetic
contribution/                      Interfaces, events, publish/receive declarations, GUI, dataset, empty asset catalog
fixtures/                          Seed, binding, policies, clock
examples/                          Runnable example, scenario event, replaceable task data
tests/                             Business tests, App-only harness, schema validator
gui/                               Business page and reviewer renderer
```
