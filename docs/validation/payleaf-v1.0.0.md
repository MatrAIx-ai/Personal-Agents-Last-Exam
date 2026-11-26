# Payleaf employee self-service validation report

Checked 26 November 2026 (America/New_York). Scope: the package `apps/payleaf` version **1.0.0**, public runtime **1.6.0**, Core API **1.2.0**, and Mail **1.3.0** as the optional receiver. The approved plan is [`proposals/environment/payleaf.md`](../../proposals/environment/payleaf.md), approved at commit `134d0815877694df3be208b7ec72b510fe994045`. That file is unchanged: its blob is `f27a0b1eb0eecda3d2422f9c13c0c4f69b9f2b06` at the approved commit and in the candidate tree. The package SHA-256 is `108186a95845ecdff346388984612c3301c1be8614570c2c6ec059acff22e91f`. It is the same in both Node runs and in the base-runtime report. The counts of every run and the raw reports are in [`payleaf/index.json`](payleaf/index.json) and the files beside it.

**Automated outcome: passed.** This document records implementation evidence for review. Human workflow acceptance and provenance review remain pending; no approval is claimed.

## Reproduction and evidence

| Evidence | Result | What was actually exercised |
| --- | --- | --- |
| App-only business | 62 tests: 59 passed and 3 skipped in a copy of the package alone. In the checkout with `PALE_RUNTIME_ROOT` set, 62 of 62 passed | The real App hooks, the input, output, seed and event schemas, each of the 12 App errors and the order of the error table, every rejected event and seed of the plan's lists, and the rules that the package adds. Also the deposit split, the cut-off rule, the pay run, leave hours and the carryover, window states and the default, notification text, the stored wire message, activity rows, and the Mail sender with a fake router. Five `PKG` tests check the package itself, and five `DATA` tests check the evaluation dataset. The 3 skipped tests, `T19i`, `T20` and the last `DATA` test, run the three real-runtime scripts (next rows) |
| Isolated App package | Passed | The public verifier copies the package to a temporary folder with no sibling runtime. It then runs its tests and its event example there, with a 60 second limit |
| Real public MCP, common checks | 48 checks passed | Discovery, the published input and output of the 14 read tools, Agent denial of the seven `env.*` operations, a caller that tries to override its run or role, a read, history loading, event application and retry, reset, a separate run, a restarted process and an unchanged package |
| Real public MCP, Payleaf workflows | 128 checks passed | `tests/mcp.integration.cjs`: a task seed with its own `virtual_now`, the 25 Agent tools (14 read and 11 write), the W1 to W4 paths of the plan with its numbers, 13 clock moves with `env.advance_time` and no App event, refused calls and refused events that change nothing, replays, audit and activity records, reset to the loaded seed and time, a second seed in the same run, and a second run that is not affected |
| Payleaf to Mail | 52 checks passed | `tests/mail.integration.cjs`: the real Router process and the real Mail package. An inbox record and a committed receipt, read through the Mail Agent. Seed history not sent, `email_notices` off and on again, an identical retry, a reset of Payleaf only, a new seed in the same run, a second sender object, no grant, no mailbox for the owner, a refusal by Mail, a reset of Mail, a receiver that does not answer, and Payleaf without Mail |
| Evaluation data, load and query | 18 checks passed | `tests/evaluation.integration.cjs`: `env.load_seed` loads `data/evaluation/seed.json` (165 records) at `2026-12-31T23:00:00-05:00` with its synthetic provenance bundle, and the runtime quality check passes. The Agent's read tools return the counts of `coverage.json`: 52 pay statements on 52 dates, 16 setting changes, 9 inquiries, 27 leave requests, 99 notifications, 2 closed windows with final sets, and the 4 planned pay dates of 2027. A seed as of 19 November 2026 (157 records) shows no record after that time, and its later pay dates read `planned` |
| Evaluation data, generation and coverage | Passed | `dev/generate-evaluation-data.cjs --check` (byte-identical, 171 steps), `dev/coverage.cjs --check` (138 distinct dates from 905 actual rows, 1 exclusion, 206 scheduled rows apart), `dev/check-fixture.cjs` on the dataset (4 of 4) |
| Node 18.20.8 | All rows above, and 22/22 full-suite stages passed | The existing Mail, Calendar, Core and Messaging regression suite with this package present |
| Node 22.23.5 | All rows above, and 22/22 full-suite stages passed | The same on the second supported runtime family |
| Independent base validator | All eight discovered packages passed | Unmodified main at `a4bce023953061483c41de5a287ba5e43f4a5648`, on Node 22.23.5, validated the candidate tree: this package (48 checks, the same package hash) and the seven existing ones |
| Development checks | Passed on both Node versions | `dev/build.cjs --check`, `dev/build-fixture.cjs --check`, `dev/check-fixture.cjs` (5 of 5), `dev/check-plan-examples.cjs` (11 of 11), `examples/run.cjs`, `npm run contracts:check` |
| Human review | Pending | Realism of the employer rules, the amounts, the plans and the notification wording, and provenance; automated green results do not grant acceptance |

