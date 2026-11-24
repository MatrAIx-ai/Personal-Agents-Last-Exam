# Switchback

Switchback is a resettable campground reservation App with synthetic data, built for the approved proposal in [#25](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/25) ([`proposals/environment/switchback.md`](../../proposals/environment/switchback.md)). Its workflows follow Recreation.gov's public help pages: a 15-minute cart hold and a $10 change fee. The release schedule, refund ladders, cutoffs and alert effects are Switchback's own rules. A booking can check out cleanly and still be wrong for the people going, and the end state shows which happened.

This is the **first version (M1)**: workflows 1-4 through MCP tools, per-facility policy records, one fixture, reset, business tests, check (a), check (c) and a publisher script that delivers notices to real Mail. Pages, more fixtures and the remaining checks follow in M2 and M3 (see [Remaining work](#remaining-work)).

## Run it

Node.js 18+. No packages to install.

```sh
# From this directory: business tests and the example event
npm test
npm run example

# From the repository root: real Core with separate Agent and Infra MCP connections
npm run app:verify -- --app apps/switchback --output .artifacts/switchback.json
node apps/switchback/tests/platform-checks.cjs
node apps/switchback/examples/publish-to-mail.cjs
```

## Workflows

All times are facility time at a fixed UTC offset, and follow the environment clock (`ctx.virtual_now`). Switchback has no scheduler or clock event. Hold expiry, rung changes, no-show release, refund posting and alert activity are computed from stored due times at each read and write. Reads never store anything. The next write or event commits what fell due, and creates any notice that falls due then.

| # | Workflow | Tools | Errors |
| :--- | :--- | :--- | :--- |
| 1 | Search and site detail. Sites list electric hookup and amperage, maximum vehicle length, ADA access, walk-in distance, occupancy and pets. Filters are off by default, and an unknown attribute never matches a filter. Night states are `unreleased`, `open`, `held`, `booked` and `closed`; nights release 180 days ahead at 07:00. | `facilities.search`, `facilities.get`, `sites.search`, `sites.get`, `policy.get` | `not_found` |
| 2 | Reservation lifecycle: 15-minute hold, preview, confirm, receipt. The preview pre-fills the default saved equipment, the companions marked for the party and the default card. The booking form checks only equipment length, party size and pets. | `cart.hold`, `cart.release`, `reservations.preview`, `reservations.confirm`, `account.get`, `wallet.list`, `wallet.set_default`, `equipment.save`, `companions.save` | `not_yet_released`, `site_taken`, `site_closed`, `hold_expired`, `equipment_exceeds_site`, `occupancy_exceeded`, `pets_not_allowed`, `preview_stale`, `preview_consumed`, `payment_declined` |
| 3 | Modify, cancel and no-show. The refund ladder is the facility's policy record. A change holds the new nights, re-runs workflow 2's checks and releases the original nights at confirm, which cannot be undone. Without check-in the site is released at 21:00 on arrival day, or 12:00 the next day after a late-arrival notice. | `reservations.list`, `reservations.get`, `reservations.modify.preview`, `reservations.modify.confirm`, `reservations.cancel.preview`, `reservations.cancel.confirm`, `reservations.late_arrival` | `outside_change_window`, `different_facility`, `already_cancelled`, `already_checked_in`, `invalid_state`, `notice_too_late`, `preview_stale` |
| 4 | Conditions and alerts. An active alert marks a stay affected without changing its state or ladder. An active electrical outage removes its sites from the electric filter. A closure cancels the whole stay with a full refund. | `alerts.list`, plus the scenario events below | `invalid_event` |

Every tool name carries the `switchback.` prefix. Writes take `expected_version` and `request_id`. Core returns `stale_version` for a stale version and `idempotency_conflict` for a reused request ID with different arguments. A retried write with the same request ID returns the original receipt.

### Refund policy records

Each facility points to a policy record in the seed. A rung ends at a time on a given day before arrival and sets the cancellation refund (a fixed fee, the first night and/or a percentage kept) and whether a change is allowed and at what fee. The fixture has two records:

- `pol-standard` (the proposal's default ladder): rungs change at 00:00 on the 14th and 4th day before arrival and at 15:00 on arrival day. A cancel refunds everything; all but $10; all but $10 and the first night; nothing. Changes cost $10 in the first two rungs.
- `pol-flex-3day`: free changes and cancellations until 18:00 three days before arrival, then 50%. These are Task #113's terms.

### Scenario events

Infra applies these with `env.apply_event`. An event naming an unknown record, or not applicable in the current state, is rejected with `invalid_event` and changes nothing.

| Operation | Effect |
| :--- | :--- |
| `switchback.inventory.claimed` | A competing booker takes each listed night that is `open`; held or booked nights are skipped. |
| `switchback.alert.posted` | New alert. Affected holders get a notice. |
| `switchback.alert.updated` | Replaces kind, sites, window or text. Affected marks and the electric filter are recomputed; holders whose status changed get a notice. |
| `switchback.alert.cancelled` | Ends the alert at the event time and lifts its effects. Expiry needs no event. |
| `switchback.closure.ordered` | Closes nights; cancels each covered stay (`closure_cancelled`) with a full refund posting three days later, and a notice. |
| `switchback.reservation.checked_in` | `confirmed` to `checked_in` from arrival day on. |

[`examples/scenario.json`](examples/scenario.json) is a valid closure event; [`examples/run.cjs`](examples/run.cjs) applies it to the fixture.

## Notices and Mail

Confirmations, changes, cancellations, closures, alerts, no-show releases and posted refunds create a notice in the account's `notices`, in the same commit as the business change. Each notice holds a full CloudEvents message for Mail 1.3.0's `channel.email` receive contract (`urn:pale:email-message:2`, payload `urn:pale:email-payload:1`, type `org.pale.mail.notification.v1`), with the notice ID as the CloudEvents `id`. Every commit validates these messages against a pinned copy of Mail's wire schema ([`schemas/router-message.schema.json`](schemas/router-message.schema.json)). The publish direction is declared in `contribution/contribution.json`. Switchback does not record delivery.

No host-side publisher exists on main, so the package ships one: [`examples/publish-to-mail.cjs`](examples/publish-to-mail.cjs). It replaces the `app:verify --with examples/apps/mail` command named in the proposal, which adds Mail to the assembly but does not start Messaging.

- **What it does:** applies the example closure event through real Core, starts Messaging with `runtime/messaging/service.cjs --publisher switchback` and the trusted config in [`examples/messaging/config.json`](examples/messaging/config.json), calls `router.publish` for each stored notice, and reads each one back with Mail's own `mail.get` using `receipt.event_id`.
- **When it runs:** after the write or event that creates the notices and before the next `env.advance_time`, because Messaging delivers at the receiver's current virtual time.
- **Which notices are new:** it offers every stored notice in creation order, with the notice ID as both `request_id` and CloudEvents `id`. Messaging keeps the receipts, so a notice it already delivered returns `duplicate: true` with its original `event_id` and Mail does not change.
- **Outcomes it shows:** a committed delivery read back from Mail; a retry that is deduplicated; and a rejection before delivery, staged with a config that has no grant for the recipient ([`config-no-grant.json`](examples/messaging/config-no-grant.json)), which returns `recipient_not_authorized` and leaves both Mail and Switchback unchanged. In the reference router a refusal by Mail itself halts the run, so the rejected case uses a missing grant.

## Time

Agent reads and writes never move the clock. Time moves only when Infra calls `env.advance_time` or applies an event at its `at` time. A hold that should lapse, a refund rung that should pass or a no-show release therefore happens within a task only if the task's scenario schedules a clock advance or an event past that deadline.

## Permissions

`fixtures/policies.json` has four profiles. `scenario` allows only reads and `sandbox` allows every tool, matching the reference Apps. `browse` leaves out the three confirms and `wallet.set_default`, and `full` allows them. Switchback keeps no approval state; a task harness picks the profile.

## Data

[`fixtures/minimal.json`](fixtures/minimal.json) is one account (Dana Okafor) at three fictional facilities with 12 sites, two policy records, three cards and 22 reservations. [`fixtures/generate.cjs`](fixtures/generate.cjs) writes it from a fixed seed: the same seed gives the same bytes. History starts on 2025-01-01 (the earliest record is 2025-01-02), with past stays, cancellations and alerts through April 2027; the task clock is 2027-05-20, and scenario events are on or after 2026-01-01. The saved defaults are stale on purpose. The default card belongs to Dana's mother, one card is expired, the default equipment is an old 18 ft trailer, and one site has an unknown vehicle length. A test enforces both date floors. No real facility, person or payment data is used. See [`contribution/dataset.json`](contribution/dataset.json).

## Checks

| Check | Where | Status |
| :--- | :--- | :--- |
| Business rules and every named error | `tests/business.test.cjs` | M1 |
| (a) Anchor runs: the reference passes every check; do-nothing fails exactly the checks that need a write; each wrong run fails exactly its declared checks | `tests/business.test.cjs` with `tests/checks.cjs` | M1 |
| (c) Reset: 20 reset cycles restore the loaded state hash after an anchor run, through real Core | `tests/platform-checks.cjs` | M1 |
| Retries, stale versions and consumed previews through real Core; the `browse` profile refusing a gated write with the state hash unchanged (an early part of (g)) | `tests/platform-checks.cjs` | M1 |
| Public verifier (MCP discovery, schemas, history load, event, reset, isolation, restart) | `npm run app:verify` | M1 |
| Delivery to real Mail through Messaging: committed and read back, retried, rejected for a missing grant | `examples/publish-to-mail.cjs` | M1 |
| (b) Mutation, (d) replay with `env.advance_time`, (e) hidden values, the rest of (g), (f) independent reproduction | | M2-M3 |

## Remaining work

- Pages (`pale.web`), with PNG icons: M2.
- Two more fixtures from a seeded generator, each with a scenario schedule: M2.
- Checks (b), (d), (e) and the rest of (g): M2. Check (f), an independent reproduction: M3.

## Dependencies

Public runtime 1.6.0, Core API 1.2.0, contribution revision 0.4.0. `required_apps` is empty: the package runs with only its own files and the runtime. Mail 1.3.0 is an optional publish target; Calendar 1.3.0 is used only through its own Agent tools.
