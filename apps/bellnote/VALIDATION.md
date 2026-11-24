# Bellnote 1.0.0 validation

Checked 23 November 2026 (America/Los_Angeles) on Node.js v22.23.1 (Linux), public runtime 1.6.0, Core API 1.2.0, contribution revision 0.4.0, Mail 1.3.0, against base `main` commit `a4bce02`. Scope: the approved Environment proposal [`proposals/environment/bellnote.md`](../../proposals/environment/bellnote.md). All data is synthetic; no network, credentials or model API were used. The business tests, `scripts/real-mcp.cjs` and `scripts/mail-flow.cjs` also passed on Node.js v20.19.6; Node 18 was not available locally.

**Automated outcome: passed. Human workflow and provenance review: pending.** No acceptance is claimed.

## Commands and results

| Evidence | Command | Result |
| --- | --- | --- |
| App-only business tests | `cd apps/bellnote && npm test` | 41 tests, 41 passed, 0 failed |
| Walkthrough | `cd apps/bellnote && npm run example` | Report before the cut-off, two office marks: one explained and quiet, one unexplained with one notification |
| Generated contracts | `cd apps/bellnote && npm run contracts:check` | `tools.json` and the seed/events/state schemas match `scripts/build-contracts.cjs`; `fixtures/reference.json` matches its builder |
| Fixture consistency | `cd apps/bellnote && npm run fixtures:check` | `minimal.json` and `reference.json`: no problems |
| Package real MCP | `node apps/bellnote/scripts/real-mcp.cjs` | 54 checks passed |
| Bellnote → Mail | `node apps/bellnote/scripts/mail-flow.cjs` | 17 checks passed (Mail 1.3.0, real router and receiver) |
| Public verifier | `npm run app:verify -- --app apps/bellnote --output .artifacts/bellnote.json` | passed: 46 checks; `business` and `event-example` stages passed from an isolated package copy |
| CI submission validator | `node runtime/ci/verify-submissions.cjs . .artifacts/submissions a4bce02` | selection `["bellnote"]` (App-only change), `bellnote: PASS` |
| Shared contracts | `npm run contracts:check` | passed |
| Repository suite | `npm test` | 22/22 stages passed |
| Isolated package | copy of `apps/bellnote` alone: `npm test`, `npm run example`; `scripts/real-mcp.cjs --runtime DIR`, `scripts/mail-flow.cjs --runtime DIR --mail DIR` | 41/41; example passed; 54/54; 17/17. Without `--runtime` the scripts stop with a clear message |

The runtime directory is unchanged from `a4bce02`, so the CI validator above is the base validator run from the same checkout, not from a separately selected base checkout.

## Workflow-to-test mapping (acceptance plan)

Test files are in `tests/`; `business.test.cjs` loads them all. "MCP" refers to `scripts/real-mcp.cjs`, "Mail" to `scripts/mail-flow.cjs`.

| Workflow | Acceptance row: initial state → action → expected | Evidence |
| --- | --- | --- |
| W1 main | 07:10 on a school day with an 08:30 cut-off → `absences.report` for today → `submitted`; office `attendance.marked absent` → `explained`, no notification; `absence.reviewed` → `excused` on report and day | `w1` T01, T03; MCP "Report before the cut-off commits" |
| W1 controls | 09:05 → `too_late` (and exactly 08:30:00); Saturday → `not_school_day`; overlap → `conflict`; non-custodial → `not_permitted`; version unchanged each; a mark with no report → `unexplained` + one notification | `w1` T01, T02 |
| W2 main | aquarium form v1, 18.00 fee → sign v1 → `signed`, one paid payment; `form.changed` (trip date) → v2, `needs_review`; sign v2 → `signed`, no second charge; withdraw before due → `withdrawn`, payment `refunded` | `w2` T04, T06, T07, T08 |
| W2 controls | v1 after the change → `stale_form`; missing answer → `missing_answer`; other guardian's child → `already_answered`, withdrawing theirs → `not_yours`; expired card → `payment_declined`, no response written; after `env.advance_time` past due → `closed` | `w2` T04–T07; MCP "After the clock moves, the form reads closed" |
| W3 main | `pickup.person_add` → `pending_review`; `pickup.person_reviewed approve` → `approved`; `dismissal.set` Friday with that person → `active`; second set → first `replaced`; `dismissal.cancel` → `cancelled`, default applies | `w3` T10, T11 |
| W3 controls | same person for Ines → `not_authorized_person`; restricted for Theo → `restricted_person`; still pending → `pending_review`; after cut-off → `too_late`; version unchanged; other guardian's `dismissal.recorded` naming a restricted person → `invalid_event`; a revoke voids changes ahead | `w3` T11, T12, T13 |
| W4 main | Ines 3.10, threshold 5.00 → top-up 20.00 → 23.10, one transaction, one paid payment; `lunch.charged −4.25` peanut → 18.85, `restricted_item: true`; menu marks that item `excluded_for` Ines | `w4` T14, T16; MCP "Top-up commits", "restricted_item at read time" |
| W4 controls | 2.00 under a 5.00 minimum → `amount_out_of_range`; declined card → `payment_declined`, balance unchanged; repeated `request_id` → stored receipt, one charge; charge past the debt limit → `invalid_event` | `w4` T14, T15; MCP "Repeated top-up request", "Charge past the debt limit" |

