# Payleaf employee self-service App

Self-contained PALE App package, version 1.0.0, Core API 1.2.0. It is a resettable employee self-service portal for pay, direct deposit, leave and benefits enrollment, seen from one salaried employee's account. Data is synthetic: the employer, people, banks and plans are fictional, and no affiliation is claimed. See `tools.json` for exact inputs and outputs and `schemas/seed.schema.json` for records. Business logic lives in `src/`; `plugin.cjs` exports the standard hooks.

The approved plan is [`proposals/environment/payleaf.md`](../../proposals/environment/payleaf.md). The validation report is [`docs/validation/payleaf-v1.0.0.md`](../../docs/validation/payleaf-v1.0.0.md).

## Run locally

Requires Node.js 18 or newer. No package install, private Core, account or remote service is needed (from repository root):

```sh
node --test apps/payleaf/tests/business.test.cjs
node apps/payleaf/examples/run.cjs
node runtime/cli.cjs verify --app apps/payleaf --output .artifacts/payleaf.json
node apps/payleaf/tests/mcp.integration.cjs --runtime runtime
node apps/payleaf/tests/mail.integration.cjs --runtime runtime
node apps/payleaf/dev/check-fixture.cjs
node apps/payleaf/dev/generate-evaluation-data.cjs --check
node apps/payleaf/dev/coverage.cjs --check
node apps/payleaf/tests/evaluation.integration.cjs --runtime runtime
```

The business tests carry the plan's names `T01` to `T20`. A letter after the number marks one more test for that number, for example `T06b`. Five `PKG` tests check the package itself, and five `DATA` tests check the evaluation dataset. That is 62 tests. On Node 18 and 22, 59 pass and 3 are skipped. With `PALE_RUNTIME_ROOT=runtime`, all 62 pass. The real MCP script passes 128 of 128 checks, the Mail script passes 52 of 52, and the evaluation data script passes 18 of 18. The three scripts take `--report FILE` to write their checks as JSON.

With only this App folder, run `node --test tests/business.test.cjs` and `node examples/run.cjs` from inside it. Three tests need the public runtime and are skipped there: `T19i` runs `tests/mail.integration.cjs`, `T20` runs `tests/mcp.integration.cjs`, and the last `DATA` test runs `tests/evaluation.integration.cjs`. Set `PALE_RUNTIME_ROOT` to the public `runtime/` directory to run them. `T19i` also needs the public checkout that holds this package as `apps/payleaf` and Mail as `examples/apps/mail`, so in a copy outside the checkout it stays skipped. A script that cannot run prints `SKIP` with the reason and exits with code 77, and its test is then reported as skipped, not as passed. `service.cjs` uses that runtime; it does not embed a second server.

## Workflows and operations

The App has 25 Agent operations, named `payleaf.<name>`, and four workflows.

| Workflow | Read | Write |
| --- | --- | --- |
| W1 Pay, the calendar and records | `employment.get`, `calendar.list`, `pay_statements.list`, `pay_statements.get`, `settings.get`, `changes.list`, `inquiries.list`, `leave.balances`, `leave.list`, `leave.preview`, `benefits.windows`, `benefits.get`, `notifications.list`, `preferences.get` | none |
| W2 Pay settings and questions to payroll | | `deposit.update`, `withholding.update`, `retirement.set`, `changes.cancel`, `inquiries.open`, `inquiries.withdraw`, `preferences.update` |
| W3 Leave | | `leave.request`, `leave.cancel` |
| W4 Benefits enrollment | | `benefits.elect`, `benefits.submit` |

- Every read returns `now`, the current virtual time with the employer's UTC offset.
- Every write takes Core's `request_id` and `expected_version`, and returns the `id` of the object it wrote.
- A setting write (`deposit.update`, `withholding.update` or `retirement.set`) makes a setting change. It applies to the planned pay run with the earliest cut-off after the moment of the write.
- The 12 App errors are checked in this order, and the first one that fits is returned: `not_found`, `invalid_state`, `invalid_timezone`, `invalid_window`, `window_closed`, `too_late`, `invalid_split`, `over_limit`, `already_open`, `conflict`, `insufficient_balance`, `incomplete`.
- Payroll, the manager and the benefits team act through seven events: `payroll.run_posted`, `calendar.changed`, `deposit.updated`, `inquiry.answered`, `leave.decided`, `leave.adjusted` and `enrollment.opened`. An event that breaks a rule is rejected with `invalid_event`, and the state does not change.

