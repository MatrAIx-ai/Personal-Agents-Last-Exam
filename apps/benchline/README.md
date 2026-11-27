# Benchline shared lab compute App

Self-contained PALE App package, version 1.0.0, Core API 1.2.0. It is a resettable lab compute and results workspace seen from one researcher's account: a shared GPU-hour allocation with shares, a job queue with holds and one submission check, run results, evaluation protocols with sign-off, and frozen results tables. Data is synthetic: the lab, the people, the cluster, the datasets and the results are fictional, and no affiliation is claimed. See `tools.json` for exact inputs and outputs and `schemas/seed.schema.json` for records. Business logic lives in `src/`; `plugin.cjs` exports the standard hooks.

The approved plan is [`proposals/environment/benchline.md`](../../proposals/environment/benchline.md). The validation report is [`docs/validation/benchline-v1.0.0.md`](../../docs/validation/benchline-v1.0.0.md).

## Run locally

Requires Node.js 18 or newer. No package install, private Core, account or remote service is needed (from repository root):

```sh
node --test apps/benchline/tests/business.test.cjs
node apps/benchline/examples/run.cjs
node runtime/cli.cjs verify --app apps/benchline --output .artifacts/benchline.json
node apps/benchline/tests/mcp.integration.cjs --runtime runtime
node apps/benchline/tests/mail.integration.cjs --runtime runtime
node apps/benchline/dev/check-fixture.cjs
node apps/benchline/dev/generate-dataset.cjs --check
node apps/benchline/dev/coverage.cjs --check
node apps/benchline/dev/check-fixture.cjs --evaluation
node apps/benchline/tests/evaluation.integration.cjs --runtime runtime
```

The business tests carry the plan's names `T01` to `T23`. A letter after the number marks one more test for that number, for example `T22b`. Six `PKG` tests check the package itself. That is 56 tests. On Node 18 and 22, 53 pass and 3 are skipped. With `PALE_RUNTIME_ROOT=runtime`, all 56 pass. The real MCP script passes 128 of 128 checks, the Mail script passes 57 of 57, and the evaluation data script passes 17 of 17. The three scripts take `--report FILE` to write their checks as JSON.

With only this App folder, run `node --test tests/business.test.cjs` and `node examples/run.cjs` from inside it. The tests that need the public runtime are skipped there: `T19c` runs `tests/mail.integration.cjs`, `T20` runs `tests/mcp.integration.cjs`, and `T23f` runs `tests/evaluation.integration.cjs`. Set `PALE_RUNTIME_ROOT` to the public `runtime/` directory to run them. `T19c` also needs the public checkout that holds this package as `apps/benchline` and Mail as `examples/apps/mail`. A script that cannot run prints `SKIP` with the reason and exits with code 77, and its test is then reported as skipped, not as passed. `service.cjs` uses that runtime; it does not embed a second server.

## Workflows and operations

The App has 29 Agent operations, named `benchline.<name>`, and four workflows.

| Workflow | Read | Write |
| --- | --- | --- |
| W1 Allocation, queue, results and notifications | `project.get`, `usage.summary`, `configs.list`, `configs.get`, `jobs.list`, `jobs.get`, `jobs.estimate`, `results.list`, `results.compare`, `protocols.list`, `protocols.get`, `tables.list`, `tables.get`, `notifications.list`, `preferences.get` | none |
| W2 Running jobs | | `jobs.submit`, `jobs.hold`, `jobs.release`, `jobs.cancel`, `preferences.update` |
| W3 Evaluation protocols and sign-off | | `protocols.propose`, `protocols.respond`, `protocols.withdraw` |
| W4 Reporting results | | `results.update`, `tables.create`, `tables.update`, `tables.freeze`, `tables.revise`, `tables.discard` |

- Every read returns `now`, the current virtual time with the project's UTC offset.
- Every write takes Core's `request_id` and `expected_version`, and returns the `id` of the object it wrote. The target object is always `id`: the config for `jobs.submit` and `jobs.estimate`, the protocol line for `protocols.propose`, the protocol version for `tables.create` and the frozen version for `tables.revise`. A time window is always `start` and `end`.
- The 23 App errors are checked in the order of the plan's table, and the first one that fits is returned. The App's own argument checks (`invalid_arguments`) come before them.
- Labmates, the lab head, the cluster and the researcher's scripts act through ten events: `allocation.changed`, `job.recorded`, `job.script_submitted`, `job.interrupted`, `plan.set`, `config.registered`, `protocol.proposed`, `protocol.answered`, `protocol.withdrawn` and `result.invalidated`. An event that breaks a rule is rejected with `invalid_event`, and the state does not change.