### Local business tests T01–T19

| Test | Where | Notes |
| --- | --- | --- |
| T01–T03 | `tests/w1-attendance.test.cjs` | plus "cut-off rules resolve to dated instants across daylight-saving transitions" |
| T04–T08 | `tests/w2-forms.test.cjs` | |
| T09–T13 | `tests/w3-pickup.test.cjs` | `in_use` on removal is asserted in T10 |
| T14–T16 | `tests/w4-lunch.test.cjs` | |
| T17 | `tests/cross.test.cjs` | 21 invalid events, each refused as `invalid_event` (the harness discards data and clock as Core does; real-Core atomicity for events is in `scripts/real-mcp.cjs`) |
| T18 | `tests/cross.test.cjs` (two tests); MCP | notifications for others only, wire only with email notices on and valid against Mail's schema; time-only changes with the harness clock and with real `env.advance_time` |
| T19 | `tests/cross.test.cjs` (seed validation, activity rows); MCP | replay → stored receipt and one charge, changed input → `idempotency_conflict`, stale → `stale_version`, Agent calling `env.apply_event` / `env.reset` / `env.advance_time` → `permission_denied`, reset restores the loaded seed and time: real Core, in `scripts/real-mcp.cjs` |
| Rules after review | `tests/rules.test.cjs` | non-custodial guardian (T09/T18), other guardian's fee answer (T05/T06), `answered` phase (T04), moot days (T03), late events refused, early dismissal before a reported time, late/early-leave cut-offs (T02), net daily spend (T16), person_id mapping (T12), denied/removed people (T09), fee decrease (T07), one notification per kind (T18) |


Other package tests: generated contracts and tool shape (`package.test.cjs`), every read byte-identical, optional diagnostics, fixture consistency and builder match, the proposal's example events on the reference fixture (`fixtures.test.cjs`).

### Approval-review suggestions

| Suggestion | How it is met | Evidence |
| --- | --- | --- |
| Reads: business data byte-identical, audit may grow | Harness asserts JSON identity of business data on every read; real MCP asserts identical `data` and version while Core's audit grows by one allowed row; refusals leave data identical and add a denial row | `package.test.cjs`; MCP "Read leaves business data byte-identical", "Read leaves the version unchanged while the audit grows by one row", "Core records the refusal as a denial audit row" |
| Explicit cut-off representation; boundary tests for a dismissal change and DST | Rules are `{anchor: fixed, local_time}` or `{anchor: dismissal, minutes_before}`, resolved per day in the district zone and shown by `schools.get` / `pickup.get`. Tests: 08:29:59 vs 08:30:00; spring-forward (9 March) and fall-back (2 November) cut-offs; early dismissal moves the 13:40 cut-off to 11:00 (10:59 accepted, 11:00 refused); dismissal-relative cut-off across the fall-back weekend | `w1` T02 (two tests), `w3` T13 |
| Pickup identity keeps the canonical `person_id` | Mapping: supplied `person_id`, else a phone the school holds, else a new person; never the name. Tests: restricted person added by ID, by phone under another name and with another name; a namesake with a different number is accepted; restriction is per child; restricted person refused in events | `w3` T12, T10 (same phone → `conflict`) |

## Acceptance checklist self-review

Against [docs/review/app-implementation-checklist.md](../../docs/review/app-implementation-checklist.md).

| Item | Verdict | Evidence / gap |
| --- | --- | --- |
| 1.1 Promised workflows and modes from the approved proposal | met | W1–W4, 23 MCP operations, 9 events, optional Mail notices; MCP-only by approval (no GUI promised) |
| 1.2 Versions, paths, schemas, tools, hooks, events, dependencies against files | met | loader + verifier; `contracts:check`; contribution declarations derived and checked |
| 1.3 Reproduce documented startup/tests from a clean public checkout | partly met | reproduced in the working checkout and from an isolated package copy; a fresh clone by a reviewer is not run |
| 1.4 Required receiving Apps at pinned versions; contracts reused | met | Mail is optional; its 1.3.0 receive contract and wire schema are reused byte-identically; no Mail state or code copied |
| 2.1 App-only tests on real functions, invalid transitions, missing objects, read-only | met | 41 tests |
| 2.2 Create/read/update/cancel flows and history; failures preserve data | met | In the App-only harness, which discards a refused call's working copy exactly as Core does, "data unchanged" holds by construction; what those tests do check is that every Agent-write refusal is decided before the handler changes anything in its working copy. Atomicity itself is checked on real Core (`scripts/real-mcp.cjs`): stale form, declined top-up, debt-limit event, other guardian's fee answer without `can_pay`, dismissal change for a past day, a range report refused on its last day, and a committed multi-record write in one revision |
| 2.3 Data/media references and provenance | met (automated); human review pending | no media; `contribution/dataset.json` records the synthetic source and the two workflow references |
| 2.4 Optional diagnostics do not change results | met | `package.test.cjs` |
| 3.1 Real MCP discovery and calls match contracts and state | met | verifier (46), real MCP (54) |
| 3.2 Business callers cannot seed, reset, inject or snapshot; object/field authorization on the backend | met (object constraint); field constraint not applicable | Agent `permission_denied` for every `env.*`; real MCP loads a task policy limiting `lunch.topup` to `lunch-theo`: `lunch-ines` is `permission_denied` with nothing written. No Bellnote write takes a `patch`, so Core's field constraint does not apply |
| 3.3 Seed/reset, separate runs, versions, retries, events, supplied time | met | verifier and real MCP |
| 3.4 Declared messaging: receiver records, receipts, refusals, duplicates | met | Mail flow: committed receipt, inbox record, identical retry, ungranted refusal with no record, Bellnote unchanged |
| 3.5 Candidate and independently selected base validators | partly met | base runtime `a4bce02` equals the candidate runtime and its CI validator passed from this checkout; a separate base checkout was not used |
| GUI acceptance | not applicable | MCP-only by the approved plan |
| 4.1 Essential workflows have evidence; human review of realism, usability, provenance | not met (human) | automated evidence complete; human review pending: realism of the policy values and school calendar, notification wording, fictional status of the district and people |
| 4.2 Modes reported separately | met | this document: business, real MCP, verifier, messaging, manual |
| 4.3 Remaining gaps and Host dependencies listed | met | below |