## State and time

`fixtures/minimal.json` is the initial history, read at `2026-11-04T10:00:00-05:00` (`fixtures/clock.json`). It has the counts of the plan: one employer with 5 rule values and 11 company holidays, 30 pay calendar entries (26 in 2026 and 4 in 2027), 22 pay statements with 150 lines and 44 deposits, 9 setting changes, 4 pay inquiries, 3 leave types with 70 leave entries and 12 leave requests, 4 plans with 9 options, 2 enrollment windows, 2 election sets and 26 notifications. That is 81 records in about 204 KB. `fixtures/binding.json` binds people and accounts, and `fixtures/policies.json` grants the local scenario and sandbox actions. Task authors replace them through Infra's `env.load_seed`; Agents cannot load history, reset or inject events. `examples/task-data/` holds a smaller seed that a task can edit.

The App has no timer and no scheduler. It uses `ctx.virtual_now`, and an event is handled at its own time. Time-based states are never stored. They are computed when they are read or checked: a `locked` change, `taken` and `lapsed` leave, the state of a window, a `final` or `defaulted` election set, the end of the inquiry window, `cutoff_passed` and the flags. A day is a calendar day in the employer's time zone. A working day is Monday to Friday and not a company holiday. A limit of N days after a day ends at the end of the calendar day that is N days later.

Core owns commit receipts and audit; the App owns business history. The state has one activity row for every committed Agent write, one for every applied event and one for each effect of an event: a statement written, a change applied or replaced, leave hours earned and a notification written. Optional `ctx.log` gets the action and the object ID of each row, not amounts or text.

`examples/scenario.json` is one `payleaf.payroll.run_posted` event for the pay date of 6 November, applied through `env.apply_event` at the supplied time. `dev/build.cjs` writes `tools.json` and the seed and event schemas from one set of record shapes. `dev/build-fixture.cjs` writes the fixture: it replays the history in `dev/base.json` through the App's own hooks, so the App's own pay run computed every deduction, net pay and deposit. `dev/check-fixture.cjs` checks the consistency and the counts of the fixture, and `dev/check-plan-examples.cjs` compares the example events and the example message in `tests/` with the approved plan. They are development tools and do not run in the App.

## Evaluation data

`data/evaluation/` holds the evaluation dataset: two years of synthetic history of the same account, from 1 January 2025 to 31 December 2026, read at `2026-12-31T23:00:00-05:00`. Every record is synthetic, and the folder's [README](data/evaluation/README.md) says how it is made. It has 165 App records, among them 52 pay statements, 27 leave requests, 9 pay inquiries, 16 setting changes and 2 enrollment windows, with 99 notifications and 491 activity rows. The actual dated records fall on 138 distinct dates, and every month of the window has some.

- `dev/generate-evaluation-data.cjs` writes the seed by replaying a scripted history, with a seeded PRNG, through the App's own hooks. `--check` compares with the committed files.
- `dev/coverage.cjs` counts the dates of the seed in `America/New_York` and writes [`coverage.md`](data/evaluation/coverage.md) and `coverage.json`: one date field for each record kind, monthly counts, gaps, exclusions and file hashes. Actual dated records count. Scheduled or future rows, such as pay calendar entries and the pay dates of 2027, are listed apart and never counted.
- `dev/select-evaluation-seed.cjs --as-of TIME` writes a seed with only the history before that time, each record in its state at that time. A task that starts before the end of 2026 uses it, so it never gets later records as history.
- `dev/check-fixture.cjs` checks the cross-record rules on the dataset as on the fixture.
- `tests/evaluation.integration.cjs` loads the dataset with `env.load_seed` on the real runtime and reads it back through MCP.

The small fixtures stay as smoke fixtures. The dataset is not loaded by default.

## Mail notifications

Mail is optional and send-only. No other App is required to run this package. Each applied event writes one notification. When `email_notices` is on at that moment, the App stores the full wire message with it, for the receive contract of Mail 1.3.0 (`channel.email`, `urn:pale:email-message:2`). `schemas/router-message.schema.json` is a byte copy of Mail's schema.

`infra/sender.cjs` is the Infra-run sender. Infra gives it two connections, Payleaf's Infra connection and the Messaging publisher connection, and calls `publishPending()` when it wants the pending messages sent. `infra/router.config.example.json` is an example grant.

