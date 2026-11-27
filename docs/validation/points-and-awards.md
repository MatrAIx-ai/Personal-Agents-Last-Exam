# Points and awards v1 validation

First runnable version of the plan approved in [#193](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/193) (plan approval recorded at `3ff30e9`; the proposal file is unchanged). Three packages: [Waypoint](../../apps/waypoint/), [Skyline](../../apps/skyline/) and [Harbor](../../apps/harbor/), each 1.0.0.

## Versions and commands

Public runtime 1.6.0, Core API 1.2.0, Mail 1.3.0 (reference App, receiver of notices). Run locally on macOS with Node v26.7.0. CI runs Node 18 and 22. From the repository root:

| Command | Result |
| --- | --- |
| `node --test apps/waypoint/tests/business.test.cjs` | 19/19 tests pass |
| `node --test apps/skyline/tests/business.test.cjs` | 33/33 tests pass |
| `node --test apps/harbor/tests/business.test.cjs` | 27/27 tests pass |
| `node apps/<id>/examples/run.cjs` for each | Runs: combine and transfers settled (Waypoint); credit, award ticketed with seats, schedule change (Skyline); credit, certificate and points stays (Harbor) |
| `node runtime/cli.cjs verify --app apps/<id> --output .artifacts/<id>.json` | `passed: true`: Waypoint 40 checks, Skyline 39, Harbor 39. `verify` copies one package alone, so Waypoint's test that its fixture funds the Skyline and Harbor credits skips there (18 + 1 skipped). |
| `npm run example:points-trip` | `passed: true`, 45 checks over real MCP, Messaging and Mail |
| `node apps/<id>/build/schemas.cjs --check`, `node runtime/sdk/sync.cjs --check`, `node runtime/build-contracts.cjs --check` | No drift. The loyalty-credit payload and wire schemas are byte-identical in the three packages; Skyline's and Harbor's `email-message.schema.json` equal Mail's `router-message.schema.json`. |
| `npm test` | 22/22 stages pass (no existing App or runtime file is changed) |
| `npm run test:web` | 4/4 pass |

The Web Host pages were exercised by hand with `registry.points.json`: Waypoint (Points, Partners, a transfer submitted and shown as pending) and Skyline (trips, a seat change, the points ledger and notices).

## Approved deliverables → evidence

| Planned deliverable | Evidence |
| --- | --- |
| Three packages under `apps/` with tools, ledgers and state machines, receive and publish declarations, Infra event handlers and small GUIs | `apps/waypoint`, `apps/skyline`, `apps/harbor`: `tools.json` (8, 7 and 7 Agent tools), `src/`, `contribution/contribution.json`, `gui/`; verifier reports |
| Waypoint: transfer increment and irreversibility, bonus windows at their boundaries, pooling only by the sender, delayed settlement | Waypoint tests: increment/minimum/balance, no cancel tool and a refund only through a recorded rejection, bonus start inclusive/end exclusive and per partner, ratio and bonus rounding, 24-hour release keeping the offset, combine with no source-member argument |
| Skyline: inventory sold between search and book, insufficient points, fees charged to the chosen label, a schedule change with the free alternative before and after its deadline | Skyline tests: stale option after `inventory.sold` and after another booking, connection limits at 60/360 minutes, retime at 59/60 minutes, accept at the deadline refused, `alternative.expired` one minute early → `not_due`, cancel refunds with the fee kept or refunded, saver seats pushed out by two protected bookings come back the same in either cancellation order |
| Harbor: a certificate above its cap or after its expiry, category-change price lock, inactivity expiry with activity resetting it | Harbor tests: each certificate rule, the price lock at the exact `effective_at`, month-end clamping, the expiry boundary, transfer in and redemption reset the clock and a refund does not, the 60-day warning window |
| Example seed: 2 household members; a 2-week partner schedule on 3 routes; 6 hotels across 4 categories; one certificate; one transfer-bonus window | `apps/*/fixtures/minimal.json`: Daniel and Mei Cho; 51 flights 2027-10-12 to 10-26 on ORD→HND, HND→SFO and SFO→ORD; 6 Harbor hotels in Categories 2, 3, 4 and 6; certificate `cert-c4-2027`; Skyline +30% from 2027-09-01 to 09-16. All history dated 2026 or later. Reset restores each exactly (verifier). |
| `loyalty-credit` contract and the Waypoint → Skyline and Waypoint → Harbor flow; Mail notices | `channel.loyalty-credit`, `urn:pale:loyalty-credit-message:1` / `urn:pale:loyalty-credit:1`, receive operations `skyline.receive`, `harbor.receive`, `waypoint.receive`; Mail notices on `urn:pale:email-message:2` |
| Cross-App example in `examples/workflows/points-trip/` (pool, transfer to Skyline, ticket, sell out, schedule change and free alternative, transfer to Harbor and book with a certificate) | [`examples/workflows/points-trip/`](../../examples/workflows/points-trip/README.md): all six steps |
| Real MCP connections with receiver-side evidence, a rejected credit with a sender refund, and a duplicate transfer that returns the original receipt | Same workflow: receiver ledgers and Mail inbox records read back by delivery event ID; a refused credit leaves Skyline unchanged and Waypoint refunds once; a republished transfer is `duplicate` with no second credit |
| Permissions: the agent cannot call `combine` for another member or fire Infra events | Workflow step 1; verifier checks that every `env.*` operation is denied to the Agent |

## Review suggestions taken into v1

From the plan review on #193:

- **Transfer completion.** A transfer is a local commit (`pending`, points debited). `waypoint.transfer.outbound` builds the stable message; the host publishes it and records the verified outcome with `waypoint.transfer.settle` (`credited` with the receipt, or `rejected` with a refund). Receiver credit and sender settlement are separate commits. An unknown acknowledgement produces no settle event: the transfer stays pending and the run stops, with no refund, republish or automatic resume (`apps/waypoint/src/settlement.cjs`). Credits are routed by account, so a person's Skyline and Harbor accounts are never confused.
- **Sender-only pooling.** Each member is a separate Waypoint instance; the user harness holds Mei's connection and the Agent only Daniel's. `waypoint.combine` has no source-member argument.
- **Workflow details.** `skyline.manage` supports `change_seats`, `accept_alternative` and `cancel`; `harbor.cancel` refunds points or cash and restores a certificate before its expiry. Refund amounts, unknown IDs and missing inventory are documented in each README.
- **Events and notices.** Each README gives one `{event_id, at, operation, payload}` example per event. Mail notices use Mail 1.3.0's `urn:pale:email-message:2` and are verified in the inbox.
- **Pages.** One business page per program for the public Web Host (audience: the member, or an Agent acting for them), backed by the Agent MCP tools. Zero media assets.

## Interfaces added inside the approved scope

- **Seat assignments in Skyline**, recorded in the #193 description for task #55: options carry seat maps, `skyline.book` takes seat requests (default seats need not be adjacent), trips list each passenger's seat per segment, `skyline.manage` adds `change_seats`, and accepting a schedule-change alternative keeps the pair together where the seat map allows.
- **Read helpers the Web Host needs:** `waypoint.transfers.get`, an optional `id` on `skyline.trips` and `harbor.reservations`, `skyline.notices.*` and `harbor.notices.*`.
- **Event names** are prefixed with the App ID (`skyline.inventory.sold`, `waypoint.transfer.settle`, …). Harbor adds `harbor.expiry.warn` for the expiry-warning notice the proposal lists.
- **Task-owned formats.** An optional Harbor `program_name` names the program in notices (task #55 uses World of Hyatt). Skyline member numbers and Harbor confirmation numbers in a seed are free-form (Harbor still generates its own for new bookings), so a task can load its own program's numbers; task #55 does.
- **Carrier-specific award prices.** A Skyline chart row may name an `operating_carrier`; it then prices any itinerary with a segment that carrier operates, so a partner airline can cost more on the same route (task #55 prices ANA via Chicago at 87,500 against United's 75,000).

## Not covered yet

- No package is added to `apps.registry.json` (`runtime/tests/clock.test.cjs` expects exactly seven Apps there); `registry.points.json` assembles them. Adding them is a maintainer decision.
- The pinned Playwright browser test runs only the Apps in `apps.registry.json`, so it does not cover these pages.
- Award taxes stay local payment labels; posting them to Brindle Card (#182) waits for a receive contract there.
- Human review of fixture realism.
