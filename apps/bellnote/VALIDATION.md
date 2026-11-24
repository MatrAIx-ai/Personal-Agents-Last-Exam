# Bellnote 1.0.0 validation

Checked 24 November 2026 (America/Los_Angeles) on Node.js v22.23.1 and v18.20.8 (Linux), public runtime 1.6.0, Core API 1.2.0, contribution revision 0.4.0, Mail 1.3.0, Chromium 141.0.7390.37 (Playwright 1.56.1), against base `main` commit `a4bce02`. Scope: the approved Environment proposal [`proposals/environment/bellnote.md`](../../proposals/environment/bellnote.md). All data is synthetic; no network, credentials or model API were used. Before the GUI was added, the business tests, `scripts/real-mcp.cjs` and `scripts/mail-flow.cjs` also passed on Node.js v20.19.6 (not re-run for this revision).

The web GUI was added after plan approval at the maintainers' request; the approved plan said MCP-only. The maintainers also moved the history floor for all Environments after approval (seeded history starts on 2025-01-01), so the reference fixture now carries generated history from 2025-01-01 (section "Seeded history from 2025-01-01" below). The proposal file is unchanged.

**Automated outcome: passed. Human workflow and provenance review: pending.** No acceptance is claimed.

## Commands and results

| Evidence | Command | Result |
| --- | --- | --- |
| App-only business tests | `cd apps/bellnote && npm test` | 44 tests, 44 passed, 0 failed (Node 22 and 18) |
| Walkthrough | `cd apps/bellnote && npm run example` | Report before the cut-off, two office marks: one explained and quiet, one unexplained with one notification |
| Generated contracts | `cd apps/bellnote && npm run contracts:check` | `tools.json` and the seed/events/state schemas match `scripts/build-contracts.cjs` |
| Fixture consistency | `cd apps/bellnote && npm run fixtures:check` | `minimal.json` and `reference.json`: no problems; reference 865 records, 437 KB (288 KB compact), generated history from 2025-01-01 passes its checks, `fixtures/reference.json` matches its builder (Node 22 and 18) |
| Generated history | `cd apps/bellnote && npm run fixtures:history` | rebuilt byte-identical to the committed fixture; no history problems (Node 22 and 18) |
| Package real MCP | `node apps/bellnote/scripts/real-mcp.cjs` | 54 checks passed (Node 22 and 18) |
| Bellnote → Mail | `node apps/bellnote/scripts/mail-flow.cjs` | 17 checks passed (Mail 1.3.0, real router and receiver; Node 22 and 18) |
| Web smoke (real shared Host, no browser) | `cd apps/bellnote && npm run web:smoke` | 14 tests, 14 passed (Node 22 and 18) |
| Web browser (Chromium) | `cd apps/bellnote && npm run web:browser` | 45 checks passed (Node 22 and 18), 17 screenshots and `report.json` |
| Public verifier | `npm run app:verify -- --app apps/bellnote --output .artifacts/bellnote.json` | passed: 46 checks; `business` and `event-example` stages passed from an isolated package copy (Node 22 and 18) |
| CI selection | `node runtime/ci/select-apps.cjs . a4bce02` | `{"full":false,"ids":["bellnote"]}` |
| CI submission validator | `node runtime/ci/verify-submissions.cjs . .artifacts/submissions a4bce02` | `bellnote: PASS` (Node 22 and 18) |
| Shared contracts | `npm run contracts:check` | passed |
| Repository suite | `npm test` | 22/22 stages passed (Node 22 and 18) |
| Shared Web Host tests | `npm run test:web` | 4 tests, 4 passed (Node 22 and 18) |
| Isolated package (first version, not re-run for the GUI revision) | copy of `apps/bellnote` alone: `npm test`, `npm run example`; `scripts/real-mcp.cjs --runtime DIR`, `scripts/mail-flow.cjs --runtime DIR --mail DIR` | 41/41; example passed; 54/54; 17/17. Without `--runtime` the scripts stop with a clear message |

The runtime directory is unchanged from `a4bce02`, so the CI validator above is the base validator run from the same checkout, not from a separately selected base checkout.

## Seeded history from 2025-01-01 (maintainers' request after approval)