The sender keeps publishing after a Payleaf reset or a new seed. This lifecycle rule answers the suggestion of the design review:

- Infra keeps one sender for the whole run, like its one publisher connection. The sender reads `env.snapshot` and calls `router.publish`. It never writes to Payleaf.
- It never sends a notification that was in the loaded seed. It reads that list from the `initial_data` of each snapshot, so the list is right after a reset or a new seed.
- In the epoch that the sender started in, the message `id` and the `request_id` are the notification ID, as the plan says.
- After `env.reset` or a new seed in the same run, Payleaf has a new epoch and can make an old notification ID again. From then on both IDs are `<notification id>.e<epoch>`. So a new notice never reuses an identity that the router or Mail already has. Mail keeps the messages that were delivered before the reset.
- An exact retry keeps its identity. The router returns the first receipt, marked `duplicate`, and Mail keeps one inbox record.
- The sender remembers the first epoch in memory. A second sender in the same run must get it as `createSender({infra, router, firstEpoch})`.
- The sender publishes a notification until it gets a final answer. A delivery is final. A refusal for lack of a route (no grant, or no bound mailbox) is also final: Mail has no record, and the sender goes on to the next notification.
- Every other answer stops the sender for inspection: a halted run, an unknown outcome, or an identity or a contract that the router refuses. The next call tries the same notification again. If Mail rejects the message, or its answer is unknown, the router also halts the run. None of these outcomes changes Payleaf.

## Plan and implementation

The package follows the approved plan. This section lists the points where the package adds a rule or differs from a sentence of the plan, then the choices that the plan left open, then the answer to the design review, and last the workflow-to-test mapping. Each point names its test, or the rule in the code when no test covers it.

### Points that add a rule or differ from the plan

The plan says that Payleaf rejects events only for the reasons in its list, and it lists the seeds that `validateSeed` rejects. The package adds the event rules and seed rules below. They keep the records consistent with each other.

Events (`T19c`). Each rule below rejects an event with `invalid_event`:

- Runs post in calendar order: the earlier cut-off first, then the earlier pay date, then the lower ID. A run is refused while another planned entry comes before it. So "the value the last run used" has one meaning.
- `calendar.changed` is refused when it changes the pay period of an entry, or when it changes nothing.
- `calendar.changed` is also refused when it puts a cut-off at the time of the event, not only before it. A cut-off at the present has already passed, so a locked change never moves to another run.
- `enrollment.opened` is refused when the plan year already has a stored election set, not only when it has a window. A seed can hold such a set with no window, as history.
- `leave.adjusted` cannot use the reason `accrual`, because only a posted run earns hours. The event schema allows `carryover`, `forfeited`, `correction` and `grant`.
- These structure checks are also added:
  - a pay run line ID used twice, or one that equals a deduction line ID (`d1`, `d2`, ...);
  - a pay run line or a correction of zero or less, or with more than two decimals;
  - a `corrected` answer with no `correction_amount`, or a `no_change` answer with one;
  - a new entry whose period ends before it starts, or a date that is not a real calendar date;
  - a `reissued` deposit with no `reissued_to`, a `returned` one with it, an account with no last four digits, or a check with them;
  - a leave adjustment of zero hours, or with more than one decimal;
  - a window that names no plan, or one plan twice.

Seed rules (`T19d`). Beside the plan's list, `validateSeed` rejects a seed with `invalid_seed` unless it keeps these rules:

- One ID space: no two objects of any kind share an ID.
- A statement agrees with its pay calendar entry, has an earnings line and unique line IDs, and is posted at or after the cut-off of its run and not after the clock. No deduction takes more than is due, and none is taken after one that was cut.
- `settings` holds the values that the last posted run used.
- A change made before the cut-off of a posted run has a stored state: `cancelled`, `applied` or `replaced`. Each posted run applied the latest change of each setting and stored the earlier ones as `replaced`. Its statement names the changes it applied.
- The stored state of each change, inquiry, leave request and deposit fits its other fields. For example, a cancelled change has a cancel time, and a deposit history follows the order `sent`, `returned`, `reissued`.
- The days and hours of a leave request follow from its range, the company holidays and its hours per day.
- Saved choices and election sets fit their window and their plans: a choice for each plan of the window, made while the window was open, and not above the plan's maximum.
- The overlap rule uses the leave states read at the clock. So a pending vacation request that has lapsed holds no day.
- Amounts have at most two decimals, and hours and percentages at most one. Dates are real dates, time zones are known, and activity rows and notifications name objects that exist.