## State and time

`fixtures/minimal.json` is the initial history, read at `2026-12-09T10:00:00-05:00` (`fixtures/clock.json`). It has the counts of the plan: 1 project with 3 partitions (H100 nodes at rate 2.0, A100 nodes at rate 1.0 and free CPU nodes), the current allocation period (December 2026) with 2 earlier allocation changes in it, 6 people with shares, 12 configs in 4 families, 3 protocol lines with 7 versions in the 6 states, 60 jobs (24 of the account holder) in the 8 states, 34 results (3 excluded and 2 invalidated), 4 table versions (one in each state), 30 run plans and the 14 newest notifications. That is 115 records. The October and November periods that older jobs name are history. `fixtures/binding.json` binds people and accounts, and `fixtures/policies.json` grants the local scenario and sandbox actions. Task authors replace them through Infra's `env.load_seed`; Agents cannot load history, reset or inject events. `examples/task-data/` holds a smaller seed that a task can edit. The acceptance tests use it, because the plan's examples (an allocation of 400 with 212 used and 60 reserved) fit it exactly.

The App has no timer and no scheduler. It uses `ctx.virtual_now`, and an event is handled at its own time. Time-based states are never stored. They are computed when they are read or checked: a job that reads `running` or ended, a protocol version that reads `expired`, and the release of a notification. A job shows its start only once it has started, and its end and result only once it has ended. Run plans are world data: no read returns them.

Usage counts only the jobs of the current allocation period. A queued or running job reserves `gpus × rate × time limit`. A held job reserves nothing. An ended, cancelled or interrupted job is charged `gpus × rate × hours run`. GPU-hours have at most two decimals; the App sums each job's value rounded to the hundredth.

Core owns commit receipts and audit; the App owns business history. The state has one activity row for every committed Agent write, one for every applied event and one for each effect of a write or an event. An effect is a change to another object than the target: a notification written or removed, a job held by `allocation.changed`, a job that `plan.set` gives a run, a protocol version superseded, and a table version superseded. Effect rows have `effect: true`. Changes of the target itself are in its `history` list. Optional `ctx.log` gets the action and the object ID of each row, not values or text.

`examples/scenario.json` is one event for the fixture, applied through `env.apply_event` at the supplied time. `dev/build.cjs` writes `tools.json` and the seed and event schemas from one set of record shapes. `dev/build-fixture.cjs` and `dev/build-task-seed.cjs` write the two seeds: they replay a scripted history through the App's own hooks (`dev/replay.cjs`), so the App accepted every step. `dev/check-fixture.cjs` is the consistency script of the plan, with its own code, and `dev/check-plan-examples.cjs` compares the example events and the example message in `tests/` with the approved plan. They are development tools and do not run in the App.

## Evaluation data

`data/evaluation/` holds the delivery dataset of the plan: two years of synthetic history of one fictional lab, from 1 January 2025 to 31 December 2026, read at `2026-12-31T23:00:00-05:00`. Every record is synthetic, because Benchline models no real cluster or website (open question 5 of the plan). The folder's [README](data/evaluation/README.md) says how it is made. It has 2,298 records: 1,534 jobs (371 of the researcher, 45 of them from her script), 387 configs in 8 families, 22 protocol versions on 6 lines in all six states, 36 table versions, 307 run plans and 12 allocation changes, with 8 quarterly periods of the window. A config never changes, so a run with a usable result under a protocol is not done again under the same evaluation (the same dataset release, split and metrics, under any version of a line): a campaign runs a config on seeds that have no such run, or it registers the next config of a sweep, and a seed runs again only after it failed, timed out, was interrupted or cancelled, or was invalidated. A script sweep has no protocol, so its results cannot enter a table: when Nadia wants such a config in a table, she runs its seeds again under the signed version (32 of the 45 script results are run again this way, and 29 of these reruns are cited in tables). Once, before the Autumn conference 2026, the allocation runs short: the cut holds Nadia's queued jobs, two are released after the department returns hours, and the others are cancelled. The counted acts fall on 382 distinct dates, and every month of the window has some. Some counts differ from the plan's data section: see "Differences from the plan" in the [data README](data/evaluation/README.md#differences-from-the-plan).