## Implementation choices where the plan was silent

- **Partial cancel.** `absences.cancel` cancels the days still ahead of their cut-off; days already past stay reported and the report stays `submitted` (fully ahead → `cancelled`).
- **Late arrival / early leave cut-off.** The plan defines only the absence cut-off. A late arrival can be reported until the stated arrival time and an early leave until the stated leaving time; the time must fall strictly inside that day's school hours (an early-dismissal day uses its new dismissal time). A full-day absence uses the absence cut-off.
- **Moot per day.** Each reported day reads `moot` when it becomes closed, or (late arrival / early leave) when an early dismissal moves the end of the day to or before the reported time; the report reads `moot` only when all its days do, otherwise it keeps its state and lists `moot_dates`; moot days cannot be cancelled. The `school.day_changed` notice names reports that a change makes moot.
- **`answered` listing phase.** `closed` once the due time passes; else `answered` when every child in scope (one child with `child_id`, else every addressed child) has a signed or declined answer (`needs_review` does not count); else `open`.
- **Non-custodial guardian.** For a child the account holder is not custodial for, `children.list` omits `default_dismissal` (key absent), and no `dismissal.recorded`, `pickup.person_reviewed` or `dismissal.void` notification is written; `school.day_changed` notices carry no pickup detail for that child. The events still apply and write activity rows. Closed-day notices say "your dismissal change" only for changes the account holder made, otherwise "the dismissal change recorded by" its author.
- **Other guardian's fee.** Their `form.answered` signing a form with a fee needs their `can_pay` for that child, else `invalid_event`.
- **Daily spending** counts purchases net of same-day meal refunds credited to the balance (never below zero).
- **person_id with another person's phone.** A supplied `person_id` with a phone number the school holds for a different person is refused (`restricted_person` if that person is restricted for the child, else `conflict`); no person record is changed.
- **Fee decrease on a changed form.** Re-signing after a fee decrease does not refund the difference; the full amount is refunded on withdrawal or on declining after the change. Partial refunds are not modelled.
- **Lunch refunds.** `lunch.charged` with `kind: refund` and a `payment_id` returns that top-up to its payment method (amount equal to minus the top-up; the payment becomes `refunded`); without a `payment_id` it is a positive meal credit.
- **Low-balance notice after a settings change.** Setting the threshold re-arms the once-per-crossing rule against the current balance without notifying (the guardian's own write).
- **Form title.** A title change is versioned like a text change.
- **The other guardian's fee** is recorded on their response (`paid_cents`); their payment method is not in this account, so no payment record is written here.
- **Attendance corrections.** A second `attendance.marked` for the same child and day corrects the record and keeps its history.
- **Extra event refusals** beyond the plan's list: a mark for a future day or a non-school day, a calendar change for a past day, an early dismissal outside the usual day, a staff ID unknown to the school, a `form.changed` on a closed form, a `dismissal.recorded` for a day whose dismissal has passed.
- **Write results** use `state` for the object's state, because Core owns `status` (`committed`).

## Remaining gaps and dependencies

- Human review (realism, wording, provenance and the fictional status of all names) is pending.
- `schemas/router-message.schema.json` is a byte-identical copy of Mail's generated wire schema. The repository generator (`runtime/build-contracts.cjs`, runtime-owned) does not list it, so `npm run contracts:check` does not detect drift; `scripts/mail-flow.cjs` compares it with Mail's copy and the router rejects a mismatched contract hash. Adding it to the generator's copy list is a runtime change for Infra review.
- Node 18 was not run locally (Node 22.23.1 and 20.19.6 were); CI runs the Node 18/22 matrix.
- No outbox or cross-App transaction for Mail notices (platform limitation, as planned).