A seed can still hold history that the App would refuse to write now, for example sick leave asked for 13 days after it started (`T19d`). `T19e` checks that no seed rule makes a valid write or event fail: a fixed walk of 400 steps of writes, events and clock moves commits each valid step.

Other points that differ from a sentence of the plan:

- The sender takes the notifications of the loaded seed from each snapshot, not once when it starts. After `env.reset` or a new seed in the same run, the message `id` and the `request_id` are `<notification id>.e<epoch>`, not the bare notification ID. Both answer the design review (see below). (`T19i`, `T19j` to `T19m`)
- A posted run adds a leave entry only for a leave type that earns hours. Personal time in the task-data seed earns 0 and gets none, because a leave entry of zero hours is not allowed. The plan says one entry for each leave type. (`T07`)
- `leave.preview` returns `not_found` as an error for an unknown leave type. It lists the other failures in `failures`, with `allowed: false`. (`T04`, `T11b`)
- `will_default` counts only the plans of the window. A plan outside the window cannot be chosen, so the flag does not warn about it. (`T18`)
- The App returns `invalid_arguments` for some inputs that the input schema allows: a `start` or `end` day that is not a real calendar date (for example `2026-11-31`), an amount with more than two decimals, hours or a percentage with more than one decimal, `preferences.update` with no field, and a `benefits.elect` choice that does not fit the kind of the plan (an option for the spending account, or a yearly amount for medical). The last check needs the plan, so it runs after `not_found` for the window and the plan. The other checks run before any App error. (`T05b`, `T08b`, `T10b`, `T10c`, `T11b`, `T16`)
- The withholding form takes 0 or more in its four amount fields, because a form line is often 0. Every other amount in a call must be above 0. (`T06b`, `T08b`)
- Core checks the package's schemas before the App runs. So through `env.load_seed` or `env.apply_event`, data that breaks `schemas/seed.schema.json` or `schemas/events.schema.json` returns Core's `invalid_arguments`: for example a timestamp with no UTC offset, or a `leave.adjusted` with the reason `accrual`. The hook `validateSeed` itself answers `invalid_seed` for a timestamp with no UTC offset. (`T19c`, `T19d`)

### Choices that the plan left open

Arguments and results:

- A setting write takes the account ID as `id`. Another ID returns `not_found`. (`T05b`, `T08b`)
- `inquiries.open` names a line with `line_id`. With no `line_id` it asks about the whole statement. A deduction line can be asked about too. (`T10b`)
- `benefits.elect` takes exactly one of `option_id`, `yearly_amount` and `no_coverage: true`. A plan that is not in the window returns `not_found`. (`T16`)
- In the list filters, `start` and `end` are days, both included. They are the pay date for `calendar.list` and `pay_statements.list`, the day of `made_at` for `changes.list`, and the day of `at` for `notifications.list`. `leave.list` keeps a request whose range overlaps them. `inquiries.list` takes a statement as `id`, and `leave.list` takes a leave type as `id`. (`T01` to `T04`)
- Extra result fields: a setting write returns `{id, state, applies_to}`, `leave.request` returns `{id, state, hours}`, and `benefits.submit` returns `{id, state}`. `leave.preview` also returns `allowed`, the leave type, the range, the hours per day and the available hours before and after. `calendar.list` adds `cutoff_passed`, `pay_statements.get` adds `last_inquiry_day`, and `notifications.list` shows `email_stored`, not the wire message. `email_stored` means that an email message is stored for the Infra sender, not that Mail received it. (`T01` to `T04`, `T11`, `T17`)
- `leave.cancel` takes an optional `reason` and stores it as `cancel_reason`. (`T12`)
- Events take optional fields beside the plan's examples. `calendar.changed` takes `cutoff_at`, `period_start` and `period_end`, and it needs all three with `pay_date` to add an entry. `deposit.updated` takes `reissued_to`: an account with its label and last four digits, or a check. (`T09`, `T09b`)
- The withholding form has `filing_status`, `multiple_jobs`, `dependents_amount`, `other_income`, `deductions` and `extra_withholding`. Payleaf stores it and shows it, and computes no tax from it. (`T08b`)

IDs and units:

- The App makes these IDs: `chg-`, `inq-`, `lv-`, `els-`, `ntf-` and `dep-` with four digits, `le-r` with four digits for the hours that a run earns, and `d1`, `d2`, ... for the deduction lines of a statement. A new ID has the number after the highest one in use with that form. If another object already has that ID, the App takes the next free number. Events give their own IDs to pay calendar entries, statements, leave entries and windows. (`T03`, `T07`, `T19`)
- An amount has at most two decimals, and hours and percentages have at most one. A value with more is refused: `invalid_arguments` in a call, `invalid_event` in an event and `invalid_seed` in a seed. (`T05b`, `T19c`, `T19d`)
- A retirement percentage is from 0 to `max_retirement_percent`. 0 stops saving, and the run then has no retirement line. (`T08b`)
- The input schema of `deposit.update` allows four accounts, so that the App returns `invalid_split` for them. (`T05b`)

Time:

- Today is the day of `now` in the employer's time zone. The inquiry window of a statement ends at the start of the day after its pay date plus `inquiry_window_days`. (`T10b`, `T20b`)
- Leave that needs notice must start on or after today plus `leave_notice_days`. The backdate limit applies to every leave type that needs no notice. In the seeds that is sick leave only. (`T11b`, `T14`)
- A cut-off on the pay date itself is allowed. A cut-off on a later day is refused, in a seed and in an event. (`T19` and `T19d` check the refusal.)
- The carryover date of a leave type is a month and a day that recur each year (`12-31`). `next_carryover_date` is the next one on or after today. (`T14b`)
- Times in notification text use the time zone of the preferences. The `now` of every read stays in the employer's time zone. (`T04b`, `T10c`)

Pay runs:

- When two planned runs have the same cut-off, a change applies to the first one in calendar order: the earlier pay date, then the lower ID. (No test; the rule is `targetOf` in `src/common.cjs`.)
- A deduction that is due zero is not written: an option that costs nothing (the basic dental option in the seeds), a retirement percentage of 0, or a yearly amount that is used up. After a deduction is cut, the later ones are written with an amount of 0. (`T02`, `T07c`, `T07d`, `T08b`)
- What is left of a yearly amount is that amount minus what the plan took on statements with a pay date in the same plan year. (`T07d`)
- Retirement is taken on the lines of kind `salary` only. A bonus or a reimbursement is not salary. (`T07b`)

Leave and benefits:

- `conflict` compares the working days of two requests, of any leave type. (`T11b`, `T13`)
- `leave.adjusted` is refused only for negative hours that would take `available` below zero. (`T19`)
- Every save is kept in the window, and `benefits.get` lists them as `saves`. The latest save of a plan counts. Before any save, a plan that rolls over shows its choice in force. (`T16`)
- A `defaulted` set is not stored. `benefits.get` shows it with `id: null`. (`T18`)
- A window has one stored set. A new submission replaces its choices and adds a row to its `history`. (`T17b`, `T20c`)

Notifications and records:

- The `subscription_ref` is `<account_id>:<topic>`, with the topics `pay`, `pay-calendar`, `inquiries`, `leave` and `benefits`. (`T19g`)
- A reason such as "The bank holiday schedule." starts with a small letter inside the notification text, as in the plan's example. (`T19h`)
- A notification title is cut to 200 characters, the limit of Mail's wire schema. Its text is cut to 4,000 characters, the limit of the seed schema. (No test; the rule is `write` in `src/notices.cjs`.)
- Each run also writes a `change.replaced` effect row for each change that it stores as replaced. (`T20c`)
- Setting changes, pay calendar entries, deposits and election sets keep a `history` list. Statements, inquiries and leave requests keep the time of each step in their own fields. The activity rows name the request or the event of every step. (`T09`, `T09b`, `T20c`)

### The design review suggestion

The review asked whether publishing continues after a Payleaf reset or a new seed. It does, under the lifecycle rule in "Mail notifications". A new notice gets a new identity, the seed exclusions are read again from each snapshot, and an exact retry keeps its identity.

- `T19j` to `T19m` run the sender against a fake router: delivery under the notification ID and then as `<id>.e<epoch>`, no seed history, a final no-route refusal, a stop on every other answer, and a second sender that needs `firstEpoch`.
- `T19i` runs `tests/mail.integration.cjs` with the real router and the real Mail package. After `env.reset` on Payleaf, Mail keeps its old messages and gets exactly one new message. No seeded notification is sent, under its own ID or as `<id>.e<epoch>`. An identical retry returns the same receipt and adds no record. A new seed in the same run is a later lifecycle too: its notice is delivered as `<id>.e<epoch>`, and the history of that seed is not sent.

