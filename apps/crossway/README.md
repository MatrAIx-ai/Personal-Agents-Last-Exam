# Crossway

Crossway is a resettable prepaid toll account with synthetic data, built for the approved proposal in [#27](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/27) ([`proposals/environment/crossway.md`](../../proposals/environment/crossway.md)). It belongs to a fictional state toll authority. Its workflows follow the public E-ZPass NY and Tolls by Mail sites; amounts, deadlines and two rules (below) are Crossway's own. Notice fees escalate on the clock, and paying a notice is final and gives up the right to dispute it.

This is the **first version (M1)**: workflows 1-5 through 22 MCP tools, clock-derived deadlines, one seed, reset, business tests and checks (a) and (c). It also ships the host-side publisher that delivers Crossway's notices to Mail through Messaging, which the plan review asked for in the first version. Pages and the other two seeds follow in M2 (see [Remaining work](#remaining-work)).

## Run it

Node.js 18+. No packages to install.

```sh
# From this directory: business tests and the example event
npm test
npm run example

# From the repository root
node runtime/cli.cjs verify --app apps/crossway --output .artifacts/crossway.json
node apps/crossway/tests/platform-checks.cjs
node apps/crossway/examples/publish-to-mail.cjs
```

## Workflows

Every tool name carries the `crossway.` prefix. Writes, the three previews included, take `expected_version` and `request_id`. Core returns `stale_version` for a stale version and `idempotency_conflict` for a reused request ID with different arguments; a retried write with the same request ID returns the original receipt. Previews expire after 15 simulated minutes (`preview_expired`) and confirm once (`preview_used`).

| # | Workflow | Tools | Errors |
| :--- | :--- | :--- | :--- |
| 1 | Account, balance, auto-replenish and statements. States `active`, `low_balance`, `suspended`. A toll that leaves the balance under the threshold triggers one replenish attempt on the rule's card; two failures in a row, or a balance below zero, suspend the account until a top-up succeeds. A statement is issued at 00:00 on the 1st for the month before. | `account.get`, `account.statements`, `account.replenish.set`, `account.topup.preview`, `account.topup.confirm`, `policies.get` | `amount_out_of_range`, `card_expired`, `card_declined` |
| 2 | Vehicles and transponders. Possession runs from 00:00 on the start date through the end of the end date. The end date defaults to today; `vehicles.update` corrects it. A temporary plate needs an end date within 30 days and ends on the clock. Ending a vehicle unassigns its transponder. `transponders.assign` sets the transponder's charged class to the vehicle's. | `vehicles.list`, `vehicles.add`, `vehicles.update`, `vehicles.end`, `transponders.list`, `transponders.assign` | `plate_on_another_account`, `plate_already_listed`, `end_before_start`, `end_in_future`, `temp_too_long`, `missing_required_field`, `transponder_in_use`, `invalid_state` |
| 3 | Toll activity, read-only. A transponder read debits the balance at the account rate for the transponder's class. A plate-only read, or any read while suspended, becomes a notice at the mail rate. A plate on no possession interval is recorded as `unmatched`. | `tolls.list`, plus `crossway.toll.posted` events | `invalid_event` |
| 4 | Violation notices: `issued` (due in 30 days), `escalated` (one $25.00 late fee, due 30 days later), `collections` (terminal here); `paid` from `issued` or `escalated`. Pay is preview, confirm, receipt for one notice or a batch, by card, defaulting to the auto-replenish card. One ineligible notice rejects the whole preview and is named. | `notices.list`, `notices.get`, `notices.pay.preview`, `notices.pay.confirm` | `amount_changed`, `notice_in_dispute`, `already_paid`, `in_collections`, `notice_dismissed`, `card_expired`, `card_declined` |
| 5 | Disputes: once per notice, within 45 days of issue. `submitted` freezes fees and due date until `granted` (notice `dismissed` at $0.00), `denied` (prior state, due 14 days after the decision) or `withdrawn` (prior state with the days that remained). Evidence is a shared object reference `{app_id, account_id, object_id}`, recorded as given; Crossway never reads Mail. | `disputes.reasons`, `disputes.preview`, `disputes.confirm`, `disputes.get`, `disputes.withdraw` | `dispute_exists`, `dispute_window_closed`, `closed_by_payment`, `missing_required_field`, `invalid_evidence_ref`, `toll_before_transfer` |

Two rules differ from New York on purpose and are stated in `policies.get`: a plate-only read is billed by notice even for a plate listed on the account, and a plate stays with a sold vehicle, so the seller ends possession on Crossway separately from the notice of transfer.

## Time and deadlines

Authority time is US Eastern. `src/clock.cjs` computes the America/New_York daylight-time rules itself, so results do not depend on the host time zone. A due date is the instant 00:00 on that date; a notice must be paid before it.

Crossway has no scheduler or clock event. **Agent reads and writes do not advance time; only Infra's `env.advance_time` or an event's `at` does, so a missed deadline needs a scheduled clock advance or event.** The Policies text returned by `policies.get` says the same. Escalation, collections, temporary-plate expiry and statements are computed from stored due dates and `ctx.virtual_now`:

- A read computes them on a copy and stores nothing.
- The next write or event commits every effect that is due, one at a time in (due time, ID) order, and stamps each with its own deadline (history entry, record field and the Mail notice's `time`). One long `env.advance_time` and several short ones therefore give the same records. A notice can move `issued` to `escalated` to `collections` in one commit, each step dated at its deadline.
- A payment previewed before a deadline and confirmed after it returns `amount_changed` and charges nothing.

`tests/business.test.cjs` checks all three, and `tests/platform-checks.cjs` checks the single-jump and stepwise case through Core's real `env.advance_time`.

## Scenario events

Infra applies these with `env.apply_event`. An event naming an unknown record, or not applicable in the current state, is rejected with `invalid_event` and changes nothing.

| Operation | Effect |
| :--- | :--- |
| `crossway.toll.posted` | A toll at the event time. Matched as in workflow 3; a debit may trigger replenish, `balance_low`, `replenish_failed` or `account_suspended` notices. |
| `crossway.card.status_changed` | Sets a card `active`, `declined` or `closed`. Expiry needs no event: a card past its expiry month is `card_expired`. |
| `crossway.dispute.decided` | Grants a `submitted` dispute whose reason matches a `grant_if` entry and whose evidence includes every reference that entry lists; denies any other. With no submitted dispute it records `no_target`. |

[`examples/scenario.json`](examples/scenario.json) posts a plate read of the car Dani sold; [`examples/run.cjs`](examples/run.cjs) applies it to the seed and prints the notice it bills to Dani.

## Notices and Mail

Every committed write or event that creates a notice stores it in the account's `outgoing` records in the same commit: balance low, replenish failed and receipts, suspension, notice issued, escalated or sent to collections, temporary plate expired, statements, top-up and payment receipts, dispute received, decided or withdrawn. Each record holds a full CloudEvents message for Mail 1.3.0's `channel.email` receive contract (`urn:pale:email-message:2`, payload `urn:pale:email-payload:1`, type `org.pale.mail.notification.v1`), validated on every commit against a pinned copy of Mail's wire schema ([`schemas/router-message.schema.json`](schemas/router-message.schema.json)). The outgoing record ID is the CloudEvents `id`. `contribution/contribution.json` declares the publish direction. Crossway does not record delivery.

[`examples/publish-to-mail.cjs`](examples/publish-to-mail.cjs) is the host-side publisher. It starts Messaging with `runtime/messaging/service.cjs --publisher crossway` and a trusted config ([`examples/messaging/config.json`](examples/messaging/config.json)) that grants Dani's Mail account `mail-dani` on `channel.email`, loads Dani's mailbox into real Mail, and drives Crossway through MCP.

- **When it runs.** Right after each Crossway write or event that can create notices, and before the next `env.advance_time`. Before delivering, it advances Mail's clock to Crossway's (the Infra barrier in `docs/runtime-time.md`). An `env.advance_time` on Crossway alone creates no notice; the script shows that, then applies an event whose commit releases three deadline notices and the event's own notice.
- **Which notices are new.** The publisher keeps its own cursor: the outgoing IDs it has handled in the current Crossway epoch. IDs in the loaded snapshot count as history. After each write or event it reads `env.snapshot` and publishes, in array order, every outgoing record whose ID is not in the cursor. A Crossway reset or seed load starts a new epoch and restarts IDs at `cw-notice-0001`, so the publisher stops rather than continue in the same Messaging run, where a reused CloudEvents id with new content would be rejected. Records already delivered stay in Mail until Mail's own reset.
- **What it shows.** A delivery staged with a missing grant ([`config.no-grant.json`](examples/messaging/config.no-grant.json)) is `rejected` with `recipient_not_authorized`, and both Mail's and Crossway's snapshots are unchanged. With the grant, each notice is `committed` and read back with Mail's `mail.get` using `receipt.event_id`; subject and body match. A retry of the same message (same CloudEvents id, new request ID) returns `duplicate: true` with the same `event_id`, and Mail still holds one copy. The run ends with a dispute decision email for a dispute whose evidence is Mail message `m-11133`, which the script also reads from Mail.

This script replaces the acceptance command in the proposal (`npm run app:verify -- --app apps/crossway --with examples/apps/mail`): `app:verify --with` loads Mail but does not start Messaging, and main has no host-side publisher, so the connected check runs here instead.

## Permissions

`fixtures/policies.json` has four profiles. `scenario` allows only the 10 reads and `sandbox` allows every tool, matching the reference Apps. `browse` leaves out every confirm, `account.replenish.set`, `vehicles.end`, `vehicles.update` and `disputes.withdraw` (15 tools); `full` allows all 22. Crossway keeps no approval state; a task harness picks the profile.

## Data

[`fixtures/minimal.json`](fixtures/minimal.json) is one account, Dani Reyes (`cw-dani`), opened on 2025-01-06, with the clock at 2026-11-02 09:00 Eastern. [`scripts/generate-seed.cjs`](scripts/generate-seed.cjs) builds it deterministically (fixed-seed PRNG) by replaying the history through Crossway's own handlers, then clears the outgoing records and spent previews; a test checks the file equals the generator output. It holds 12 plazas, 5 vehicles, 2 transponders, 3 cards, 174 tolls, 185 ledger rows, 22 monthly statements and 18 notices (11 paid, dismissed or in collections; 7 open). The balance reconciles to the cent with the ledger, and every notice maps to one toll.

The saved state is wrong for Dani in several ways on purpose:

- The auto-replenish card is Jordan Albright's Amex, from before they split up; Dani's Mastercard expired in 09/2026.
- The Honda Fit `HKR4471`, sold on 2026-09-28, is still listed: two notices after the sale (`n-0017`, the Kettle Creek read of 2026-10-11, and `n-0018`) and one before it (`n-0014`).
- Jordan's Subaru `JRD5530`, handed back on 2026-08-15, is still listed, and Jordan's notice `n-0012` is escalated next to Dani's own Kia notices `n-0013` and `n-0016`.
- A rental plate notice `n-0015` that SwiftRent already charged to Dani.
- Transponder `tp-0001` was moved to the Kia but is still assigned to the van, so it charges class 2.

Mail message IDs `m-11133` (notice of transfer) and `m-11140` (rental receipt) are the evidence references; they exist in the Mail seed used by the publisher, not in Crossway. Seeded history starts on or after 2025-01-01 and the task clock on or after 2026-01-01; a test fails on any earlier fixture or example-event date. No real person, plate, card or authority data is used. See [`contribution/dataset.json`](contribution/dataset.json).

## Checks

| Check | Where | Status |
| :--- | :--- | :--- |
| Business rules and every named error, the time contract, generator reproduction and the date floor | `tests/business.test.cjs` (31 tests) | M1 |
| (a) Anchor runs over workflows 1, 2, 4 and 5 (sold car, someone else's car, rental double billing, wrong class, road trip): reference and equivalent variants pass every check; do-nothing fails exactly the checks that need a write; each wrong run fails exactly its declared checks | `tests/business.test.cjs` with `tests/checks.cjs` | M1 |
| (c) Reset: 20 cycles, audit exported before each, restore the loaded state hash with no outgoing notice left, through real Core | `tests/platform-checks.cjs` | M1 |
| Retries, idempotency conflicts, stale versions and used previews; the `browse` profile refusing all seven gated writes with the hash unchanged; single-jump and stepwise `env.advance_time` giving the same hash | `tests/platform-checks.cjs` (15 checks) | M1 |
| Messaging to Mail: rejected (missing grant), committed and read back, deduplicated retry | `examples/publish-to-mail.cjs` | M1 |
| Public verifier (MCP discovery, schemas, history load, event, reset, isolation, restart) | `node runtime/cli.cjs verify` | M1 |
| (b) Mutation, (d) full replay in two host time zones, (e) hidden values, the rest of (f), (g) independent reproduction | | M2-M3 |

## Differences from the proposal

- Acceptance for the Mail connection uses `examples/publish-to-mail.cjs`, as described above, not `app:verify --with`.
- Error codes added where the proposal named none: `notice_dismissed` (paying a dismissed notice), `plate_already_listed` (same plate, overlapping interval on this account), `invalid_state`, `not_found` and `invalid_arguments`.
- `account.replenish.set` refuses an expired or declined card with `card_expired` or `card_declined`, and top-up and payment previews check the card as well as their confirms.
- The seed follows the maintainer's request for about two years of history: 174 tolls over 22 months and 18 notices, instead of 40-80 tolls over 120 days and 4-8 notices. Notice IDs are `n-0001` to `n-0018`; the proposal's example notice `n-0412` is `n-0017` here, with the same plaza, time, plate and amounts.
- A toll's time is its event's `at`. A plate-only read is charged at the class the plaza saw; a transponder read at the transponder's class.
- The withdrawal rule counts the days that remained in whole authority days.
- `vehicles.update` corrects possession dates and the label, not the vehicle class.

## Remaining work

- Pages (`pale.web`), with icons: M2. `gui_ref` is null until then.
- Two more seeds from the generator, each with a scenario schedule: M2.
- Checks (b), (d), (e) and the rest of (f): M2. Check (g), an independent reproduction: M3.
- The optional module 6 (class corrections, trip estimate) is not built.

## Maintenance scripts

- `node scripts/build-schemas.cjs` regenerates `tools.json`, `schemas/seed.schema.json`, `schemas/events.schema.json` and the identity fields of `schemas/state.schema.json`; `--check` compares only. Then run `node runtime/sdk/sync.cjs` from the repository root.
- `node scripts/generate-seed.cjs` regenerates the seed; `--check` compares only.

## Dependencies

Public runtime 1.6.0, Core API 1.2.0, contribution revision 0.4.0. `required_apps` is empty: the package runs with only its own files and the runtime. Mail 1.3.0 is an optional publish target; Calendar 1.3.0 is used only through its own Agent tools.
