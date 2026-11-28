# Crossway

Crossway is a resettable prepaid toll account with synthetic data, built for the approved proposal in [#27](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/27) ([`proposals/environment/crossway.md`](../../proposals/environment/crossway.md)). It belongs to a fictional state toll authority. Its workflows follow the public E-ZPass NY and Tolls by Mail sites; amounts, deadlines and two rules (below) are Crossway's own. Notice fees escalate on the clock, and paying a notice is final and gives up the right to dispute it.

This is **milestone M2 with the implementation-review fixes** (app version 0.3.0). M1 built workflows 1-5 through 22 MCP tools, clock-derived deadlines, one seed, reset, checks (a) and (c), and the host-side publisher that delivers Crossway's notices to Mail through Messaging. M2 added the nine pages on the shared business Web Host, two more seeds with example schedules, and checks (b), (d), (e) and (f). The review round (0.3.0) adds a fourth seed whose clock is 2026-12-31, so the delivered data covers 2025-01 through 2026-12; a Mail seed and a publisher run for every seed; the unknown-acknowledgement case; the coverage report; the GUI evidence index; and page fixes (dates with their zone, confirmations, Cancel on previews, disabled choices that would fail). Check (g), the independent reproduction, is M3 (see [Remaining work](#remaining-work)).

**Evidence:** [GUI evidence index](evidence/README.md) (reference and implementation screenshots, ordered workflow sequences, dependency evidence) and [dataset coverage report](evidence/coverage.md).

## Run it

Node.js 18+. The business tests, the platform checks and the publisher need no packages. The browser check needs Playwright, as the Web Host's own browser test does.

```sh
# From this directory: business, seed and mutation tests, and the example event
npm test
npm run example

# From the repository root
node runtime/cli.cjs verify --app apps/crossway --output .artifacts/crossway.json
node apps/crossway/tests/platform-checks.cjs      # retries, profiles, clock, (c) reset on every seed
node apps/crossway/tests/replay-checks.cjs        # (d) replay in two host time zones
node apps/crossway/tests/hidden-values.cjs        # (e) sentinels in tool outputs
node apps/crossway/tests/permission-checks.cjs    # (f) every gated write under browse and full
node apps/crossway/examples/publish-to-mail.cjs   # Messaging to Mail (needs examples/registry.mail.json and examples/apps/mail)
node apps/crossway/scripts/coverage-report.cjs --check            # coverage report equals a fresh run (also in npm test)
node apps/crossway/scripts/coverage-report.cjs --loading          # also reads tolls.list month by month through Core

# Pages in a real browser, including the page half of (e)
npm ci && npx playwright install chromium
node apps/crossway/tests/web-checks.cjs           # --evidence also rewrites evidence/screens/
```

## Pages

The proposal's nine pages are views of one controller, [`gui/src/app.js`](gui/src/app.js), loaded by [`gui/index.html`](gui/index.html). The shared business Web Host (`runtime/web/server.cjs`) serves only those two files and the shared client and stylesheet, so each page is a view selected from the sidebar (`#account`, `#topup`, and so on). [`contribution/gui.json`](contribution/gui.json) declares them with the optional `pale.web` extension, and `contribution.json` points `gui_ref` at it.

| Page | Shows (tool) | Actions (tool) |
| :--- | :--- | :--- |
| Account overview | status, balance, auto-replenish rule and card, cards with expiry and chargeability (`account.get`) | auto-replenish on/off, card, amount, threshold (`account.replenish.set`) |
| Top up | balance (`account.get`) | preview, then confirm (`account.topup.preview`, `account.topup.confirm`) |
| Statements | every monthly statement and the balance (`account.statements`) | none |
| Vehicles and transponders | vehicles with possession intervals and transponders with charged class (`vehicles.list`, `transponders.list`, `policies.get`) | add, end, correct dates or label, assign a transponder (`vehicles.add`, `vehicles.end`, `vehicles.update`, `transponders.assign`) |
| Toll activity | tolls, filtered by date, plate, plaza and disposition (`tolls.list`) | none |
| Notices | notices by state, and one notice with its toll, dispute and history (`notices.list`, `notices.get`) | links to payment and dispute |
| Notice payment | open notices, with **every payable notice preselected** from the `payable` flag `notices.list` returns; the tool itself takes explicit IDs | preview (lines, total, cardholder, "Payment is final and closes the right to dispute."), then confirm (`notices.pay.preview`, `notices.pay.confirm`) |
| Disputes | every dispute (`notices.list`, `disputes.get`), the rules (`disputes.reasons`) | file one: preview, then submit; withdraw a submitted one (`disputes.preview`, `disputes.confirm`, `disputes.withdraw`) |
| Policies | rates by plaza and class, fees, deadlines, the time rule and the two Crossway rules (`policies.get`) | none |

- **Same state as the tools.** Every value on a page is a field of a tool result read for that render. Amounts are formatted from cents. Times are the authority's Eastern time read from the tool's offset timestamp, shown in a US format with the zone ("Nov 2, 2026, 9:15 AM EST"), and dates as "Dec 10, 2026"; the browser's own time zone never applies. Plates, plazas, dates and amounts lead each row; record IDs come last, in a smaller muted style. The page applies no business rule and keeps no business data between renders: navigation, filters, the selected row, an open preview or confirmation and the last receipt are the only page state. Refresh, or any write, re-reads.
- **Writes.** A form writes with the version read when the page was rendered, so a page that went stale shows `stale_version` and writes nothing. An unchanged resubmission reuses its request ID, so a retry after a lost response returns the first receipt. A business error is shown on the form where the user acted, with its code, and nothing changes. A new submission first clears the previous outcome, so a receipt never sits next to a newer error. A receipt stays on its page across refreshes until the next submission or a move to another page.
- **Previews and confirmations.** Every preview (top-up, payment, dispute) is a list of labelled facts or sentences, never a raw key/value dump, with Confirm and Cancel; Cancel writes nothing (the unused preview expires) and re-reads the page. Ending possession and withdrawing a dispute ask first in place, say what the action changes, and offer a way back.
- **No choice that is certain to fail.** A card that cannot be charged (expired or declined) stays listed but disabled, with the reason in its label; a notice that cannot be paid has a disabled box and the reason beside it; a notice that cannot be disputed is a disabled option with its reason; a vehicle that already carries a transponder offers no assignment and says why. The App still checks: `tests/web-checks.cjs` re-enables such a choice in the page, as an outdated or tampered client would, and the App refuses it in place (`card_expired`, `in_collections`) with nothing stored.
- **Not found.** An address that names no page shows "Page not found" in the heading and the browser title.
- **Permissions.** Controls are drawn only for tools the run's profile allows: under `browse` the previews are there and the confirms, ends, corrections, auto-replenish and withdrawal are not; under `scenario` only reads are shown.
- **Icons.** Ten self-made 16x16 PNG icons (CC0) are embedded in `app.js` as base64 by [`scripts/build-icons.cjs`](scripts/build-icons.cjs) from text masks. The Host's content security policy allows images from `'self'` and `blob:` but not `data:`, so the page turns each PNG into a `blob:` URL. SVG is disabled. Crossway's own styles are a constructed stylesheet in `app.js`, on top of the shared stylesheet.

### Start the Web Host

```sh
# From the repository root: Dani's seed at its clock (2026-11-02 09:00 Eastern)
node runtime/web/server.cjs --app crossway --registry apps/crossway/web-registry.json --run web-demo --profile sandbox

# In another shell, optionally switch that run to another seed, then press Refresh
node apps/crossway/scripts/seed-bundle.cjs marisol --load --run web-demo
node apps/crossway/scripts/seed-bundle.cjs theo --load --run web-demo --profile browse
node apps/crossway/scripts/seed-bundle.cjs priya --load --run web-demo
```

Open the access link the Host prints. [`web-registry.json`](web-registry.json) registers Crossway alone, with `initial_time` set to Dani's seed clock. It is used instead of the repository's `apps.registry.json`, which has no Crossway entry (see [Differences from the proposal](#differences-from-the-proposal)):

- **How the clock is picked.** Core gives a new run the registry's `initial_time`; `env.load_seed` replaces it with the seed's `virtual_now`, and `env.reset` returns to the loaded one. The Web Host has no clock option and never resets an existing run. With the shared registry's `2026-11-18T09:00:00-08:00`, a new Crossway run would start 16 days after Dani's clock: reads would already show `n-0015` to `n-0018` escalated with late fees and the dispute windows of `n-0014` and `n-0015` closed, which is not the seed's story. With `web-registry.json` a new run starts at the seed clock.
- **Profiles.** The Host accepts `sandbox` (all 22 tools) or `scenario` (reads only) for a new run. `seed-bundle.cjs --load ... --profile browse|full` switches an existing run to Crossway's own profiles.

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

**Notice timing is simplified.** A violation notice is issued at the instant of the toll read that causes it (`src/account.cjs`, `issueNotice`), while a real Tolls by Mail bill arrives some weeks after the trip. The due date counts from that issue date, so the payment window an agent sees is the policy's full window from the read. Escalation and collections follow from the due date as described above.

## Scenario events

Infra applies these with `env.apply_event`. An event naming an unknown record, or not applicable in the current state, is rejected with `invalid_event` and changes nothing.

| Operation | Effect |
| :--- | :--- |
| `crossway.toll.posted` | A toll at the event time. Matched as in workflow 3; a debit may trigger replenish, `balance_low`, `replenish_failed` or `account_suspended` notices. |
| `crossway.card.status_changed` | Sets a card `active`, `declined` or `closed`. Expiry needs no event: a card past its expiry month is `card_expired`. |
| `crossway.dispute.decided` | Grants a `submitted` dispute whose reason matches a `grant_if` entry and whose evidence includes every reference that entry lists; denies any other. With no submitted dispute it records `no_target`. |

[`examples/scenario.json`](examples/scenario.json) posts a plate read of the car Dani sold; [`examples/run.cjs`](examples/run.cjs) applies it to the seed and prints the notice it bills to Dani.

Each seed also has an example event schedule in [`examples/schedules/`](examples/schedules/), outside the seed: later tolls (some on the stale vehicle, some on a transponder), a card closing or being declined, and dispute decisions whose decision tables (`grant_if`) grant only a dispute with the right reason and evidence. A decision for a notice the Agent never disputed records `no_target`. Every schedule starts at its seed's clock and applies cleanly to the seed (`tests/seeds.test.cjs`); checks (d) and (e) run them through Core.

## Notices and Mail

Every committed write or event that creates a notice stores it in the account's `outgoing` records in the same commit: balance low, replenish failed and receipts, suspension, notice issued, escalated or sent to collections, temporary plate expired, statements, top-up and payment receipts, dispute received, decided or withdrawn. Each record holds a full CloudEvents message for Mail 1.3.0's `channel.email` receive contract (`urn:pale:email-message:2`, payload `urn:pale:email-payload:1`, type `org.pale.mail.notification.v1`), validated on every commit against a pinned copy of Mail's wire schema ([`schemas/router-message.schema.json`](schemas/router-message.schema.json)). The outgoing record ID is the CloudEvents `id`. `contribution/contribution.json` declares the publish direction. Crossway does not record delivery.

[`examples/publish-to-mail.cjs`](examples/publish-to-mail.cjs) is the host-side publisher. It starts Messaging with `runtime/messaging/service.cjs --publisher crossway` and a trusted config that grants the holder's Mail account on `channel.email` ([`config.json`](examples/messaging/config.json) for `mail-dani`; `config.marisol.json`, `config.theo.json` and `config.priya.json` for the others), loads the holder's mailbox into real Mail, and drives Crossway through MCP.

**Required public dependencies.** Besides this package and the pinned runtime, the publisher needs the repository's Mail 1.3.0 package (`examples/apps/mail`) and its registry file `examples/registry.mail.json`, which every Messaging config in `examples/messaging/` names. Both are public files of this repository; in a copy that holds only this package and the runtime, copy them to the same paths. The script checks for both first and names the missing one.

- **When it runs.** Right after each Crossway write or event that can create notices, and before the next `env.advance_time`. Before delivering, it advances Mail's clock to Crossway's (the Infra barrier in `docs/runtime-time.md`). An `env.advance_time` on Crossway alone creates no notice; the script shows that, then applies an event whose commit releases three deadline notices and the event's own notice.
- **Which notices are new.** The publisher keeps its own cursor: the outgoing IDs it has handled in the current Crossway epoch. IDs in the loaded snapshot count as history. After each write or event it reads `env.snapshot` and publishes, in array order, every outgoing record whose ID is not in the cursor. A Crossway reset or seed load starts a new epoch and restarts IDs at `cw-notice-0001`, so the publisher stops rather than continue in the same Messaging run, where a reused CloudEvents id with new content would be rejected. Records already delivered stay in Mail until Mail's own reset.
- **What it shows.** A delivery staged with a missing grant ([`config.no-grant.json`](examples/messaging/config.no-grant.json)) is `rejected` with `recipient_not_authorized`, and both Mail's and Crossway's snapshots are unchanged. With the grant, each notice is `committed` and read back with Mail's `mail.get` using `receipt.event_id`; subject and body match. A retry of the same message (same CloudEvents id, new request ID) returns `duplicate: true` with the same `event_id`, and Mail still holds one copy. The run ends with a dispute decision email for a dispute whose evidence is Mail message `m-11133`, which the script also reads from Mail.
- **Unknown acknowledgement.** Mail commits a top-up receipt but the acknowledgement is lost. The router returns `unknown` (`receiver_unconfirmed`, with the attempted `event_id`, `stop_run: true` and no commit time) and halts the Messaging run: the next publish returns `halted` (`run_halted`). The publisher stops, leaves the notice unhandled and does not retry; it reconciles from Mail's own evidence (`env.event_status` for the `event_id` is `committed`, `mail.get` returns the message, Mail holds exactly one copy, Crossway is unchanged) and marks the run as not scored, as proposal section 3 says. The lost acknowledgement is staged inside the script's own process by making the router's receiver client throw after Mail's commit, the way `runtime/messaging/tests/test_time_trace.cjs` does; nothing under `runtime/` changes.
- **One run per seed.** For each of the four seeds, a separate Messaging run with that holder's Mail seed ([`mail-seed.json`](examples/messaging/mail-seed.json) for Dani, `mail-seed.marisol.json`, `mail-seed.theo.json`, `mail-seed.priya.json`) applies the seed's reference actions and example schedule in time order, delivers every new notice and reads it back, then reads from Mail every message that a dispute on the account cites as evidence (`m-11133`, `m-11140`, `m-21107`, `m-30815`, `m-31042`, `m-41206`). So the evaluator's join of dispute evidence with Mail works for all four accounts.
- **Delivery is not confirmation.** A `committed` receipt means Mail stored the message (receiver commit). Recipient or business confirmation does not apply: notices go to the account holder's own mailbox, and nobody else has to act on them.

This script replaces the acceptance command in the proposal (`npm run app:verify -- --app apps/crossway --with examples/apps/mail`): `app:verify --with` loads Mail but does not start Messaging, and main has no host-side publisher, so the connected check runs here instead.

## Permissions

`fixtures/policies.json` has four profiles. `scenario` allows only the 10 reads and `sandbox` allows every tool, matching the reference Apps. `browse` leaves out every confirm, `account.replenish.set`, `vehicles.end`, `vehicles.update` and `disputes.withdraw` (15 tools); `full` allows all 22. Crossway keeps no approval state; a task harness picks the profile. The pages draw only the controls the profile allows.

## Data

Four seeds, each generated by [`scripts/generate-seed.cjs`](scripts/generate-seed.cjs) from a fixed-seed PRNG by replaying the account's history through Crossway's own handlers, then frozen; a test checks every file equals the generator output. [`fixtures/seeds/index.json`](fixtures/seeds/index.json) lists each seed's data, binding, clock and schedule. `dani` is the manifest seed (`app.json` `fixtures.seed`); load the others with `env.load_seed` and the arguments [`scripts/seed-bundle.cjs`](scripts/seed-bundle.cjs) prints, which include a provenance bundle narrowed to that seed's source in [`contribution/dataset.json`](contribution/dataset.json). `dataset.json` records each seed file's SHA-256, clock and counts; `expected_counts` (192 records: tolls and notices) is the manifest seed's.

| Seed | Holder, account | Opened, clock | Vehicles | Tolls, plazas | Notices (open) | Status, balance |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `dani` | Dani Reyes, `cw-dani` | 2025-01-06, 2026-11-02 09:00 | 5 | 174, 12 | 18 (7) | active, $18.75 |
| `marisol` | Marisol Ortega, `cw-marisol` | 2025-02-03, 2026-03-09 09:00 | 4 | 106, 12 | 10 (6) | suspended, $3.50 |
| `theo` | Theo Lindqvist, `cw-theo` | 2025-05-12, 2026-06-15 09:00 | 5 | 138, 12 | 8 (4) | active, $24.00 |
| `priya` | Priya Raman, `cw-priya` | 2025-01-13, 2026-12-31 09:00 | 4 | 172, 12 | 12 (7) | low balance, $12.50 |

All data is synthetic: no record was collected from a real website, account or person, and there is no real anchor (the reviewer confirmed synthetic data is acceptable). The generator and the story text (vehicle labels, dispute explanations, the Mail evidence messages) were written with AI coding assistance; the records are the script's deterministic output, and `generate-seed.cjs --check` reproduces every file byte for byte. Together the seeds cover 2025-01-06 through 2026-12-30: [`evidence/coverage.md`](evidence/coverage.md) counts every represented date by month and seed in America/New_York (1,473 records on 436 distinct dates, every month of 2025-01..2026-12 populated), produced by [`scripts/coverage-report.cjs`](scripts/coverage-report.cjs), which `npm test` re-runs against the committed report. `priya` was added in the review round so the delivered history reaches the end of 2026; the other three seeds are unchanged.

Each seed has a stale vehicle, a temporary plate, three cards (the holder's valid one, the holder's expired one and another person's), tolls across all 12 plazas and notices in at least five states. What is wrong for the holder, on purpose:

- **Dani.** The auto-replenish card is Jordan Albright's Amex, from before they split up; Dani's Mastercard expired in 09/2026. The Honda Fit `HKR4471`, sold on 2026-09-28, is still listed: two notices after the sale (`n-0017`, the Kettle Creek read of 2026-10-11, and `n-0018`) and one before it (`n-0014`). Jordan's Subaru `JRD5530`, handed back on 2026-08-15, is still listed, and Jordan's notice `n-0012` is escalated next to Dani's own Kia notices `n-0013` and `n-0016`. A rental plate notice `n-0015` that SwiftRent already charged to Dani. Transponder `tp-0001` was moved to the Kia but is still assigned to the van, so it charges class 2.
- **Marisol.** Her auto-replenish Discover expired in 01/2026; two attempts in February failed and the account has been suspended since 2026-02-19, so a catering-van read on 2026-02-28 became notice `n-0009` at the mail rate. Her son Leo's Malibu `BRT6618`, sold on 2026-01-20 (bill of sale: Mail `m-21107`), is still listed: `n-0005` (escalated, dispute window closes 2026-03-17), `n-0006` (dispute submitted, awaiting the decision in the schedule) and `n-0007` came after the sale; `n-0004`, before it, is in collections. A Harborline loaner `LNR4410` (temporary, to 2026-03-13) drew `n-0008` and `n-0010`. Her sister Ana's Mastercard is on file from a weekend top-up.
- **Theo.** He traded his Mazda `TLQ1185` in on 2026-04-30 (dealer bill: Mail `m-31042`) with transponder `tp-0003` still inside and the car still listed: the next owner's commute was debited to his balance (13 tolls, $55.25 since May), and two plate reads became notices `n-0006` (escalated) and `n-0007`. Auto-replenish runs on his business partner Sam Okoro's Visa since his own expired in 03/2026. The rental plate `HRB2261` has two non-overlapping possession intervals (2025, ended; 2026-06-10 to 06-20, current). `n-0005` went back to escalated after he withdrew its dispute.

- **Priya.** The year-end account. She sold her Corolla `RMN5512` on 2026-11-14 (notice of transfer: Mail `m-41206`) after taking its tag out, but the car is still listed with `tp-0002` assigned, so the buyer's drives come back as plate-only notices: `n-0007` (dispute submitted, decision in the schedule), `n-0008` and `n-0011` (issued, still disputable). `n-0006`, from before the sale, is hers and escalated. Her new CR-V arrived on 2026-12-12 on a dealer temporary plate `TMP6120` (Mail `m-41257`) with no tag, so its tolls are notices too (`n-0009`, `n-0010`, `n-0012`); `tp-0002` belongs in it. Auto-replenish still runs on her Mastercard, which expired in 11/2026: an airport toll on 2026-12-18 left the balance at $12.50 under the $15.00 threshold and the replenish attempt failed, so one more failure suspends the account, and the schedule's New Year road trip (Mail `m-41290`) brings exactly that. Her brother Arjun's Discover is on file from a 2025 top-up.

Mail message IDs (`m-11133`, `m-11140`, `m-21107`, `m-30815`, `m-31042`, `m-41206`, `m-41257`, `m-41290`) are evidence references; Crossway never reads Mail. Every one of them exists in the holder's Mail seed in [`examples/messaging/`](examples/messaging/) (`mail-seed.json` for Dani, `mail-seed.<seed>.json` for the others), and the publisher's per-seed runs read each cited message back from real Mail. Seeded history starts on or after 2025-01-01 and every task clock and schedule event on or after 2026-01-01; a test fails on any earlier date in any seed, binding, clock or schedule. No real person, plate, card or authority data is used. Each seed passes `validateSeed` and the seed schema, its balance reconciles to the cent with the ledger and every statement, every notice maps to exactly one toll, and a plate's possession intervals do not overlap (`tests/seeds.test.cjs`). A human read-through of the seeds is still to be recorded (`dataset.json` `review.status` is `pending`).

## Checks

| Check | Where | Result |
| :--- | :--- | :--- |
| Business rules and every named error, the time contract, generator reproduction for all seeds, the date floor for every seed file | `tests/business.test.cjs` (31 tests) | pass |
| Seed checks: schema and `validateSeed`, ledger and statements to the cent, notice-to-toll mapping, non-overlapping possession intervals, the proposal's account shape, SHA-256 in `dataset.json`, schedule applies | `tests/seeds.test.cjs` (29 tests) | pass |
| Coverage: the committed report equals a fresh run; every month 2025-01..2026-12 has records; each seed's SHA-256 matches `dataset.json`; all data synthetic, human review pending | `tests/coverage.test.cjs` (3 tests) | pass |
| (a) Anchor runs over workflows 1, 2, 4 and 5 (sold car, someone else's car, rental double billing, wrong class, road trip): reference and equivalent variants pass every check; do-nothing fails exactly the checks that need a write; each wrong run fails exactly its declared checks | `tests/business.test.cjs` with `tests/checks.cjs` | pass |
| (b) 29 single-field mutants of the five reference end states each fail the check they violate; 2 equivalent mutants (a granted instead of submitted dispute; a different replenish amount) keep passing, each with its reason. Three receipt mutants survived the M1 version of the "paid with the owner's card" checks; those checks now require an approved `notice_payment` receipt that names the notice | `tests/mutants.test.cjs` (3 tests) | pass |
| (c) Reset: 20 cycles per seed, audit exported before each, each restoring the loaded state hash with no outgoing notice left, through real Core | `tests/platform-checks.cjs` | pass |
| Retries, idempotency conflicts, stale versions and used previews on the reference run; single-jump and stepwise `env.advance_time` giving the same hash; a read after an advance storing nothing | `tests/platform-checks.cjs` (21 checks) | pass |
| (d) Replay: per seed, its schedule and reference actions twice with the clock moved in several `env.advance_time` steps, then with one jump to each action and to the end; same state hash, outbound notifications and end reads; repeated under `TZ=America/Los_Angeles` and `TZ=Asia/Kolkata` with identical digests | `tests/replay-checks.cjs` (12 runs per zone) | pass |
| (e) Hidden values: each schedule's pending payloads carry sentinel strings (event IDs, new toll IDs, an extra decision-table entry). Before each event, all ten reads (every notice and dispute too) and every Agent output so far contain no pending sentinel; after it fires, its toll ID shows in `tolls.list`; event IDs and decision tables never show. The same on all nine rendered pages | `tests/hidden-values.cjs`; pages in `tests/web-checks.cjs` | pass |
| (f) Every gated write on every seed: under `browse`, `permission_denied`, audited, hash unchanged and denied again on retry, while previews, `vehicles.add` and `transponders.assign` commit; under `full`, commit, duplicate retry with the first result, `idempotency_conflict`, `stale_version`, `preview_used` or `invalid_state`, all with the hash unchanged | `tests/permission-checks.cjs` (16 checks) | pass |
| Pages: every tool named, embedded PNG icons, each page showing the tools' values with US dates and the zone and no text under 12px, writes through the pages (top-up with Cancel and a lost response, auto-replenish, end possession with its confirmation and a refused future date, assign transponder, dispute with preview and Cancel, withdraw with its confirmation, pay), choices certain to fail disabled with a reason and refused by the App when forced, a new submission clearing the old receipt, stale versions in place, reload and an independent MCP read, controls per profile, "Page not found", 390px width, all four seeds | `tests/web-checks.cjs` (59 checks, Chromium) | pass |
| Messaging to Mail: rejected (missing grant), committed and read back, deduplicated retry; unknown acknowledgement stops the run and is reconciled from Mail; one run per seed with that holder's Mail seed, every cited evidence message read back | `examples/publish-to-mail.cjs` | pass |
| Public verifier (MCP discovery, schemas, history load, event, reset, isolation, restart) | `node runtime/cli.cjs verify` | pass |
| (g) Independent reproduction by a second person | | M3 |

## Differences from the proposal

- Acceptance for the Mail connection uses `examples/publish-to-mail.cjs`, as described above, not `app:verify --with`.
- Error codes added where the proposal named none: `notice_dismissed` (paying a dismissed notice), `plate_already_listed` (same plate, overlapping interval on this account), `invalid_state`, `not_found` and `invalid_arguments`.
- `account.replenish.set` refuses an expired or declined card with `card_expired` or `card_declined`, and top-up and payment previews check the card as well as their confirms.
- Four seeds instead of three: `priya` (clock 2026-12-31) was added in the implementation review so the delivered data covers 2025-01-01 through 2026-12-31 (`docs/submission-evidence.md` section 3, merged after the plan approval). Each seed has its own Mail seed and Messaging config for the publisher.
- The seeds follow the maintainer's request for longer history: 174, 106, 138 and 172 tolls over 22, 13, 13 and 24 months, with 18, 10, 8 and 12 notices, instead of 40-80 tolls over 120 days and 4-8 notices. Notice IDs start at `n-0001` in each seed; the proposal's example notice `n-0412` is Dani's `n-0017`, with the same plaza, time, plate and amounts.
- A toll's time is its event's `at`. A plate-only read is charged at the class the plaza saw; a transponder read at the transponder's class.
- The withdrawal rule counts the days that remained in whole authority days.
- `vehicles.update` corrects possession dates and the label, not the vehicle class.
- **No entry in `apps.registry.json`.** Adding Crossway there fails the repository test stage `clock-contract`: `runtime/tests/clock.test.cjs` asserts that the shared registry holds exactly seven Apps (`assert.equal(m.configs.size,7)`), and that file is outside this package. The pages use [`web-registry.json`](web-registry.json) instead, which also starts a new run at the seed clock (see [Start the Web Host](#start-the-web-host)). The entry is one object (`{"app_id": "crossway", "version": "0.3.0", "path": "apps/crossway"}`) and can be added once the shared test counts Apps from the registry.
- Seeds other than the manifest seed are loaded with a provenance bundle (`scripts/seed-bundle.cjs`). Without one, Core's record-import fallback expects `records()` to count every object, which Crossway's does not (tolls and notices only), and refuses the load.
- There is no disputes list tool, so the disputes page reads `disputes.get` for each notice that has a dispute.
- Unknown acknowledgement (proposal section 3) is shown with the reference router's own `unknown` result, staged in the publisher's process (see [Notices and Mail](#notices-and-mail)); a real lost acknowledgement cannot be produced from outside the router without changing `runtime/`.
- Check (e) carries the sentinels in event IDs, new toll IDs and an extra decision-table entry; a toll's plate or a card's ID cannot carry one without changing what the event does.

## Remaining work

- Check (g), an independent reproduction by someone who did not build the flows: M3.
- A human read-through of the four seeds by the author, recorded in `dataset.json` `review` (now `pending`).
- The `apps.registry.json` entry, once the shared clock test allows an eighth App.
- The optional module 6 (class corrections, trip estimate) is not built.

## Maintenance scripts

- `node scripts/build-schemas.cjs` regenerates `tools.json`, `schemas/seed.schema.json`, `schemas/events.schema.json` and the identity fields of `schemas/state.schema.json`; `--check` compares only. Then run `node runtime/sdk/sync.cjs` from the repository root.
- `node scripts/generate-seed.cjs` regenerates the four seeds; `--check` compares only. After a change, update the SHA-256 and counts in `contribution/dataset.json` (`tests/seeds.test.cjs` fails until they match) and rerun `node scripts/coverage-report.cjs` (`tests/coverage.test.cjs` fails until the report matches).
- `node scripts/coverage-report.cjs` rewrites `evidence/coverage.json` and `evidence/coverage.md`; `--check` compares only; `--loading` also writes `evidence/coverage-loading.json` from real Core.
- `node tests/web-checks.cjs --evidence` (from the repository root, as `apps/crossway/tests/web-checks.cjs`) rewrites `evidence/screens/` and its `manifest.json`; `node examples/publish-to-mail.cjs --evidence` rewrites `evidence/publish-to-mail.json`.
- `node scripts/build-icons.cjs` redraws the page icons from their masks into `gui/src/app.js`; `--check` compares only.
- `node scripts/seed-bundle.cjs SEED` prints a seed's `env.load_seed` arguments; with `--load --run RUN` it loads the seed into a Web Host run.

## Dependencies

Public runtime 1.6.0, Core API 1.2.0, contribution revision 0.4.0. The pages use the shared business Web Host and client in `runtime/web/`; the browser check uses the repository's pinned Playwright. `required_apps` is empty: the package runs with only its own files and the runtime. Mail 1.3.0 is an optional publish target; Calendar 1.3.0 is used only through its own Agent tools.

The publisher example (`examples/publish-to-mail.cjs`) additionally needs two public files of this repository: the Mail 1.3.0 package at `examples/apps/mail` and the registry `examples/registry.mail.json` that the Messaging configs name. It checks for both before it starts.

Review evidence under [`evidence/`](evidence/README.md) is not a runtime asset: the App never loads it, and the reference screenshots in `evidence/reference/` belong to their owners (see its `NOTICE.md`) and are not covered by this package's license.