### Workflow-to-test mapping

Each control that returns an error is checked before and after: the data, the activity rows and the commit count do not change. `T20` runs the main path of each workflow again on the real host.

| Workflow | Plan item | Tests |
| --- | --- | --- |
| W1 | Main path: earnings 3,200.00, taxes 640.00, medical 120.00 and retirement at 5 percent give deductions of 280.00 and net pay of 2,280.00, paid as 300.00 to savings and 1,980.00 to checking | `T02`, `T20` |
| W1 | Main path: the next pay date is Friday 4 December, with its cut-off on Tuesday 1 December at 17:00 | `T01`, `T20` |
| W1 | Reads of the employment record, settings and changes, leave, benefits, inquiries, notifications and preferences | `T01b`, `T03`, `T04`, `T20` |
| W1 | Control: an unknown statement returns `not_found` | `T02`, `T04`, `T20` |
| W1 | Control: a window that ends before it starts returns `invalid_window` | `T01` to `T04`, `T20` |
| W1 | Control: the business data is byte-identical after every read, `leave.preview` included | `T04b`, `T20` |
| W2 | Main path: `deposit.update` on 2 December, after the cut-off, waits, and `settings.get` shows 18 December | `T06`, `T20` |
| W2 | Main path: the run of 4 December pays the old accounts, and the run of 18 December pays the new ones and marks the change `applied` | `T06`, `T20` |
| W2 | Main path: `retirement.set` to 8 on 10 December gives the run of 18 December deductions of 376.00 | `T08`, `T20` |
| W2 | Main path: an inquiry for 412.50 on the statement of 4 December is `open`, then `answered` as `corrected`. The run of 18 December carries the line that names it, for net pay of 2,596.50 | `T10`, `T20` |
| W2 | Control: a setup with no account for the remainder returns `invalid_split` | `T05b`, `T20` |
| W2 | Control: `changes.cancel` after the cut-off returns `too_late` | `T06b`, `T20` |
| W2 | Control: an inquiry 61 days after a pay date, with a window of 60, returns `too_late` | `T10b`, `T20b` |
| W2 | Control: a second inquiry on the same line returns `already_open` | `T10`, `T10b`, `T20` |
| W2 | Control: a change made on 30 November, before the cut-off, applies to the run of 4 December | `T06b`, `T20` |
| W2 | The split, replacing and cancelling a change, no planned run, the pay run, the withholding form, calendar and deposit events, preferences | `T05`, `T06c`, `T06d`, `T07` to `T07d`, `T08b`, `T09`, `T09b`, `T10c` |
| W3 | Main path: 86.0 hours of vacation with a cap of 80 and a carryover date of 31 December read 6.0 hours `expiring` | `T11`, `T14b` |
| W3 | Main path: on 2 December, `leave.preview` for 21 to 25 December, with 25 December a holiday, reads 4 working days and 32.0 hours | `T11` |
| W3 | Main path: `leave.request` is `pending` and leaves 54.0 hours available. `leave.decided` with `approve` makes it `approved` | `T11`, `T12`, `T20` |
| W3 | Main path: after `env.advance_time` past 25 December it reads `taken` with no App event, and the balance is 54.0 | `T13`, `T20` |
| W3 | Control: vacation that starts in 5 days, with 14 days of notice, returns `too_late` | `T11`, `T20` |
| W3 | Control: 96 hours with 86 available returns `insufficient_balance` | `T11` |
| W3 | Control: days that overlap the approved request return `conflict` | `T11`, `T11b` |
| W3 | Control: sick leave for today is accepted | `T14`, `T20` |
| W3 | Control: a vacation request still `pending` on its first day reads `lapsed`, and its hours are available again | `T13`, `T20` |
| W3 | Every broken rule in a preview, cancelling, the backdate limit and the carryover | `T11b`, `T12`, `T14`, `T14b` |
| W4 | Main path: `enrollment.opened` for 2027 opens on 30 November and closes on 11 December. The saved choices start as the medical and dental choices of 2026, with nothing for the spending account | `T15`, `T16`, `T20` |
| W4 | Main path: on 3 December the medical option at 95.00 and 2,600.00 a year for the spending account are saved, and `benefits.submit` makes the set `submitted` | `T16`, `T17`, `T20` |
| W4 | Main path: after the window closes the set reads `final`, and from the first pay date of 2027 the spending account costs 100.00 for each pay | `T17`, `T20` |
| W4 | Main path: with nothing submitted the set reads `defaulted`. Medical and dental keep the 2026 choices, and the spending account has no coverage | `T18`, `T20` |
| W4 | Control: a choice on 12 December, after the closing time, returns `window_closed` | `T16`, `T20` |
| W4 | Control: a yearly amount of 3,500.00 with a maximum of 3,200.00 returns `over_limit` | `T16`, `T20` |
| W4 | Control: a submission with no saved choice for the spending account returns `incomplete` | `T17`, `T20` |
| W4 | Control: while the window is open and nothing is submitted, the account reads `enrollment_open` and `will_default` | `T18` |
| W4 | A submission changed and sent again, plans outside the window, and a plan year with no window | `T17b`, `T18b` |
| All | Main path: after `env.advance_time` and no App event, a change reads `locked`, a window `closed`, and a set `final` or `defaulted`, and the business data is unchanged | `T20b`, `T20` |
| All | Main path: reset restores the loaded seed and time | `T20` |
| All | Main path: one activity row for each committed write, each applied event and each effect, and one notification for each event | `T19f`, `T20c`, `T20` |
| All | Control: each invalid event of the plan's list returns `invalid_event`, and the state does not change | `T19`, `T19b`, `T20` |
| All | Control: a repeated `request_id` returns the stored receipt. Changed input returns `idempotency_conflict`, and a stale version returns `stale_version` | `T20` |
| All | Control: the Agent calling `env.apply_event`, `env.reset`, `env.advance_time` or another `env.*` operation gets `permission_denied` | `T20` |
| All | Control: no activity row for a replay, a rejected call or a change of time, and no notification for the account holder's own writes | `T19f`, `T20c`, `T20` |
| All | Each of the 12 App errors, and the first one of the table when two fit | `T20d` |
| All | The seed rules, and no seed rule that makes a valid write fail | `T19d`, `T19e` |
| Mail | Example messages pass Mail's wire schema, and the notice of `ev-pl-402` is the plan's example message | `T19g`, `T19h` |
| Mail | A notification is a received message in the bound Mail account with a committed receipt, and an identical retry keeps one inbox record | `T19i` |
| Mail | Without a grant, or without a bound mailbox, the router rejects the delivery and Mail has no record. The App runs fully without Mail | `T19i` |
| Data | The evaluation dataset of 2025 to 2026 loads through the seed checks and `env.load_seed`, the generator and coverage report reproduce, the cross-record rules hold, and a seed as of a time holds no later record. Report: [`data/evaluation/coverage.md`](data/evaluation/coverage.md) | `DATA` tests, `tests/evaluation.integration.cjs` |