The host was macOS (Darwin 27.2.0, arm64) with Node.js release builds. All test data was synthetic. Tests used temporary folders and local stdio MCP, without private services, user credentials, network services or model APIs. The App validation workflow of this repository has not run on this pull request yet: a run from a fork waits for a maintainer.

Run from the root of the candidate checkout:

```sh
node --version
npm run contracts:check
node apps/payleaf/dev/build.cjs --check
node apps/payleaf/dev/build-fixture.cjs --check
node apps/payleaf/dev/check-fixture.cjs
node apps/payleaf/dev/check-plan-examples.cjs
node apps/payleaf/examples/run.cjs
node --test apps/payleaf/tests/business.test.cjs
PALE_RUNTIME_ROOT=$PWD/runtime node --test apps/payleaf/tests/business.test.cjs
npm run app:verify -- --app apps/payleaf --output .artifacts/payleaf.json
node apps/payleaf/tests/mcp.integration.cjs --runtime runtime --report .artifacts/payleaf-mcp.json
node apps/payleaf/tests/mail.integration.cjs --runtime runtime --report .artifacts/payleaf-mail.json
node apps/payleaf/dev/generate-evaluation-data.cjs --check
node apps/payleaf/dev/coverage.cjs --check
node apps/payleaf/dev/check-fixture.cjs apps/payleaf/data/evaluation/seed.json 2026-12-31T23:00:00-05:00
node apps/payleaf/tests/evaluation.integration.cjs --runtime runtime --report .artifacts/payleaf-evaluation.json
npm test
```

Run the package alone from a copy that holds only `apps/payleaf/`:

```sh
node --test tests/business.test.cjs
node examples/run.cjs
```

Run the independent package check from a separate checkout of the pinned base:

```sh
node runtime/ci/verify-submissions.cjs /path/to/candidate /path/to/reports
```

The base checker was not changed or supplied from the candidate. With no base commit as a third argument it validates every package of the candidate tree. This pull request changes no file under `runtime/`, `examples/` or the root, and it does not add the App to `apps.registry.json`. Beside the approved proposal file, it adds only `apps/payleaf/`, this report and `docs/validation/payleaf/`.

## Workflow evidence

Test IDs are the IDs of the plan's acceptance table. A letter after an ID marks one more test for that ID. "MCP" is `tests/mcp.integration.cjs` and "Mail" is `tests/mail.integration.cjs`. Each control that returns an error is checked before and after: the data, the version and the activity rows do not change. The README has the same mapping with one row for each item of the plan: ["Workflow-to-test mapping"](../../apps/payleaf/README.md#workflow-to-test-mapping).