The maintainers moved the history floor for all Environments after the plan was approved: "Historical data starts 2025-01-01 — have the seeded history begin there … Task timeline starts 2026-01-01 … Synthetic data is fine for filling out the historical side." The approved plan described a 12-week window of the current school year; the reference fixture now also carries the spring of 2025 and the 2025–26 school year. `fixtures/minimal.json` is unchanged.

- **Generator.** `scripts/history.cjs` (mulberry32, seed 20250101, no clock, no `Math.random`); `scripts/build-reference-fixture.cjs` places its output in front of the hand-written year. `npm run fixtures:history` (`node scripts/history.cjs --check`) rebuilds the fixture and compares it byte for byte; `scripts/check-fixtures.cjs` (in `npm run fixtures:check` and `npm test`) also requires the builder match and runs the history checks.
- **What it generates** (all from 2025-01-02 to 2026-06-30): the district calendar of both years (breaks, holidays, early dismissals; three unplanned changes announced to the family by `school.day_changed` notifications); 27 attendance exceptions (19 explained by a report, 8 unexplained, each with its notification) and 14 reports (13 reviewed, 12 excused and 1 unexcused; 1 cancelled before its cut-off; 5 sent by Dana); 18 forms (6 with fees, one changed to version 2) and 23 answers (11 signed, 1 declined and 1 withdrawn by Maya; 5 by Dana; 5 by Sam); a babysitter on Theo's and Ines's lists (2 pickup people, approved, then removed in June 2026); 30 dismissal changes for Theo and Ines (4 replaced by Dana, 1 cancelled); 192 lunch transactions (159 purchases, 22 top-ups, 2 refunds of a double charge, 9 adjustments: the balance brought forward on 2 January 2025, the rollovers of June 2025 and June 2026 and the carry-over of August 2025); 111 menu days (the days a child bought lunch); 26 payments (22 top-ups, 4 fees, one refunded); 88 notifications (`ntf-h0001`–`ntf-h0088`: 19 low balance, 18 forms published, 13 reviews, 12 dismissal changes by Dana, 10 answers by Dana or Sam, 8 unexplained marks, 3 calendar changes, 2 refunds, 2 pickup reviews, 1 form change).
- **Rules it obeys, and how that is checked** (`historyProblems` in `scripts/history.cjs`, run by `check-fixtures.cjs`; `tests/fixtures.test.cjs` breaks each of the main ones and expects a problem): school-day records only on school days of that year's calendar at the school the child attended then (attendance, report days, dismissal changes, purchases, menus, form due dates); no purchase on a day the child was absent, and every purchased item is on that day's menu and free of the child's restricted allergens; Ines has no school records before kindergarten; reports, dismissal changes and pickup people only for children the account holder is custodial for and by custodial guardians; answers only by guardians with `can_sign` and fees only by guardians with `can_pay`; no restricted person and no pickup person outside their approved period named; reports and cancellations before their cut-offs, dismissal changes before theirs; top-ups within the district range with a matching payment; every generated account ledger sums to zero across its rollovers and the June 2026 rollover equals the hand-written carry-over of 26 August 2026 (so the balance at the start of the hand-written year is exactly what the generated top-ups, purchases and refunds produce); the running balance never passes the debt limit; one notification per cause (unexplained mark, review, form published or changed, other guardian's answer, Dana's dismissal change, refund, pickup review, announced calendar change); low-balance notices equal the crossings of the whole ledger, generated and hand-written together; no `pickup.person_reviewed`, `dismissal.recorded` or `dismissal.void` notification for Nico and no calendar notice naming his plan; every generated date is from 2025-01-01 to 2026-06-30. The existing non-custodial tests (`tests/rules.test.cjs`, T09/T18) still pass.
- **Hand-written records unchanged.** `build({withHistory: false})` reproduces the previous `fixtures/reference.json` byte for byte (checked against `64c45f0`), and the reference minus the generated records equals it field for field (`tests/fixtures.test.cjs`). The loaded time (2026-11-17 07:00 America/Los_Angeles), every hand-written ID and value, balances (12.50, 3.10, 20.00), `low_balance_notified`, and the next IDs the App assigns (`rep-0007`, `tx-0085`, `ntf-0021` …) are as before; the generated series (`rep-h`, `fr-h`, `tx-h`, `pay-h`, `ntf-h`, `dc-h`, `pp-h`, `form-2025-`, `form-2526-`) never match the App's `prefix-NNNN` pattern. The one person added is `person-marisol` (the babysitter, phone 555-0126).
- **Choices where the request was silent.** (1) *Earlier grades and schools.* The child record holds only the current school and grade, so no schema was added: Nico's grade-5 year at Alder shows in his 2025 marks by Alder's office and purchases at Alder's prices; grades appear in form titles. Alder forms cannot address Nico (a form's children must attend its school), so his only spring 2025 form is Kestrel's orientation for incoming grade 6 families. (2) *Calendars.* The App's school holds only the current term; earlier calendars live in `scripts/history.cjs` and are used by the checks, not stored in the seed. (3) *Attendance.* Earlier years keep exceptions only (absent, late, left early), not a present mark for every day: full marks would have added about 850 records and roughly doubled the state Core validates on every call. (4) *Lunch.* Before 2026–27 the children bought lunch about once a week (Fridays, now and then another day); in the hand-written year they buy most days. Year ends are bookkeeping pairs: a June rollover moves the balance out and the August carry-over brings it back (the hand-written year already opens with such a carry-over). Low-balance notices follow purchases, as in the hand-written year; the rollover adjustments write none. (5) *Activity log.* The seed's `activity` stays empty: activity rows are written by committed writes and applied events during a run (the evaluator's log), and the hand-written history has none either. (6) *Notification wording* is the App's own for each event kind; the hand-written notifications keep their earlier wording.
- **Business fix found with the history.** A report day before the current term read `moot` (reason `outside_term`), so every earlier-year report listed as moot. The plan defines `moot` only for days that became closed (and for a late arrival or early leave cut off by an early dismissal). `reportView` now reads such a day as `reported` with its cut-off passed and no cut-off time; current-term behaviour is unchanged. Test: "T03 a report from an earlier school year keeps its state instead of reading moot" in `tests/fixtures.test.cjs` (fails without the fix).
- **Size and reads.** 865 records; 437 KB on disk and 288 KB as compact JSON (before: 334 records, 170 KB and 112 KB); budget in `check-fixtures.cjs`: under 1 MiB on disk and 384 KiB compact. Windowed reads keep their defaults and return the current period (`attendance.list` and `lunch.account_get` 14 days back, `notifications.list` 30, `payments.list` 60, `pickup.get` and `schools.get` 14 ahead, `menu.list` 6; at most 120 days). Two reads have no window in the approved plan and now include the earlier years, unchanged as a business contract: `absences.list` without filters returns 20 reports (14.7 KB; before 6 reports, 4.4 KB) and `forms.list` 28 forms (25.1 KB; before 10, 9.4 KB). `check-fixtures.cjs` prints these sizes (`default_read_bytes`).
- **Per-call time.** Core reads and validates the whole state on every call, so calls slow down with the fixture. Measured on this machine with the real runtime over stdio MCP (mean of 10 calls after a warm-up, reference fixture loaded by `env.reset`): Node 22.23.1 about 58 ms per call before and 138 ms after (reads and a write alike); Node 18.20.8 about 66 ms before and 152 ms after, about 2.3 to 2.4 times slower. GUI views in Chromium through the shared Host (Node 22): Home 1.4 s before and 2.9–3.1 s after (it makes about ten calls), the other views 0.5–0.75 s before and 1.0–1.6 s after. Raw figures: `per-call-timing.json` and `gui-view-timing.jsonl` with the submission evidence.
- **GUI.** Attendance lists the current school year's reports and folds earlier ones under "Earlier school years" (with the year on each date); Forms folds closed forms of earlier school years the same way (open when the filter is used or one of them is selected). The browser run (45 checks) and the smoke test (14) pass unchanged on Node 22 and 18; screenshots reviewed.
- **Test count changes.** `npm test` has 44 tests (was 42): the two added are the moot fix above and "the generated history reads through the App" (earlier years, default windows, Nico's earlier school, Ines's start, no flags on generated purchases, nothing of Nico's pickup list). Changed expectations, each because the reference now contains the history: the fixture test counts hand-written records separately and asserts the generated counts and the declared record count; its "date before 2026" breakage became "date before the 2025 history floor" with six new history breakages; T09 in `rules.test.cjs` now lists the removed babysitter (`pp-h0001`, `pp-h0002`) and also refuses naming her; `scripts/real-mcp.cjs` compares the other run's report count with the reference fixture instead of the literal 6 (still 54 checks).

## Web GUI

`gui/index.html` and `gui/src/app.js` are served by the unchanged shared Host (`runtime/web/server.cjs`). The Host takes `--registry`; `web.registry.json` in this package registers Bellnote alone (path `.`, initial time from `fixtures/clock.json`), so neither `runtime/` nor the repository-wide `apps.registry.json` changes and CI still selects only `bellnote`. `contribution/gui.json` follows the Notes convention (legacy reviewer renderer `gui/src/view.js` plus the `pale.web` extension with `status: implemented`); Core's contribution loader and the verifier accept it. Views, workflows and design choices: [gui/README.md](gui/README.md).

What ran in a real browser (`tests/web-browser.cjs`, headless Chromium 141, fresh run per start), every write confirmed by an independent Agent MCP client on the same run:

| Area | Browser actions | Observed |
| --- | --- | --- |
| W1 | Attendance → Report absence (shared schema form) with a hostile reason; Cancel report (confirmation) | MCP: report `submitted` with the exact reason, then `cancelled`; reason shown as literal text, no element or script created |
| W2 | Forms → Review and sign again (App answer sheet, prefilled); Winter concert → Withdraw answer; Band festival | MCP: `signed` on version 2, still one payment; withdrawal `withdrawn` with the payment `refunded`; no Answer control for Nico, the page says Sam Reyes signs |
| W3 | Add pickup person; Change way home for Wed 18 (Pickup, Rosa); Cancel change; select Nico | MCP: person `pending_review`; plan names Rosa, then default again; Nico: no list, no controls |
| W4 | Add money 2.00 (refused); an MCP write while the next form is open, then Add money 20.00 (stale); Refresh; Add money with the response dropped, then resubmit; Alerts and limits | `amount_out_of_range` and its message stay in the form; `stale_version` with nothing charged; both submits carry one request ID and MCP shows one top-up (23.10); threshold 8.00, no limit |
| Account | Edit preferences | MCP: email copies off, default card pm-0002 |
| Shared state | Infra `env.apply_event` `lunch.charged` (peanut item), Refresh, reload | new transaction flagged restricted, balance 18.85; kept after reload |
| Boundary | `fetch` from the page's session to `env.snapshot`, `env.reset`, `env.apply_event`, `/fixtures/reference.json` | 403, 403, 403, 404 |
| Layout | all seven views at 1280 px and 390 px | no horizontal page overflow; screenshots reviewed |
| Restricted | fresh run with `--profile scenario` | "View only" in the toolbar; no write controls |
| Errors | console and page errors over the whole run | no script errors; the only failed requests are the five provoked ones (dropped response, three management calls, fixture) |

`tests/web-smoke.cjs` (no browser, default-runnable) covers served page/controller/shared files; refused hidden paths, fixtures, state, Infra routes and `env.*` calls; session, CSRF, origin and content-type checks; discovery of exactly the 23 Agent tools; six read views; one write per workflow confirmed over MCP; three refusals with data unchanged; a stale version; a request-ID retry committing once and `idempotency_conflict` on a changed retry; and the scenario profile (12 read tools, writes refused by the Host).

Choices and limits: App styles are a constructed stylesheet added from `app.js` (the Host serves only `/`, `/app.js` and shared files, and its CSP allows no inline style); the shared toolbar search is hidden and Forms and Notifications have their own filters; refusal codes are shown with the message via the stylesheet (`code · message`). Chromium needed `libasound.so.2`, which this machine lacks; the browser runs used a locally extracted copy through `LD_LIBRARY_PATH` (no system change). Not run: other browsers, a real model agent or user simulator driving the page, and a fresh clone by a reviewer.

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


Other package tests: generated contracts and tool shape (`package.test.cjs`), every read byte-identical, optional diagnostics, fixture consistency and builder match, the generated history and its checks, the earlier-year report view, the proposal's example events on the reference fixture (`fixtures.test.cjs`).

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
| 1.1 Promised workflows and modes from the approved proposal | met | W1–W4, 23 MCP operations, 9 events, optional Mail notices; the web GUI requested by the maintainers after approval is delivered (below) |
| 1.2 Versions, paths, schemas, tools, hooks, events, dependencies against files | met | loader + verifier; `contracts:check`; contribution declarations derived and checked |
| 1.3 Reproduce documented startup/tests from a clean public checkout | partly met | reproduced in the working checkout and from an isolated package copy; a fresh clone by a reviewer is not run |
| 1.4 Required receiving Apps at pinned versions; contracts reused | met | Mail is optional; its 1.3.0 receive contract and wire schema are reused byte-identically; no Mail state or code copied |
| 2.1 App-only tests on real functions, invalid transitions, missing objects, read-only | met | 44 tests |
| 2.2 Create/read/update/cancel flows and history; failures preserve data | met | In the App-only harness, which discards a refused call's working copy exactly as Core does, "data unchanged" holds by construction; what those tests do check is that every Agent-write refusal is decided before the handler changes anything in its working copy. Atomicity itself is checked on real Core (`scripts/real-mcp.cjs`): stale form, declined top-up, debt-limit event, other guardian's fee answer without `can_pay`, dismissal change for a past day, a range report refused on its last day, and a committed multi-record write in one revision |
| 2.3 Data/media references and provenance | met (automated); human review pending | no media; `contribution/dataset.json` records the authored and the generated synthetic sources (generator, seed and parameters) and the two workflow references |
| 2.4 Optional diagnostics do not change results | met | `package.test.cjs` |
| 3.1 Real MCP discovery and calls match contracts and state | met | verifier (46), real MCP (54) |
| 3.2 Business callers cannot seed, reset, inject or snapshot; object/field authorization on the backend | met (object constraint); field constraint not applicable | Agent `permission_denied` for every `env.*`; real MCP loads a task policy limiting `lunch.topup` to `lunch-theo`: `lunch-ines` is `permission_denied` with nothing written. No Bellnote write takes a `patch`, so Core's field constraint does not apply |
| 3.3 Seed/reset, separate runs, versions, retries, events, supplied time | met | verifier and real MCP |
| 3.4 Declared messaging: receiver records, receipts, refusals, duplicates | met | Mail flow: committed receipt, inbox record, identical retry, ungranted refusal with no record, Bellnote unchanged |
| 3.5 Candidate and independently selected base validators | partly met | base runtime `a4bce02` equals the candidate runtime and its CI validator passed from this checkout; a separate base checkout was not used |
| GUI runnable delivery | met | package page/controller on the shared Host via `web.registry.json`; `web:smoke`, `web:browser` |
| GUI actual controls | met | Chromium clicks through report/cancel, sign/withdraw, add person, change/cancel way home, top-up, settings, preferences, navigation, child picker, form filter |
| GUI shared state | met | every browser write read back over MCP; Infra event + Refresh; reload |
| GUI failure behavior | met | refusal code and message kept in the form; stale form; lost response retried with the same request ID, one commit |
| GUI business-only access | met | direct `env.*`, fixture and hidden-path requests refused (browser and smoke); scenario profile hides and the Host refuses writes |
| GUI files and content | met / not applicable | no file uploads in Bellnote; hostile text rendered as text |
| GUI evidence | met | this section; screenshots and `report.json`; human review of the page pending |
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
- **Lunch account ID in `children.list`** (fix made while building the GUI). No read returned a lunch account ID, so `lunch.account_get`, `lunch.topup` and `lunch.settings_update` could be reached only by guessing the fixture's naming; W4 promises reading each child's balance. `children.list` now gives `lunch_account_id` (null without an account), declared as an optional output property; test in `tests/rules.test.cjs`.

## Remaining gaps and dependencies

- Human review (realism, wording, provenance and the fictional status of all names) is pending, now including the generated history (calendar, habits, wording).
- `schemas/router-message.schema.json` is a byte-identical copy of Mail's generated wire schema. The repository generator (`runtime/build-contracts.cjs`, runtime-owned) does not list it, so `npm run contracts:check` does not detect drift; `scripts/mail-flow.cjs` compares it with Mail's copy and the router rejects a mismatched contract hash. Adding it to the generator's copy list is a runtime change for Infra review.
- The GUI is a local, loopback, single-session Host page; it is not a deployed remote service, and no model agent or user simulator was run against it.
- No outbox or cross-App transaction for Mail notices (platform limitation, as planned).