## Package map

```text
app.json                     Package identity, entrypoints, capabilities and limitations
tools.json                   Agent operations and input/output schemas
service.cjs                  Public MCP launcher (platform-provided entry)
plugin.cjs                   Standard hooks delegating to src/
src/                         Rules, views, operations, events, the pay run, notification text and day arithmetic
schemas/                     Seed, state and event rules, Mail's wire schema and copied public contracts
contribution/                Capabilities, the publish declaration, empty media catalog and provenance
infra/                       Infra-run Mail sender and an example Router grant
fixtures/                    Initial records, account bindings, policy and clock
examples/run.cjs             Runnable event example without a host
examples/scenario.json       Input to an Infra event injection, not an automatic scheduler
examples/task-data/          Replaceable task seed, binding and policy examples
data/evaluation/             Synthetic evaluation dataset of 2025 to 2026, its provenance and its coverage report
tests/                       App-only tests and harness, schema validator, plan examples and three real-runtime scripts
dev/                         Builders for schemas, tools, the fixture and the evaluation data, the consistency check, the coverage report and the plan example check
LICENSE                      MIT for this implementation and synthetic fixtures
```

See the [cross-App guide](../../docs/app-integrations.md) and the [implementation review](../../docs/review/app-implementation.md). The implementation is original PALE code. It copies no text, data, form, logo or brand name from a real employer, bank, payroll provider, benefits carrier or public page.