| Preconditions → action | Expected and observed result | Failure/control | Where |
| --- | --- | --- | --- |
| W1. `pay_statements.get` on a statement with earnings of 3,200.00, taxes of 640.00, a medical option of 120.00 for each pay and retirement at 5 percent | Deductions 280.00 and net pay 2,280.00, paid as 300.00 to savings and 1,980.00 to checking | An unknown statement returns `not_found`. A window that ends before it starts returns `invalid_window`. Both refused reads leave the data and the version as they were | T02, T04, MCP |
| W1. On 19 November, `calendar.list` and `settings.get` | The cut-off of 20 November reads passed. The next pay date is Friday 4 December, with its cut-off on Tuesday 1 December at 17:00. The withholding change of 16 November reads `locked` for 20 November, and a change made now would first apply to 4 December | The business data in `env.snapshot` is byte-identical before and after all 14 reads, `leave.preview` included. Each read has one allow row in the audit. Every read returns `now` with the UTC offset of the employer | T01, T01b, T03, T04, T04b, MCP |
| W2. On Wednesday 2 December, after the cut-off of 1 December at 17:00, `deposit.update` to a new account | `waiting`, and `settings.get` shows 18 December as the first pay date it applies to. The run of 4 December still pays the old accounts. The run of 18 December pays the new account and marks the change `applied` | `changes.cancel` on the locked change returns `too_late`. A change made on 30 November, before the cut-off, applies to the run of 4 December. A newer change for the same run replaces the older one, and cancelling it before the cut-off brings the older one back. A change made while no run is planned waits with no pay date | T06 to T06d, MCP |
| W2. A deposit setup with fixed amounts, percentages and one account for the remainder | Fixed amounts first, then each percentage of what is left after them (rounded down to the cent), then the remainder | A setup with no account for the remainder, two of them, four accounts, or percentages above 100 returns `invalid_split` | T05, T05b, MCP |
| W2. `retirement.set` to 8 on 10 December, then the run of 18 December | Deductions of 376.00. Retirement is rounded half up on the salary lines only. A yearly amount costs that amount over `pay_periods_per_year`, rounded up to the cent, and never more than what is left of it | A percentage of 60 with a maximum of 50 returns `over_limit`. A deduction that the pay cannot cover is taken in part and the later ones are skipped (`deductions_cut`). Net pay below the fixed amounts fills them in order (`short_deposit`). The withholding form is stored and shown, and Payleaf computes no tax | T07 to T08b, MCP |
| W2. `inquiries.open` on the statement of 4 December for a missing reimbursement of 412.50, then `inquiry.answered` with `corrected` | `open`, then `answered`. The run of 18 December carries a reimbursement line of 412.50 that names the inquiry. Its net pay is 2,596.50 | A second inquiry on the same line returns `already_open`. A withdrawn inquiry can be asked again. An inquiry 61 days after a pay date, with a window of 60, returns `too_late` | T10, T10b, MCP |
| W2. `calendar.changed` and `deposit.updated` events, and `preferences.update` | A pay date moves until its run posts, a cut-off moves only before it passes, an entry is added, and a waiting change follows the new calendar. A sent deposit is returned and then reissued, and the account reads `deposit_returned` in between. The preferences set the time zone of notification text and `email_notices` | The calendar and deposit cases of the plan's list of rejected events return `invalid_event` (T19). An unknown time zone returns `invalid_timezone` | T09, T09b, T10c, T19 |
| W3. On 2 December, `leave.preview` and `leave.request` for Monday 21 to Friday 25 December, with 25 December a company holiday, then `leave.decided` with `approve` | 4 working days and 32.0 hours. The request is `pending` and leaves 54.0 hours available. Then it is `approved` | Vacation that starts in 5 days, with 14 days of notice, returns `too_late`. 96 hours with 86 available returns `insufficient_balance`. Days that overlap the approved request return `conflict`. `leave.preview` lists every rule that a request breaks, and the request returns the first one of the table | T11, T11b, T12, MCP |
| W3. The clock passes 25 December with no App event | The approved request reads `taken`, and the balance is 54.0 | A vacation request still `pending` on its first day reads `lapsed`, and its hours are available again. A decision that arrives after that returns `invalid_event`. Approve, deny, cancel while pending, cancel approved leave before its first day, and the states that cannot be cancelled | T12, T13, T19b, MCP |
| W3. Sick leave, and 86.0 hours of vacation with a cap of 80 and a carryover date of 31 December | Sick leave for today is accepted, and it stays `pending` until the manager decides. 6.0 hours read `expiring`. Hours held on or before 31 December lower it. The forfeit arrives as `leave.adjusted` | Sick leave that starts 8 days ago, with a backdate limit of 7 days, returns `invalid_window` | T14, T14b, MCP |
| W4. `enrollment.opened` for 2027, open from 30 November to 11 December. On 3 December `benefits.elect` and `benefits.submit` | The window reads `upcoming`, then `open`, then `closed` at 23:59:59 on 11 December, by the clock alone. The saved choices start as the medical and dental choices of 2026, with nothing for the spending account. The medical option at 95.00 and 2,600.00 a year for the spending account are saved, and the set is `submitted`. After the close it reads `final`. From the first pay date of 2027 the spending account costs 100.00 for each pay (2,600.00 over 26 pay periods) | A choice before the opening time, or on 12 December after the closing time, returns `window_closed`. A yearly amount of 3,500.00 with a maximum of 3,200.00 returns `over_limit`. A submission with no saved choice for the spending account returns `incomplete` | T15 to T17, MCP |
| W4. Nothing is submitted: a fresh instance in T18, and a new lifecycle after a reset in MCP | After the closing time the set reads `defaulted`. Medical and dental keep the choices of 2026, and the spending account has no coverage | While the window is open and nothing is submitted, the account reads `enrollment_open` and `will_default`. A submitted set can be changed and submitted again until the close, and a choice saved but not submitted again is dropped. A plan outside the window, and every plan of a plan year with no window, take the same default | T17b, T18, T18b, MCP |
| The platform clock. `env.advance_time` moves the clock, and no App code runs | A change reads `locked` at its cut-off, a window `closed`, a set `final` or `defaulted`, leave `taken` or `lapsed`, and the inquiry window ends. Each of the 13 moves leaves the business data byte-identical. Nothing is rewritten | A replayed `env.advance_time` returns the stored receipt and adds no audit row. The audit has one row for each move that is not a replay. A start time spelled in UTC is read with the -05:00 offset of the employer | T20b, MCP |
| All. Each event of the plan's list of rejected events, and each seed of the plan's `validateSeed` list | `invalid_event` or `invalid_seed`, and the state is unchanged | Also each event check and each seed rule that the package adds (README, "Plan and implementation"). A fixed walk of 400 steps of writes, events and clock moves commits each valid step, so no added rule makes a valid step fail. Through real MCP, an event dated before the clock and a decision on a lapsed request return `invalid_event`, and the data, notifications, version and clock stay the same | T19 to T19e, MCP |
| All. Notifications and activity rows | One notification for each applied event, none for the account holder's own writes or for a change of time. One activity row for each committed write, each applied event and each effect. MCP counts 9 writes and 9 events | A refused call writes a deny row in the audit and no activity row (10 refusals in MCP). The seven example events of the plan apply to the small seed in time order, and the wire message of `ev-pl-402` is the plan's example message | T19f to T19h, T20c, MCP |
| All. Core contracts through real MCP | A repeated `request_id` returns the stored receipt marked `duplicate`, and makes no second leave request, no audit row and no new version. A repeated `event_id` writes no second statement and no notification. Reset restores the loaded seed and time, and it advances the epoch. It clears the audit and the receipts, so only the row of the reset itself is left. After a second seed, reset goes back to that seed's `virtual_now`. Another run is not affected | `idempotency_conflict` for changed input and for changed event content. `stale_version`, which names the current version. `permission_denied` for the Agent calling each of the seven `env.*` operations, with one deny row each. Nine hours for one day breaks the input schema, so Core returns `invalid_arguments` before any App error. Each of the 12 App errors, and the first one of the table when two fit | T20, T20d, MCP |
| Mail. A notification is committed while `email_notices` is on, and Infra runs the sender | An unread inbox record whose title and text equal the notification, and a committed receipt. The wire time is the event time, and Mail's `received_at` is Mail's own virtual time. The delivered notice of the moved pay date is the plan's example message, field for field. The sender writes nothing to Payleaf | Seed history and a notification written while `email_notices` was off are never sent. An identical retry: `duplicate` and one record. Changed text: `idempotency_conflict`. Another source account: `source_identity_mismatch`. No grant: `recipient_not_authorized`. No mailbox for the owner: `recipient_unavailable`. In both, Mail has no record and the run goes on. Mail refuses, Mail was reset, or Mail does not answer: the run halts and Payleaf keeps its commit. Without Mail, events and writes commit | T19g, T19i (Mail), T19j to T19m |