- `dev/evaluation-scenarios.cjs` holds the story templates, and every record of the window belongs to exactly one story. The 18 setup records from before the window (the first configs and the first protocol versions of November and December 2024) belong to no story. `manifest.json` lists each story with its template and record IDs.
- `dev/generate-dataset.cjs` builds the stories with a seeded PRNG and replays every step in time order through the App's own hooks. `--check` compares with the committed files and checks the size limit of an `env.load_seed` request. It also prints the time of the replay.
- `dev/check-evaluation.cjs` holds the 16 committed story rules, among them `duplicates` (no usable run done again) and `withdrawals` (a typo is in the withdrawn version). `T23d` plants a contradiction for each rule and checks that it is caught.
- `dev/select-evaluation-seed.cjs --as-of TIME` writes a seed with only the history before that time, in the allocation period that contains it, each record in its state at that time. It refuses a seed that holds a later timestamp, except a planned time. At the clock it gives the delivered seed byte for byte.
- `dev/coverage.cjs` counts the dates in `America/New_York` and writes [`coverage.md`](data/evaluation/coverage.md) and `coverage.json`: the seven record kinds of the plan, each on the date of an act that happened, monthly counts, gaps, exclusions and file hashes. A planned time is listed apart and never counted: a `respond_by`, the planned run of a job that has not ended, a notice released after the clock, and a notice that a cancellation, a hold or an interruption removed. A job that was held or cancelled before it ran counts once, on its submission.
- `dev/check-fixture.cjs --evaluation` runs the consistency script on the delivered seed and on the 24 month-start seeds, and the story rules on the delivered seed.
- `tests/evaluation.integration.cjs` loads the dataset with `env.load_seed` on the real runtime and reads it back through MCP.

The small fixtures stay as smoke fixtures. The dataset is not loaded by default.

## Mail notifications

Mail is optional and send-only. No other App is required to run this package. Benchline writes the seven notification types of the plan for what other people and the cluster do, and `job.ended` for the end of the researcher's own job while `job_end_notices` is on. When `email_notices` is on at that moment, the App stores the full wire message with it, dated at its release time, for the receive contract of Mail 1.3.0 (`channel.email`, `urn:pale:email-message:2`). `schemas/router-message.schema.json` is a byte copy of Mail's schema.

`infra/sender.cjs` is the Infra-run sender. Infra gives it two connections, Benchline's Infra connection and the Messaging publisher connection, and calls `publishPending()` when it wants the pending messages sent. `infra/router.config.example.json` is an example grant.

- It publishes a notification only once the snapshot's `virtual_now` has reached its release time, and it counts the others as `waiting`. It never publishes a removed notification.
- It never sends a notification that was in the loaded seed. It reads that list from the `initial_data` of each snapshot, so the list is right after a reset or a new seed.
- In the epoch that the sender started in, the message `id` and the `request_id` are the notification ID, as the plan says. After `env.reset` or a new seed in the same run, both are `<notification id>.e<epoch>`, so a new notice never reuses an identity that the router or Mail already has. A second sender object must get the first epoch as `createSender({infra, router, firstEpoch})`.
- A delivery, or a refusal for lack of a route (no grant, or no bound mailbox), is final for a notification. Every other answer stops the sender for inspection. None of these outcomes changes Benchline.

## Evaluator records

- Every join is scoped by the run, the App, the account and the epoch. `env.snapshot` gives `run_id`, `app_id`, `epoch` and the version next to the data, and the data has `account_id`. Inside that scope, rows join on `request_id` (Agent writes), `event_id` (events) and the version.
- An activity row with `effect: false` is a separate action: a committed Agent write or an applied event. A row with `effect: true` is an effect of the write or the event with the same `request_id` or `event_id`.
- Take the snapshot before `env.reset` and before `env.load_seed`, because both start a new epoch and clear the audit.
- A replay returns the stored receipt and writes no row, so it is counted from the trace as a retry of the original. A denied call writes one deny row in Core's audit and no activity row. A change that time alone causes writes no row, and it is read from the stored due times and the clock.

## Plan and implementation

The App follows the approved plan. The delivery dataset differs from the plan's counts in the points that its README lists under "Differences from the plan". This section lists the answers to the requests of the design review, the points where the package adds a rule or reads a sentence of the plan in one way, the choices that the plan left open, and the workflow-to-test mapping.

