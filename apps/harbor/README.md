# Harbor Hotels App

A synthetic hotel loyalty program for PALE tasks: award nights priced by hotel category, free-night certificates with a category cap and a last check-in date, Points + Cash, category changes that do not reprice earlier bookings, and points that expire after 24 months without activity. Points arrive from Waypoint transfers. Package version 1.0.0, Core API 1.2.0, runtime 1.6.0, synthetic data. Environment proposal: [#193](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/193) (Points and awards; Harbor is one of three packages with Waypoint and Skyline).

## Run locally

Requires Node.js 18 or newer. From the repository root:

```sh
node --test apps/harbor/tests/business.test.cjs
node apps/harbor/examples/run.cjs
node apps/harbor/build/schemas.cjs --check
node runtime/cli.cjs verify --app apps/harbor --output .artifacts/harbor.json
```

With only this folder, run `node --test tests/business.test.cjs` and `node examples/run.cjs` inside it. `node build/schemas.cjs` regenerates `tools.json`, the seed and event schemas, the loyalty-credit payload and wire schemas, and the copy of Mail's email wire schema from one source; `--check` fails on drift, and the business tests run it when the public runtime is present.

## Workflows

| Workflow | How it works |
| --- | --- |
| Search | `harbor.search` takes a city and local check-in and check-out dates. Each hotel shows the category in effect now and any announced future change, the price of the whole stay in points, Points + Cash (when the chart offers it) and cash, whether award nights are available (no blackout night; the check-out date is not a night), whether the dates are open (check-in after today at the hotel), and which active certificates fit. |
| Booking | `harbor.book` with `payment.method` = `points`, `certificate` (`certificate_id`), `points_cash` or `cash` (`payment_label`). Check-in must be after today's date at the hotel, at most 30 nights. Award methods need every night free of blackout dates (`award_unavailable`). The price uses the category in effect at booking time and is stored as `category_locked`. Points are debited with a `redeem` ledger entry; cash goes to the chosen label as a charge. Each booking writes a `booking_confirmed` notice. |
| Certificates | A certificate pays exactly 1 night at a hotel whose category is at most its cap, with check-in on or before `expires_on` (its last allowed check-in date). A failure returns `certificate_invalid` naming the rule: `status`, `one_night`, `category_cap` or `expires_on`. A booked certificate becomes `used`. |
| Category changes | Infra applies `harbor.category.change`. The change is stored with `announced_at` and takes effect at `effective_at`; bookings made at or after that instant pay the new category, reservations made earlier keep their locked price. The member gets a `category_change` notice. |
| Cancellation | `harbor.cancel` works until the check-in date begins at the hotel. Points come back as a `refund` entry, cash as a negative charge to the same label, and a certificate goes back to `active` if today at the hotel is on or before its `expires_on`, otherwise it becomes `expired`. |
| Inactivity expiry | Points expire `inactivity_months` (24) calendar months after `last_activity_at`, at the same wall-clock time and UTC offset, with the day clamped to the end of a shorter month. A points or Points + Cash redemption and a transfer in are activity; a refund, a cash stay or a certificate stay are not. Infra applies `harbor.expiry.warn` in the 60 days before and `harbor.points.expire` at or after the expiry time. |
| Transfers in | Waypoint publishes on `channel.loyalty-credit` with the shared contract `urn:pale:loyalty-credit:1`; Messaging applies it as `harbor.receive`. The credit is a `transfer_in` ledger entry with the Waypoint object, message ID and producer time. |
| Mail notices | `harbor.notices.outbound` builds a stable CloudEvent for Mail's receive contract (`urn:pale:email-message:2`) addressed to the member's Mail account. Infra publishes it through Messaging. |

Error codes: `not_found`, `invalid_arguments` (dates, payment fields, Points + Cash not offered), `invalid_state` (cancelling a cancelled reservation or on the check-in date, no Mail account), `insufficient_points`, `invalid_payment_label`, `award_unavailable`, `certificate_invalid`, `not_due`, `already_exists`, `permission_denied`, `invalid_event`. Core adds `stale_version` and `invalid_arguments` for schema failures.

## Who can do what

| Caller | Operations |
| --- | --- |
| Agent (7 MCP tools) | Reads: `harbor.account`, `harbor.search`, `harbor.reservations` (optional `status` or `id`), `harbor.notices.list`, `harbor.notices.outbound`. Writes: `harbor.book`, `harbor.cancel`. The fixture `scenario` profile allows only the five reads. |
| Infra events (`env.apply_event`) | `harbor.receive` (Messaging), `harbor.category.change`, `harbor.expiry.warn`, `harbor.points.expire` (the runner, at their times). |

The Agent cannot credit points, change categories or expire points. The App never schedules itself.

## Events

Each event is `{event_id, at, operation, payload}`; `at` carries a UTC offset and is the handler's `virtual_now`.

`harbor.receive`: a loyalty credit. The recipient must be this account; the sending Waypoint account must be in the binding (`permission_denied`); only `partner_transfer` is accepted (`invalid_event`); the sender's owner and `member_person_id` must be this member, and `member_number`, when given, must match (`permission_denied`); an event ID already in the ledger returns `already_exists`.

```json
{"event_id":"credit-waypoint-transfer-1","at":"2027-08-24T21:05:00-05:00","operation":"harbor.receive","payload":{"recipient_account_id":"harbor-daniel","message":{"specversion":"1.0","id":"loyalty-credit-transfer-1","source":"urn:pale:app:waypoint:account:waypoint-daniel","type":"org.pale.loyalty.credit.v1","time":"2027-08-24T21:04:30-05:00","datacontenttype":"application/json","dataschema":"urn:pale:loyalty-credit:1","data":{"channel":"channel.loyalty-credit","recipient":{"kind":"app_account_ref","app_id":"harbor","id":"harbor-daniel"},"source_object":{"app_id":"waypoint","account_id":"waypoint-daniel","object_type":"transfer","object_id":"transfer-1"},"content":{"kind":"partner_transfer","member_person_id":"person-daniel","member_number":"HH-30418862","points":30000,"base_points":30000,"bonus_pct":0},"extensions":[]}}}}
```

`harbor.category.change`: `effective_at` must be after `at` and after every change already announced for the hotel, and the category must differ from the one in effect then.

```json
{"event_id":"category-shinjuku-2027-12","at":"2027-08-25T08:00:00-05:00","operation":"harbor.category.change","payload":{"hotel_id":"hotel-shinjuku","category":5,"effective_at":"2027-12-01T00:00:00+09:00"}}
```

`harbor.expiry.warn`: accepted from 60 days before `expires_at` until just before it (`not_due` otherwise); writes an `expiry_warning` notice stating the expiry time.

```json
{"event_id":"warn-harbor-daniel-2027-12","at":"2027-12-04T08:30:00-06:00","operation":"harbor.expiry.warn","payload":{}}
```

`harbor.points.expire`: `not_due` before `expires_at`. With a positive balance it writes an `expire` entry for the whole balance and sets `forfeited_at`; with a zero balance it records a zero-point `expire` entry and changes nothing else.

```json
{"event_id":"expire-harbor-daniel-2028-02","at":"2028-02-02T08:30:00-06:00","operation":"harbor.points.expire","payload":{}}
```

`examples/scenario.json` is the `harbor.receive` example above.

## State and time

`fixtures/minimal.json` is Daniel Cho's account `harbor-daniel` (member `HH-30418862`, Mail account `mail-daniel`, payment labels `card-travel-4417` and `card-everyday-0921`): 40,000 points, including a 40,000-point credit for Waypoint transfer `transfer-1` on 2026-01-11 (the same transfer is completed in the Waypoint fixture), last activity 2026-02-02T08:30:00-06:00 so points expire 2028-02-02T08:30:00-06:00. Six hotels in four categories: Harbor Haneda Airport (2), Harbor Tokyo Bay (3), Harbor Shinjuku (4) in Tokyo; Harbor Kyoto Arashiyama (3), Harbor Kyoto Station (4, blackout 2027-10-22) and Harbor Kyoto Gion (6, announced to become 7 at 2027-10-01T00:00:00+09:00) in Kyoto. One Category 1–4 certificate `cert-c4-2027` with last check-in 2027-10-16. Three reservations: a past points stay, a cancelled and refunded points stay, and an upcoming cash stay at Harbor Shinjuku on 2027-10-14 to 16. `fixtures/clock.json` is 2027-08-24 21:00 Chicago time, which is already 25 August at the hotels. The binding has Daniel and Mei Cho, this account, `waypoint-daniel`, `waypoint-mei` and `mail-daniel`. An optional `program_name` in the seed names the program in notices ("Harbor" when absent).

Stay dates, blackout dates, certificate dates and "today" are calendar dates at the hotel (its IANA time zone). Instants are compared as instants. All writes use the run's virtual time, `expected_version` and `request_id`. Certificates, reservations and notices keep an append-only `history`. `validateSeed` runs after every load, tool call and event and checks the ledger's running balance and the final balance, every redemption and refund against its reservation, transfers in from a Waypoint account of the same member, `last_activity_at` not older than any redemption or transfer in, `forfeited_at` against the last forfeiting entry, reservation nights, booking before check-in, the locked category against the category in effect at booking time, prices against the chart, charges against labels and reservations, certificate status against its reservation and rules, category-change order, time zones, notice references, the Mail binding and record timelines. Diagnostics carry record IDs and step names only, never notice text.

## Integration

- **Waypoint** (receive): `messaging.receives` declares `channel.loyalty-credit`, wire schema `urn:pale:loyalty-credit-message:1` (`schemas/loyalty-credit-message.schema.json`, type `org.pale.loyalty.credit.v1`), payload `urn:pale:loyalty-credit:1`, operation `harbor.receive`. The payload schema is the shared contract carried identically by Waypoint, Skyline and Harbor.
- **Mail** (publish): `messaging.publishes` declares `channel.email` with Mail's `urn:pale:email-message:2` (`schemas/email-message.schema.json`, a verbatim copy of `examples/apps/mail/schemas/router-message.schema.json`). A business test validates an outbound notice against it.
- No `required_apps`. The package runs on the shared runtime alone; the cross-App flow is assembled by the points workflow example.

## GUI

`gui/src/app.js` is a business page for the public Web Host: confirmed and cancelled reservations, a points and certificates view with the expiry date and ledger, the notices list, and Book a stay, Search hotels and Cancel reservation actions mapped to the Agent tools. Payment labels and active certificates are offered as choices. `gui/src/view.js` is the escaped reviewer renderer.

## Limitations

- Category changes, expiry warnings and points expiry happen only when Infra applies their events at their times.
- Points are earned only by transfers in. No earning on paid stays, elite status, upgrades, buying points or award holds.
- A cancelled certificate stay always restores the certificate through the tool, because check-in may be no later than `expires_on` and cancelling closes on the check-in date; the `expired` outcome is kept as the rule and tested directly.
- Payment labels are opaque; charges are recorded in Harbor, not posted to a card App. Text only.
- `harbor` is not added to `apps.registry.json`.

## Package map

```text
app.json, package.json, LICENSE   Identity, commands, MIT license
tools.json                         7 Agent tools (generated by build/schemas.cjs)
build/schemas.cjs                  Single source for tools.json and the seed, event, loyalty-credit and email schemas
plugin.cjs                         Standard hooks
src/operations.cjs                 Agent tools: account, search, book, reservations, cancel, notices
src/events.cjs                     receive, category.change, expiry.warn, points.expire
src/program.cjs                    Categories over time, prices, certificate rules, expiry time
src/dates.cjs                      Local hotel dates, calendar months with month-end clamp
src/notices.cjs                    Notices and their Mail messages
src/model.cjs                      Seed and state invariants
schemas/                           Generated business schemas plus copied public contracts
contribution/                      Interfaces, events, publish/receive contracts, GUI, dataset, empty asset catalog
fixtures/                          Seed, binding, policies, clock
examples/                          Runnable example, scenario event, replaceable task data
tests/                             Business tests, App-only harness, schema validator
gui/                               Business page and reviewer renderer
```
