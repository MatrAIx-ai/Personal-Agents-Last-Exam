# Skyline Miles App

An airline award program for PALE tasks: an Agent searches saver seats on a small partner schedule, tickets named passengers with points, pays the partner booking fee and taxes with a chosen payment label, and handles schedule changes that break a connection before the free alternative expires. Points arrive from Waypoint Rewards through Messaging. Package version 1.0.0, Core API 1.2.0, synthetic data. Environment proposal: [#193](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/193).

## Run locally

Requires Node.js 18 or newer. From the repository root:

```sh
node --test apps/skyline/tests/business.test.cjs
node apps/skyline/examples/run.cjs
node apps/skyline/build/schemas.cjs --check
node runtime/cli.cjs verify --app apps/skyline --output .artifacts/skyline.json
```

With only this folder, run `node --test tests/business.test.cjs` and `node examples/run.cjs` inside it. `node build/schemas.cjs` regenerates `tools.json` and the seed, event, loyalty-credit payload and wire schemas from one source, and copies Mail's wire schema; `--check` fails on drift and the business tests run it when the public runtime is present.

## Workflows

| Workflow | How it works |
| --- | --- |
| Award search | `skyline.search {origin, dest, date, cabin, pax}` returns nonstop and one-stop itineraries. `date` is the local date of the first departure at the origin airport. A connection must be at the same airport and between `rules.min_connection_minutes` (60) and `rules.max_connection_minutes` (360), both inclusive. Every segment needs at least `pax` saver seats in the cabin, and departed flights are not offered. A connection is priced by its endpoints from `award_chart` (points, partner fee and taxes per passenger, one way). A row may name an `operating_carrier`: it then prices any itinerary with a segment that carrier operates, so a partner airline can cost more on the same route; other itineraries use the row without a carrier. Each option shows the free seats and free adjacent pairs of every segment. |
| Option IDs | `option_id` is `opt-` plus the first 16 hex characters of the SHA-256 of `[flight IDs, cabin, pax, inventory_revision]`. Every inventory change (a booking, a cancel, a seat change, sold seats, a schedule change, an accepted alternative) increments `inventory_revision`, so an option searched before the change returns `stale_version` and the Agent must search again. |
| Ticketing | `skyline.book {option_id, passenger_ids, payment_label, seats?}` checks the option is reproducible now, `passenger_ids.length` equals the option's `pax`, every passenger exists, the balance covers the points and the label is known. Requested seats (at most one per passenger per segment) must exist in the cabin and be free; any failure tickets nothing. Other passengers get the first free seats in seat-map order, which can split a pair. It debits points (ledger `redeem`), records one charge of (partner fee + taxes) × pax to the label, takes saver seats and seats, and creates a `booking_confirmed` notice. |
| Seats | `skyline.manage` with `action: change_seats` moves passengers to free seats on segments that have not departed (`departs_at > now`); their old seats are released, so passengers in one booking can swap. |
| Schedule changes | Infra applies `skyline.schedule.changed` to retime a flight. For each ticketed booking on it: a connection that is no longer legal opens a change with reason `illegal_connection`; otherwise a shift of 60 minutes or more in departure or arrival opens `time_change`; a smaller shift only retimes the flight. The change lists the offered alternatives, the booked segments they replace and the deadline, and a `schedule_change` notice is created. |
| Free alternative | `action: accept_alternative` before the deadline (`now < deadline`) replaces those segments at no cost and without saver space. Seats on kept flights stay. Two passengers who sat in an adjacent pair on every replaced segment get the first free pair on each new flight; if none is free they get the first free seats and the result lists it in `reassigned`. Others get the first free seats. Seats and saver space on the dropped flights are released. Protected seats on a new flight do not use saver space, but they can leave fewer free seats than saver seats; the saver count is then lowered to the free seats and the booking records the reduction in `saver_reductions`. A reduction is owed by that flight's cabin, not only by the booking that triggered it: whenever seats on the flight are released (cancel, or a later change that drops the flight), saver seats are given back up to the new free seats, paying the releasing booking's reductions first and then other bookings' reductions on that flight and cabin in booking order; fully repaid records are removed, and another booking whose record changes gets `updated_at` and a `saver_reduction_repaid` history entry. Award availability therefore does not depend on which protected booking is released first. At or after the deadline, or after `skyline.alternative.expired`, it returns `alternative_expired`. |
| Cancel | `action: cancel` before the first departure refunds the points (ledger `refund`) and the taxes (a negative charge to the same label). The partner booking fee is kept, unless the booking has an open schedule change before its deadline; then the fee is refunded too. Seats and saver space are returned. |
| Loyalty credit | Waypoint publishes on `channel.loyalty-credit` with the shared contract `urn:pale:loyalty-credit:1` (wire `urn:pale:loyalty-credit-message:1`, type `org.pale.loyalty.credit.v1`). Messaging applies it as `skyline.receive`; the points are credited as ledger `transfer_in` with the event ID as entry ID and the source object, CloudEvent ID and producer time as provenance. |
| Mail notices | `skyline.notices.list` and `skyline.notices.outbound {id}`. The outbound message is Mail's `urn:pale:email-message:2` with payload `urn:pale:email-payload:1`, sent to `mail_account_id`; its ID is `skyline-notice-` plus 40 hex characters of a hash of the notice ID and payload, so a retry is stable. Infra publishes it through Messaging. |

### Receive rules

A loyalty credit is rejected, with nothing changed, when:

1. `recipient_account_id` or `data.recipient.id` is not this account, or `data.recipient.app_id` is not `skyline` → `invalid_event`;
2. the source Waypoint account is not in the run binding → `permission_denied`;
3. `content.kind` is not `partner_transfer` → `invalid_event`;
4. the source account's owner or `content.member_person_id` is not this member, or `content.member_number` is given and differs → `permission_denied` (points move only between accounts of the same member);
5. a record with the event ID already exists → `already_exists`.

### Errors

Besides `not_found`, `invalid_arguments`, `invalid_state`, `insufficient_points`, `stale_version`, `not_due`, `already_exists`, `permission_denied` and `invalid_event`, Skyline returns `invalid_payment_label` (unknown label), `seat_unavailable` (a requested seat is taken, missing from the cabin, or too few free seats) and `alternative_expired` (the free alternative is past its deadline or expired).

## Who can do what

| Caller | Operations |
| --- | --- |
| Agent (7 MCP tools) | Reads: `skyline.balance`, `skyline.search`, `skyline.trips`, `skyline.notices.list`, `skyline.notices.outbound`. Writes: `skyline.book`, `skyline.manage`. The fixture `scenario` profile allows only the five reads. |
| Infra events (`env.apply_event`) | `skyline.inventory.sold` and `skyline.schedule.changed` (airline side), `skyline.alternative.expired` (runner, at the deadline), `skyline.receive` (Messaging). |

The Agent cannot sell seats, change schedules, expire alternatives or credit points. Award holds are not implemented (the proposal has them off by default).

## Events

Every Infra event is `{event_id, at, operation, payload}`; `at` carries a UTC offset and the handler sees it as the current time.

`skyline.receive` (Messaging delivers a Waypoint transfer):

```json
{"event_id": "msg-loyalty-0002", "at": "2027-08-25T09:00:00-05:00", "operation": "skyline.receive",
 "payload": {"recipient_account_id": "skyline-daniel", "message": {
   "specversion": "1.0", "id": "waypoint-transfer-example-0002", "source": "urn:pale:app:waypoint:account:waypoint-daniel",
   "type": "org.pale.loyalty.credit.v1", "time": "2027-08-25T08:59:00-05:00", "datacontenttype": "application/json",
   "dataschema": "urn:pale:loyalty-credit:1",
   "data": {"channel": "channel.loyalty-credit", "recipient": {"kind": "app_account_ref", "app_id": "skyline", "id": "skyline-daniel"},
     "source_object": {"app_id": "waypoint", "account_id": "waypoint-daniel", "object_type": "transfer", "object_id": "transfer-2027-0007"},
     "content": {"kind": "partner_transfer", "member_person_id": "person-daniel", "member_number": "SK-48210377",
       "points": 120000, "base_points": 120000, "bonus_pct": 0},
     "extensions": []}}}}
```

`skyline.inventory.sold` (other customers buy saver seats; `seats` is a count or `"all"`, floored at zero):

```json
{"event_id": "sold-pc12-2027-10-21", "at": "2027-08-25T10:00:00-05:00", "operation": "skyline.inventory.sold",
 "payload": {"flight_id": "PC12-2027-10-21", "cabin": "business", "seats": "all"}}
```

`skyline.schedule.changed` (new local times, offered alternatives and the deadline; each alternative must exist, connect legally and fit every affected booking):

```json
{"event_id": "schedule-pc12-2027-10-21", "at": "2027-08-26T07:00:00-05:00", "operation": "skyline.schedule.changed",
 "payload": {"change_id": "chg-pc12-2027-10-21", "flight_id": "PC12-2027-10-21",
   "departs_at": "2027-10-21T20:30:00+09:00", "arrives_at": "2027-10-21T14:20:00-07:00",
   "alternatives": [{"id": "alt-same-day", "flight_ids": ["PC12-2027-10-21", "LK488-2027-10-21"]},
                    {"id": "alt-next-day", "flight_ids": ["PC12-2027-10-22", "LK480-2027-10-22"]}],
   "deadline": "2027-09-01T23:59:00-05:00"}}
```

`skyline.alternative.expired` (`not_due` before the deadline; at or after it, open changes with this ID become `expired`):

```json
{"event_id": "expire-chg-pc12-2027-10-21", "at": "2027-09-01T23:59:00-05:00", "operation": "skyline.alternative.expired",
 "payload": {"change_id": "chg-pc12-2027-10-21"}}
```

`examples/scenario.json` is a schedule change that applies to the fixture: Daniel and Mei's outbound PC11 on 2027-10-13 leaves 2 h 30 min late, opening a `time_change` with the next day's PC11 as the free alternative.

## State and time

`fixtures/minimal.json` is Daniel Cho's account `skyline-daniel` (member `SK-48210377`, Mail account `mail-daniel`), with passengers Daniel and Mei Cho, 32,400 points after an opening balance, one Waypoint transfer and two redemptions (one cancelled and refunded with the fee kept), payment labels `card-travel` and `card-everyday`, and booking `booking-1` (locator `QXRTNB`): Daniel and Mei in economy seats 30A/30B on PC11 ORD→HND, 2027-10-13. The schedule has 51 flights from 2027-10-12 to 2027-10-26 by two synthetic carriers, Pacific Crest Airlines (PC) and Lakeshore Air (LK):

| Flight | Route | Local times | Days |
| --- | --- | --- | --- |
| PC11 | ORD → HND | 12:40 → 16:05 next day | daily |
| PC12 | HND → SFO | 17:30 → 11:20 same day | daily |
| LK476 | SFO → ORD | 12:10 → 18:25 (50-minute connection from PC12, too short) | 20–22 Oct |
| LK480 | SFO → ORD | 14:15 → 20:30 (175 minutes from PC12) | daily |
| LK488 | SFO → ORD | 17:30 → 23:45 (370 minutes from PC12, too long) | 20–22 Oct |

Pacific Crest business is 1-2-1 (A, D-F, K), so the first two free seats (1A, 1D) do not sit together; Lakeshore first is 2-2 (A-B, C-D). PC12 business has 1 saver seat on 19 Oct and none on 23 Oct; LK488 on 21 Oct has no free pair. `fixtures/clock.json` is 2027-08-24 21:00 Chicago time. Tasks replace these through `env.load_seed`.

All writes use the run's virtual time, `expected_version` and `request_id`. Bookings and notices keep an append-only `history`. `validateSeed` runs after every load, tool call and event and checks: the ledger running sum (never negative, ending at `balance`) and each entry against its kind; flight times in local airport offsets; seat maps (saver seats never exceed free seats); one seat per passenger per segment, held on the flight for ticketed bookings and never double-booked; each booking's single redeem, refund, charge and refund charge; schedule changes that replace booked segments around the changed flight; bound passengers, Waypoint senders and Mail account. Diagnostics carry record IDs, counts and step names only, never names, notice text or labels.

## Integration

- **Waypoint** (optional, receive): `channel.loyalty-credit`, `urn:pale:loyalty-credit:1`. The schema files are generated by the same code in Waypoint, Skyline and Harbor and are byte-identical. Skyline accepts only `partner_transfer` credits from the member's own bound Waypoint account.
- **Mail** (optional, publish): `channel.email` through Mail's existing receive contract (`schemas/email-message.schema.json`, copied verbatim from `examples/apps/mail/schemas/router-message.schema.json`). The App builds the message; Infra publishes it through Messaging.
- No `required_apps`. The package runs on the shared runtime alone. The cross-App flow (pool, transfer, ticket, sell out, schedule change, alternative) is the integrator's `examples/workflows/points-trip/`.

## GUI

`gui/src/app.js` is a business page for the public Web Host: trips, schedule changes and cancelled bookings with seats and free seats, the points ledger and notices, and Search awards, Book award (optional seats, one `flight_id passenger_id seat` per line), Save seats (each passenger can take a free seat or a fellow traveler's seat on the booking, so a swap is saved in one change), Accept alternative and Cancel trip. Inventory and schedule events are shown but not caused by the page because the Host connects as the Agent. `gui/src/view.js` is the escaped reviewer renderer. See `gui/README.md`. Flight times show each airport's own clock with its UTC offset, not the viewer's time zone.

## Limitations

- One-way awards with at most one connection; a round trip is two bookings. No award holds, cash fares, mixed cabins, upgrades, elite status or buying points.
- A schedule change applies one set of alternatives to every affected booking; they must share endpoints. A newer change on a booking replaces an older one.
- `skyline.alternative.expired` for a change that affected no booking returns `not_found`.
- Accepting an alternative returns the dropped flights' saver space to award inventory.
- Taxes and fees post to opaque payment labels; no card network (#182) or real payment.
- Synthetic carriers, schedules, seat maps and prices; text only. `skyline` is not added to `apps.registry.json`.

## Package map

```text
app.json, package.json, LICENSE   Identity, commands, MIT license
tools.json                         7 Agent tools (generated by build/schemas.cjs)
build/schemas.cjs                  Single source for tools.json and the seed/event/loyalty/wire schemas
plugin.cjs                         Standard hooks
src/operations.cjs                 Agent tools: balance, search, book, trips, manage, notices
src/events.cjs                     receive, inventory.sold, schedule.changed, alternative.expired
src/inventory.cjs                  Itineraries, connections, option IDs, prices and seat maps
src/ledger.cjs                     Points ledger and payment-label charges
src/notices.cjs                    Notice text and the outbound Mail message
src/model.cjs                      Seed and state invariants
src/common.cjs                     IDs, history stamps and local-time helpers
schemas/                           Generated business schemas, Mail's wire schema and copied public contracts
contribution/                      Interfaces, events, publish/receive contracts, GUI, dataset, empty asset catalog
fixtures/                          Seed, binding, policies, clock
examples/                          Runnable walkthrough, scenario event, replaceable task data
tests/                             Business tests, App-only harness, schema validator
gui/                               Business page and reviewer renderer
```