### The requests of the design review

The design review asked, at approval, to "keep scheduled submissions on the same quota/share checks as manual submissions" and to "show that a held submission consumes no allocation until release reruns the full checks".

- **Scheduled submissions (`T22`).** A scheduled submission is `job.script_submitted`, the event of the researcher's own script. It runs the same function as `jobs.submit` (`views.check`). `T22` runs the same arguments through `jobs.submit` and through `job.script_submitted` on two copies of one state, with hard shares, for a pass, a pass in the held state, and each failing step: `time_limit_too_long`, `protocol_mismatch`, `too_many_active`, `over_allocation` and `over_share`. Each time the same job is added, or no job is added and the notification names the same error as the write. With soft shares a script job over the share is added with the flag `over_share`, as a manual one is. `tests/mcp.integration.cjs` shows `ev-bl-212` on the real host: the script job does not fit what the project has left, so no job is added and a `job.submission_rejected` notice names `over_allocation`.
- **Held submissions (`T22b`).** `jobs.submit` with `hold: true` runs only the first four steps and reserves nothing: the usage summary is byte-identical before and after the submission, and a day later. `jobs.release` then runs all six steps: it fails with `over_share`, then with `over_allocation` after a cut, and passes and reserves 96 once the hours are back. `tests/mcp.integration.cjs` shows a held submission with an unchanged usage summary and a release that fails with `over_allocation` on the real host.
- **Task #257 (`T22c`).** With a hard share, three Birch ablations queued and one held at 20:00 leave room for the 22:00 Atlas job of the researcher's script; the next morning the held ablation is released. When all four are queued, the script's job fails with `over_share`. `jobs.estimate` allows all four, as the task expects.

### Points that add a rule or read the plan in one way