## Design review suggestion

The design review of the plan ([PR #183](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/183), at the approved commit) approved it with one suggestion, which does not affect approval: define the lifecycle boundary of the Mail sender. The package answers it in code and in tests. The proposal file is not changed. Mail's receiver contract is not changed either: `schemas/router-message.schema.json` is a byte copy of Mail's wire schema. The README gives the rule in ["Mail notifications"](../../apps/payleaf/README.md#mail-notifications) and the answer in ["The design review suggestion"](../../apps/payleaf/README.md#the-design-review-suggestion).

| What the review asked | What the package does | Evidence |
| --- | --- | --- |
| State whether publishing continues after a reset of Payleaf or a new seed | It continues. Infra keeps one sender for the whole run, like its one publisher connection | Mail: after `env.reset` on Payleaf only, its epoch advances, and Mail keeps its epoch and its messages. A new seed in the same run is a later lifecycle too, and its notice is delivered. T19j, T19m |
| Keep new-lifecycle notices distinct from old deliveries | In the epoch that the sender started in, the message `id` and the `request_id` are the notification ID, as the plan says. In a later epoch both are `<notification id>.e<epoch>` | Mail: after the reset, a new notification gets the ID of one that was already delivered. Under the plain ID the router refuses it (control). As `<id>.e<epoch>` it is committed, not a duplicate and not a conflict. T19j |
| Refresh the seed exclusions | The sender reads the notifications of the loaded seed from the `initial_data` of each snapshot | Mail: after the reset the seeded history is still not sent, under its own IDs or as `<id>.e<epoch>`. A notification that only the second seed holds is not sent either. T19k |
| Preserve stable IDs for exact retries | An exact retry keeps its identity. The router returns the first receipt, marked `duplicate` | Mail: an identical retry returns the first receipt with `duplicate` true and the same `event_id`, and Mail keeps one record. After the reset, a second `publishPending` and a direct identical `router.publish` add no record |
| Include a delivery check: retained old Mail, one new notice, no replay of seeded history and an identical retry | `tests/mail.integration.cjs` runs this with the real Router process and the real Mail package. `T19i` runs the script | Mail: Mail keeps the old messages and has exactly one new one, with the new title and text. The seeded history and the retry are in the two rows above. 52 of 52 checks passed on Node 18.20.8 and 22.23.5 |
| A case that the package adds: a second sender object in the same run | It must get the first epoch, as `createSender({infra, router, firstEpoch})` | Mail: with no `firstEpoch` the router refuses it with `idempotency_conflict`, the sender stops, Mail gets nothing and Payleaf is unchanged. With `firstEpoch` it publishes as `<id>.e<epoch>`. T19m |

## Review gates

| Review gate | Outcome |
| --- | --- |
| Package and contracts | Passed the package and schema checks. The same package hash in both Node runs and in the base validator. The wire schema is a byte copy of Mail's, and the shared schema copies match `runtime/contracts/schemas/` |
| App-only business | Passed from an isolated copy with no runtime sibling |
| Public runtime and independent integration | Passed real MCP, clock, lifecycle, permission and delivery checks, and the unmodified base validator. Mail is the only other App, and it is optional |
| Workflow and human review | Automated workflow evidence passed. Human scope, realism and provenance acceptance remain pending |

## Plan and implementation

The package follows the approved plan. The README section ["Plan and implementation"](../../apps/payleaf/README.md#plan-and-implementation) lists three groups of points:

- The event checks and seed rules that the package adds to the plan's lists (`T19c`, `T19d`). `T19e` shows that they never make a valid write or event fail.
- Seven points that differ from a sentence of the plan: the sender's rule after a reset or a new seed, a leave entry only for a leave type that earns hours, `not_found` as an error of `leave.preview`, `will_default` for the plans of the window only, `invalid_arguments` from the App for some inputs that the schema allows, 0 as a valid amount in the withholding form, and Core's `invalid_arguments` for data that breaks a package schema.
- The choices that the plan left to the implementation: argument names and extra result fields, the form of the IDs that the App makes, decimals, the bounds of days and windows, the order of pay runs and deductions, details of leave and benefits, and details of notifications and records.

Each point names its test. Two rules have no test, and the README names their code instead: a change when two planned runs have the same cut-off (`targetOf` in `src/common.cjs`), and the length limits of notification text (`write` in `src/notices.cjs`). The fixture has the counts that the plan promises, and `dev/check-fixture.cjs` asserts them.

## Data and licence

The fixture is authored and synthetic. `dev/build-fixture.cjs` replays the authored history in `dev/base.json` once through the App's own hooks, in 85 steps. So the App's own pay run computed every deduction, net pay and deposit. It then keeps the 26 newest notifications, to match the count of the plan, and the activity rows from the time of the oldest kept notification on. The result, `fixtures/minimal.json`, holds 81 records in 204,219 bytes, under the 1 MB of the plan. `contribution/dataset.json` records the provenance and the three public pages that were read for the shape of the workflows. No text, data, form, logo or brand was copied. The package has no media (0 assets). Code and fixtures are under the repository's MIT License.

### Evaluation dataset, 2025 to 2026

The reviewer asked for a full-window dataset with reproducible monthly and source counts, provenance and a load and query example, with scheduled or future rows kept apart from actual records. The package adds it in `apps/payleaf/data/evaluation/` ([README](../../apps/payleaf/data/evaluation/README.md), [coverage report](../../apps/payleaf/data/evaluation/coverage.md)). No App behavior changed.

- **Synthetic, all of it.** Payleaf is fictional, so nothing is collected and there is no real anchor. `data/evaluation/dataset.json` names one source, `evaluation-generator` of kind `synthetic`, in `record_source_ids`, and `contribution/dataset.json` declares the same source ID. Real: 0, mixed: 0.
- **How it is made.** `dev/generate-evaluation-data.cjs` (version 1.0.0, PRNG mulberry32 with seed 20250101) replays 171 scripted steps from 1 January 2025 through the App's own hooks. A rerun is byte-identical, and `manifest.json` has the SHA-256 of each file. The seed is 596,535 bytes.
- **Clock.** The seed is read at `2026-12-31T23:00:00-05:00`, so every record of 2025 and 2026, December 2026 included, is in the past. `dev/select-evaluation-seed.cjs --as-of TIME` writes a seed with only the history before an earlier time, each record in its state then, for a task that starts earlier.
- **Counts.** 165 App records: 56 pay calendar entries, 52 pay statements, 16 setting changes, 9 inquiries, 27 leave requests, 2 windows and 3 election sets, with 161 leave entries, 99 notifications and 491 activity rows. 905 actual dated rows fall on 138 distinct dates, from 1 January 2025 to 29 December 2026, and every month has records. The one exclusion is the 2025 election set, submitted on 12 November 2024.
- **Scheduled rows apart.** Pay calendar entries, cut-offs, enrollment windows, leave days and holidays are counted in their own group and never toward coverage. The rows after the clock are the 4 pay dates of 2027, 3 of their cut-offs, 2 leave days in January 2027 and the holiday of 1 January 2027.
- **Why 138 dates.** One person's pay portal has a pay run every two weeks and a few acts a month. More dates would need filler.

## What is not claimed

- No acceptance, approval or merge is claimed.
- Realism is not claimed. The employer rules, the amounts, the plans and the notification wording are synthetic, and they need human review. So does the provenance of the fixture.
- The first version is MCP only, as approved. There is no GUI and no CUA interface, so there is no GUI evidence. There is no console for payroll, the manager or the benefits team: what they do arrives as events.
- Payleaf computes no tax. The earnings and taxes of each pay run are task data. Money does not move: a deposit is a record, and a bank account is a label with its last four digits. No bank checks a new account.
- These are outside the first version, as the plan says: hours, shifts, time sheets and overtime, expense reports, health claims, dependents, beneficiaries and life events that reopen enrollment, tax forms and other document files, several jobs or accounts in one instance, the law of any real place, and push, SMS and chat channels.
- The checks call no model API. No agent trial and no benchmark task is part of this evidence.
- The Mail script shows a receiver that refuses, a receiver that was reset and a receiver that does not answer. It does not reproduce a commit by Mail whose acknowledgement is lost.
- All checks use local stdio MCP. Remote deployment, OAuth, HTTPS and production credentials are outside this evidence.
- The official CI result is not part of this report. A maintainer run of the App validation workflow on the submitted commit remains to be done.

Recommendation: ready for code and implementation review, with automated local evidence attached. Merge and acceptance remain maintainer decisions.