- An unknown config, partition or protocol version in `job.script_submitted` is `invalid_event`, as the plan's event list says. Every later step of the check (`time_limit_too_long` to `over_share`) writes `job.submission_rejected` instead, as the event's own rule says. (`T18`, `T22`)
- The plan has no event that starts an allocation period. A new period is history that a task loads with `env.load_seed`: the earlier period moves to `past_periods`, and jobs keep their `period_id`. Usage counts only the jobs whose `period_id` is the current period. (`T01`, `T23`)
- `jobs.hold` gives the reason `agent`. The plan names `submitted_held` and `allocation`, and the Agent's own hold needs a reason too. (`T10`)
- A removed notification stays stored with `removed_at`, so the activity row that names it still resolves. It is never listed and never sent. (`T19`, `T19d`)
- The delivery dataset has 387 configs (the plan says about 40), 1,534 jobs (about 1,800), and 36 table versions (about 25). A config never changes, so about 1,800 distinct runs need sweep steps, not repeats. The data README lists each difference with its reason.
- A job fits when its reservation is at most what is left, and what is left never goes below zero (the plan's `remaining`). So a job on a partition with rate 0 always fits, even when the project or the share is overdrawn, and it never reads `over_share`. `allocation.changed` never holds a queued job that reserves nothing, because holding it frees no hours. (`T09b`)
- The allocation notice of the plan's example event `ev-bl-201` is the plan's example message with one more sentence, because the same event also changes Nadia's share: "Your share is now 45 GPU-hours, from 150." (`T19b`)
- After an event, the App runs the seed rules, as the plan says.

Seed rules (`T21`). Beside the plan's list, `validateSeed` rejects a seed with `invalid_seed` unless it keeps these rules: one ID space; every reference resolves (people, partitions, periods, configs, versions, run plans, notification and activity objects); the state fields of each job, protocol version and table version agree with their times; a held job has its reason and no run; only a completed job has a review or an invalidation, and an exclusion has a reason; a job of the account holder comes from the Agent or a script, and a labmate's job is recorded; a script job names its script; metric names are lowercase words of at most 40 characters, at most 20 metrics; hours and rates have at most two decimals; a line has at most one signed version and no two versions with one number; two run plans never have one key; a table has at most one frozen version that is not superseded. `T21b` checks that no seed rule makes a valid write or event fail: a fixed walk of 300 steps of writes, events and clock moves commits each valid step.

### Choices that the plan left open

1. List windows (`start`, `end`) are calendar days in the project's time zone, both included: the submission day for `jobs.list`, the end day for `results.list`, and the release day for `notifications.list`. (`T03`)
2. `jobs.estimate` returns `project_left` and `share_left` as what would be left after the job. Below zero they are the shortfall. `share_left` is null when the researcher has no share. (`T02`)
3. A charge is rounded to the hundredth of a GPU-hour for each job, and sums add the rounded values. (`T07`, `T10`)
4. `respond_by` is the proposal time plus `signoff_window_days` calendar days in the project's time zone, at the same wall time. (`T12`, `T13`)
5. A frozen table's manifest has, for each metric of the protocol, the count, the mean and the sample standard deviation rounded to four decimals; one value has no standard deviation (`null`). The content hash is the SHA-256 of the canonical JSON of the manifest without the hash (`src/sha256.cjs`, compared with `node:crypto`). The CSV has one row for each table row. (`T15`, `PKG`)
6. `results.compare` lists `protocol_id` among the differences when the results name different versions, and then each field of the versions that differs. A result under no protocol is never comparable. (`T04`)
7. The App makes these IDs: `job-a`, `ntf-`, `alc-` and `rp-` with four digits, `tbl-` with four digits for a table and `.v<n>` for its versions, and `<prefix>-v<n>` for the researcher's protocol version, where the prefix is that of the line's newest version. Events give their own job, config and protocol IDs. (`T06`, `T12`, `T15`)
8. Notification topics are `<account_id>:<topic>` with `allocation-changes`, `job-updates`, `protocol-updates` and `result-updates`. Times in the text use the time zone of the preferences. A given reason, rationale or note is quoted as written, except that an ordinary first word goes to lower case ("the department moved hours"); an acronym, a word with a digit or a dot, and a name of a person of the project keep their case. (`T19`, `T19h`)
9. Stored times need years 1970 to 2999. Reads still work at Core's default clock of 1970. (`T03`)
10. `jobs.list` and `results.list` have no pagination, because the plan has none. On the evaluation seed, read them in month windows.

### Workflow-to-test mapping

Each control that returns an error is checked before and after: the data, the activity rows and the commit count do not change. `T20` runs the main paths again on the real host.

| Workflow | Plan item | Tests |
| --- | --- | --- |
| W1 | Main path: with a December allocation of 400, 212 used and 60 reserved, `usage.summary` reads 128 remaining; Nadia has 36 used and 60 reserved, 54 left of 150 | `T01`, `T20` |
| W1 | Main path: `jobs.estimate` for 2 GPUs and 12 hours on `gpu-h` returns 48, 80 and 6; 24 hours returns 96 with `over_share`; `results.compare` of v2 and v1 is not comparable and names `eval_split` | `T02`, `T04`, `T20` |
| W1 | Control: 4 GPUs for 24 hours `over_allocation`; data byte-identical after every read; no read returns a wait, a run time or an outcome that is not yet due | `T02`, `T03`, `T05` |
| W2 | Main path: a job at 09:00 is queued with 48 reserved; it reads running at 09:30 and completed at 19:30 with 40 charged and 8 returned | `T06`, `T07`, `T20` |
| W2 | Main path: `allocation.changed` to 120 holds the two queued jobs (`allocation`), 0 remaining and 92 overdrawn; `jobs.release` returns `over_allocation` | `T09`, `T20` |
| W2 | Controls: `time_limit_too_long`, `protocol_mismatch`, `too_many_active`; a 15-hour run under a 12-hour limit is `timed_out` with 48 charged | `T08`, `T20` |
| W2 | A free job on the rate-0 partition fits while the project and the share are overdrawn, and a cut never holds it | `T09b` |
| W2 | Running jobs go on during a cut; a job whose reservation equals what is left fits; `hold: true` still runs `protocol_mismatch` and `time_limit_too_long` | `T09d`, `T22b` |
| W2 | A cut holds only the researcher's queued jobs, not a labmate's, and stops at exact balance (used plus reserved equal to the allocation) | `T09e` |
| W2 | A held job counts toward `max_active_jobs`; a cut that holds a planned job removes its `job.ended` notice | `T09c` |
| W2 | Hold, release and cancel; the preferences | `T10`, `T19` |
| W2 | Review request: scheduled submissions run the same check as manual ones, with the same outcomes | `T22`, `T20` |
| W2 | Review request: a held submission consumes no allocation until release reruns the full check | `T22b`, `T06`, `T20` |
| W2 | Task #257: three queued and one held leave room for the 22:00 Atlas script job; four queued make it fail | `T22c` |
| W3 | Main path: `proto-subj-v3` arrives proposed; the decline declines it; `proto-subj-v4` with seeds 0 to 4 is proposed with Nadia's signature; the lab head signs it and v2 is superseded | `T11`, `T12`, `T20` |
| W3 | `protocol_unsigned` on jobs and results under a declined or an expired version; the `protocol.updated` notices when the researcher is not a signer | `T11b`, `T12b` |
| W3 | Controls: `no_change`, `already_proposed`, `already_answered`, `not_a_signer`, `not_yours`; a version reads `expired` at its `respond_by`, and a later answer is `invalid_event` | `T12`, `T13` |
| W4 | Main path: "Main results" under v2 with two rows of three results freezes; accuracy 0.712, 0.705 and 0.719 read count 3, mean 0.7120 and sd 0.0070 | `T15`, `T20` |
| W4 | Main path: an invalidation leaves the frozen table unchanged with `cites_invalidated`; `tables.revise`, a rerun and a freeze make version 2 and supersede version 1 | `T17`, `T20` |
| W4 | A frozen table only gains flags (`cites_excluded`, `cites_invalidated`, `protocol_superseded`); an invalidation keeps the disposition | `T17b` |
| W4 | Controls: `mixed_protocols`, `duplicate_result`, `not_completed`; the freeze checks in order; results updates and `reason_required` | `T14`, `T15`, `T16` |
| All | Main path: after `env.advance_time` and no App event, a job reads running or ended, a version expired and a notice appears, and business data is unchanged; reset restores the loaded seed and time | `T20b`, `T20` |
| All | Controls: each invalid event of the plan's list `invalid_event`; replay, `idempotency_conflict`, `stale_version`; the Agent calling `env.*` gets `permission_denied` | `T18`, `T18b`, `T20` |
| All | Each of the 23 App errors, and the first one of the table when two fit | `T20d` |
| All | Activity rows: one for each write, event and effect, none for a refusal, a read or a change of time | `T20c`, `T20` |
| All | The seed rules, and no seed rule that makes a valid write fail | `T21`, `T21b` |
| Mail | One allocation notice when the allocation or the researcher's share changes, none for a labmate's share only or for no change | `T19g` |
| Mail | `job_end_notices` is read once: a later change keeps a pending notice | `T19i` |
| Mail | Notice text keeps the case of acronyms, names and titles in a given reason | `T19h` |
| Mail | Example messages pass Mail's wire schema; the ten example events apply in time order | `T19`, `T19b` |
| Mail | A notice is a received message in the bound Mail account only after its release time, with a committed receipt; an identical retry keeps one inbox record; a removed notice is never sent; without a grant Mail has no record | `T19c`, `T19d` to `T19f` |
| Data | The delivery dataset of 2025 to 2026: month-start seeds load and pass the consistency script and the story rules, the generator, coverage report and selector reproduce, only acts count, and a seed loads and is read through MCP | `T23` to `T23f` |

## Remaining manual review

Automated checks do not cover these points. A person should review the realism of the allocation, partition and policy values, the run times and metrics of the synthetic jobs, and the notification wording.

## Package map

```text
app.json                     Package identity, entrypoints, capabilities and limitations
tools.json                   Agent operations and input/output schemas
service.cjs                  Public MCP launcher (platform-provided entry)
plugin.cjs                   Standard hooks delegating to src/
src/                         Seed rules, views, the submission check, operations, events, notification text, day arithmetic and a small SHA-256
schemas/                     Seed, state and event rules, Mail's wire schema and copied public contracts
contribution/                Capabilities, the publish declaration, empty media catalog and provenance
infra/                       Infra-run Mail sender and an example Router grant
fixtures/                    Initial records, account bindings, policy and clock
dev/                         Schema and seed builders, the consistency script, the evaluation generator, story rules, selector and coverage report
examples/run.cjs             Runnable event example without a host
examples/scenario.json       Input to an Infra event injection, not an automatic scheduler
examples/task-data/          Replaceable task seed, binding, policy and clock examples
data/evaluation/             Synthetic evaluation dataset of 2025 to 2026, its provenance and its coverage report
tests/                       App-only tests and harness, schema validator, plan examples and three real-runtime scripts
```
