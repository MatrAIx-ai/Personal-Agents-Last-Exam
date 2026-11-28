# Benchline shared lab compute validation report

Checked 27 November 2026 (America/New_York). Scope: the package `apps/benchline` version **1.0.0**, public runtime **1.6.0**, Core API **1.2.0**, and Mail **1.3.0** as the optional receiver. The approved plan is [`proposals/environment/benchline.md`](../../proposals/environment/benchline.md), approved at commit `2e6195c11b9384f3f98ceeb4eb12b8783c6fb4bf`. That file is unchanged: its blob is `bfe7e5fdcfeaf8a5a37fae71cebefa7f55503fd2` at the approved commit and in the candidate tree. The package SHA-256 is `e86bcdb5982e5616c2b8a571489c7beca8e5449cb62ee565c92c66b319714620`. It is the same in both Node runs and in the base-runtime report. The counts of every run and the raw reports are in [`benchline/index.json`](benchline/index.json) and the files beside it.

**Automated outcome: passed.** This document records implementation evidence for review. Human workflow acceptance and provenance review remain pending; no approval is claimed.

## Delivery evidence index

This index follows the "Delivery evidence index" of [`docs/submission-evidence.md`](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/6933c430942c64f94874083815829e4a4b20920a/docs/submission-evidence.md). Versions for every row: Benchline 1.0.0, runtime 1.6.0, Core API 1.2.0, Mail 1.3.0, Node 18.20.8 and 22.23.5.

| Workflow / requirement | Scope and pinned versions | Reference screenshots | Implemented sequence / actions | Business and MCP tests | Dependency result / files / receipts | Date report / source mapping | Verdict and remaining gap |
| --- | --- | --- | --- | --- | --- | --- | --- |
| W1 Allocation, queue, results and notifications | Required, MCP only | N/A: MCP-only scope, no GUI | Task seed → `usage.summary`, `jobs.estimate`, `results.compare` and every read (see "Workflow evidence") | T01 to T05, T20; [MCP report](benchline/mcp-integration-node22.json) | N/A: no dependency | N/A: no Task history supplied | Passed. Human review of realism pending |
| W2 Running jobs | Required, MCP only | N/A: MCP-only scope, no GUI | `jobs.submit` → `env.advance_time` (running, completed) → `allocation.changed` holds → `jobs.release`; hold, cancel | T06 to T10, T20; MCP report | N/A: no dependency | N/A: no Task history supplied | Passed |
| W2 Review request: scheduled submissions on the same checks | Required at approval | N/A: MCP-only scope, no GUI | The same arguments through `jobs.submit` and `job.script_submitted`, for a pass and each failing step | T22; MCP (`ev-bl-212`) | N/A: no dependency | N/A | Passed |
| W2 Review request: a held submission consumes no allocation until release reruns the full checks | Required at approval | N/A: MCP-only scope, no GUI | `jobs.submit` with `hold: true` → usage unchanged → `jobs.release` fails on the share and the allocation, then passes | T22b, T06; MCP | N/A: no dependency | N/A | Passed |
| W3 Evaluation protocols and sign-off | Required, MCP only | N/A: MCP-only scope, no GUI | `protocol.proposed` → `protocols.respond` decline → `protocols.propose` → `protocol.answered` → signed and superseded; expiry by the clock | T11 to T13, T20; MCP report | N/A: no dependency | N/A: no Task history supplied | Passed |
| W4 Reporting results | Required, MCP only | N/A: MCP-only scope, no GUI | `tables.create` → `tables.update` → `tables.freeze` → `result.invalidated` → `tables.revise` → rerun → freeze | T14 to T17, T20; MCP report | N/A: no dependency | N/A: no Task history supplied | Passed |
| Mail notifications | Delivered optional, send-only | N/A: MCP-only scope, no GUI | Event or write commits a notification → Infra sender, after its release time → `router.publish` → Mail inbox | T19 to T19f; `tests/mail.integration.cjs` | Real Router and Mail 1.3.0: inbox records and committed receipts read with the Mail Agent, a `job.ended` notice sent only after the end of the job, a removed notice never sent, identical retry, no grant, receiver refusal, reset and new seed; 57 of 57 ([report](benchline/mail-integration-node22.json)) | N/A: no Task history supplied | Passed |
| Environment dataset, 2025-01-01 to 2026-12-31 | Required by the plan, all synthetic | N/A: MCP-only scope, no GUI | `env.load_seed` of `data/evaluation/seed.json` → MCP reads | T23 to T23f; `tests/evaluation.integration.cjs` | Files and SHA-256 in `contribution/dataset.json` and `manifest.json`; 17 of 17 ([report](benchline/evaluation-integration-node22.json)) | [`coverage.md`](../../apps/benchline/data/evaluation/coverage.md): 382 distinct dates, every month has records, 0 real and 0 mixed rows | Passed. No real anchor, because Benchline models no real cluster (plan open question 5) |

## Reproduction and evidence

| Evidence | Result | What was actually exercised |
| --- | --- | --- |
| App-only business | 56 tests: 53 passed and 3 skipped in a copy of the package alone. In the checkout with `PALE_RUNTIME_ROOT` set, 56 of 56 passed | The real App hooks, the input, output, seed and event schemas, each of the 23 App errors and the order of the error table, every rejected event and seed of the plan's lists, and the structure checks and seed rules that the package adds. Also usage and charging, the submission check and its order, a free job on the rate-0 partition while the project is overdrawn, held and script submissions (the two review requests and Task #257), the clock, holds by an allocation cut, protocols with sign-off and expiry, results and tables with their manifests, notification text and release times, the stored wire message, activity rows, and the Mail sender with a fake router. Six `PKG` tests check the package itself, and six `T23` tests check the delivery dataset. The 3 skipped tests, `T19c`, `T20` and `T23f`, run the three real-runtime scripts (next rows) |
| Isolated App package | Passed | The public verifier copies the package to a temporary folder with no sibling runtime. It then runs its tests and its event example there, with a 60 second limit. The business tests take about 19 seconds on Node 18 there |
| Real public MCP, common checks | 49 checks passed | Discovery, the published input and output of the read tools, Agent denial of the `env.*` operations, a caller that tries to override its run or role, a read, history loading, event application and retry, reset, a separate run, a restarted process and an unchanged package |
| Real public MCP, Benchline workflows | 128 checks passed | `tests/mcp.integration.cjs`: the task seed with its own `virtual_now`, the 29 Agent tools (15 read and 14 write), the plan's W1 to W4 paths with its numbers, clock moves with `env.advance_time` and no App event (a job reads running and then completed), the plan's example events, a held submission and its release, the script job of `ev-bl-212`, the holds of `ev-bl-201` with the plan's example message, refused calls and refused events that change nothing, replays, `idempotency_conflict`, `stale_version`, `permission_denied`, audit rows with `id`, `start` and `end`, activity rows with their effect flags and join scope, reset to the loaded seed and time, and a second run that is not affected |
| Benchline to Mail | 57 checks passed | `tests/mail.integration.cjs`: the real Router process and the real Mail package. An allocation notice, a `job.ended` notice that the sender publishes only once the clock has reached the end of the job, and a protocol notice arrive as inbox records with committed receipts, read through the Mail Agent. A notice removed by `jobs.cancel` is never sent. Seed history not sent, `email_notices` off, an identical retry, a reset of Benchline only and a new seed in the same run (each new notice once as `<id>.e<epoch>`, a reused plain ID refused), a second sender object, no grant, no mailbox, a refusal by Mail, a reset of Mail, a receiver that does not answer, and Benchline without Mail |
| Delivery dataset, load and query | 17 checks passed | `tests/evaluation.integration.cjs`: `env.load_seed` loads `data/evaluation/seed.json` (2,298 records) at `2026-12-31T23:00:00-05:00` with its synthetic provenance bundle. The Agent's read tools return the counts of `coverage.json`: the jobs of each month, the submission days, every protocol version (in all six states), table version and config, a frozen manifest with its CSV, and the released notifications. A seed as of 1 June 2026 is in the period Q2 2026 and shows no record after that time |
| Delivery dataset, generation, story rules and coverage | Passed | `dev/generate-dataset.cjs --check` (byte-identical, a load request of 1,573,742 bytes), `dev/coverage.cjs --check` (382 distinct dates from 1,707 counted rows, 18 excluded with reasons, 0 empty months), `dev/check-fixture.cjs --evaluation` (the delivered seed and the 24 month-start seeds), the selector at the clock gives the delivered seed byte for byte, and `T23d` plants one contradiction for each of the 16 story rules and each is caught |
| Node 18.20.8 | All rows above, and 22/22 full-suite stages passed | The existing Mail, Calendar, Core and Messaging regression suite with this package present |
| Node 22.23.5 | All rows above, and 22/22 full-suite stages passed | The same on the second supported runtime family |
| Independent base validator | All eight discovered packages passed | Unmodified main at `a4bce023953061483c41de5a287ba5e43f4a5648`, on Node 22.23.5, validated the candidate tree: this package (49 checks, the same package hash) and the seven existing ones |
| Development checks | Passed on both Node versions | `dev/build.cjs --check`, `dev/build-fixture.cjs --check`, `dev/build-task-seed.cjs --check`, `dev/check-fixture.cjs`, `dev/check-plan-examples.cjs` (14 of 14), `examples/run.cjs`, `npm run contracts:check` |
| Human review | Pending | Realism of the allocation, partition and policy values, the run times and metrics of the synthetic jobs and the notification wording, and provenance; automated green results do not grant acceptance |

The host was macOS (Darwin 27.2.0, arm64) with Node.js release builds. All test data was synthetic. Tests used temporary folders and local stdio MCP, without private services, user credentials, network services or model APIs. The App validation workflow of this repository has not run on this pull request yet: a run from a fork waits for a maintainer.

Run from the root of the candidate checkout:

```sh
node --version
npm run contracts:check
node apps/benchline/dev/build.cjs --check
node apps/benchline/dev/build-fixture.cjs --check
node apps/benchline/dev/build-task-seed.cjs --check
node apps/benchline/dev/check-fixture.cjs
node apps/benchline/dev/check-plan-examples.cjs
node apps/benchline/examples/run.cjs
node --test apps/benchline/tests/business.test.cjs
PALE_RUNTIME_ROOT=$PWD/runtime node --test apps/benchline/tests/business.test.cjs
npm run app:verify -- --app apps/benchline --output .artifacts/benchline.json
node apps/benchline/tests/mcp.integration.cjs --runtime runtime --report .artifacts/benchline-mcp.json
node apps/benchline/tests/mail.integration.cjs --runtime runtime --report .artifacts/benchline-mail.json
node apps/benchline/dev/generate-dataset.cjs --check
node apps/benchline/dev/coverage.cjs --check
node apps/benchline/dev/check-fixture.cjs --evaluation
node apps/benchline/dev/select-evaluation-seed.cjs --as-of 2026-12-31T23:00:00-05:00 --out .artifacts/benchline-at-clock.json
node apps/benchline/tests/evaluation.integration.cjs --runtime runtime --report .artifacts/benchline-evaluation.json
npm test
```

Run the package alone from a copy that holds only `apps/benchline/`:

```sh
node --test tests/business.test.cjs
node examples/run.cjs
```

Run the independent package check from a separate checkout of the pinned base:

```sh
node runtime/ci/verify-submissions.cjs /path/to/candidate /path/to/reports
```

The base checker was not changed or supplied from the candidate. With no base commit as a third argument it validates every package of the candidate tree. This pull request changes no file under `runtime/`, `examples/` or the root, and it does not add the App to `apps.registry.json`. Beside the approved proposal file, it adds only `apps/benchline/`, this report and `docs/validation/benchline/`.

## Workflow evidence

Test IDs are the IDs of the plan's acceptance table. A letter after an ID marks one more test for that ID. "MCP" is `tests/mcp.integration.cjs` and "Mail" is `tests/mail.integration.cjs`. Each control that returns an error is checked before and after: the data, the version and the activity rows do not change. The README has the same mapping with one row for each item of the plan: ["Workflow-to-test mapping"](../../apps/benchline/README.md#workflow-to-test-mapping).

| Preconditions → action | Expected and observed result | Failure/control | Where |
| --- | --- | --- | --- |
| W1. A December allocation of 400 GPU-hours, 212 used and 60 reserved; Nadia's share of 150 with 36 used and 60 reserved → `usage.summary` | 128 remaining for the project, 54 left of the share | A person with no share has `share_hours: null` and no share row; November jobs are history and do not count | T01, MCP |
| W1. `jobs.estimate` for 2 GPUs and 12 hours on `gpu-h` (rate 2.0); the same for 24 hours; 4 GPUs for 24 hours | `allowed: true`, 48 reserved, 80 and 6 left; 96 with the flag `over_share` (soft shares); `allowed: false` with `over_allocation` | With hard shares every failing step is listed; with `hold: true` only the first four steps run | T02, MCP |
| W1. `results.compare` of a v2 result and a v1 result; every read | `comparable: false`, differences `protocol_id` and `eval_split`; each read returns `now` with the -05:00 offset | The business data is byte-identical after every read; no read returns a run plan, a wait or an outcome that is not yet due | T03 to T05, MCP |
| W2. `jobs.submit` at 09:00 for `cfg-mae-b16-v3`, seed 2, 2 GPUs and 12 hours on `gpu-h` under `proto-subj-v2`; `env.advance_time` | `queued` with 48 reserved; `running` at 09:30; `completed` at 19:30 with its result, 40 charged and 8 returned | A 30-hour limit `time_limit_too_long`; seed 7 `protocol_mismatch`; a fourth job `too_many_active`; a 15-hour run under a 12-hour limit `timed_out` with 48 charged and no result | T06 to T08, MCP |
| W2. `allocation.changed` to 120 while 212 are used and the two queued jobs reserve 60 | Both read `held` with the reason `allocation` and the flag `unfunded`; 0 remaining and 92 overdrawn | `jobs.release` returns `over_allocation`; a later increase releases nothing; a lower share holds nothing | T09, MCP |
| W2. After the cut to 120, a job on the rate-0 `cpu` partition | Allowed and queued with 0 reserved, also with hard shares and an overdrawn share; a later cut never holds it | A paid job still fails with `over_allocation` | T09b |
| W2. A labmate's job is queued with 20 reserved; cuts to 262 and to 261.99 | At 262 only the last submitted job of the researcher is held (used plus reserved equals the allocation, so the cut stops); at 261.99 both are held | The labmate's job stays queued with 20 reserved | T09e |
| W2. `jobs.hold`, `jobs.release`, `jobs.cancel` | A held job gives its hours back; a running job that is cancelled is charged for the hours it ran and leaves no result | A labmate's job `not_yours`; the wrong state `invalid_state` | T10 |
| W2 review. The same arguments through `jobs.submit` and `job.script_submitted` | The same job, the same usage, or no job and a `job.submission_rejected` notice with the same error | Each step: `time_limit_too_long`, `protocol_mismatch`, `too_many_active`, `over_allocation`, `over_share` | T22, MCP |
| W2 review. `jobs.submit` with `hold: true` | Held, `submitted_held`, 0 reserved, the usage summary byte-identical | `jobs.release` reruns all six steps: `over_share`, then `over_allocation` after a cut, then a pass that reserves 96 | T22b, T06, MCP |
| W2. Task #257 with a hard share | Three Birch ablations queued and one held leave room for the 22:00 Atlas script job; the held one is released the next morning | All four queued: the script's job fails with `over_share`, although `jobs.estimate` allows four | T22c |
| W3. A labmate's `proto-subj-v3` with a trial-level split → `protocols.respond` decline → `protocols.propose` with seeds 0 to 4 → the lab head signs | `proposed` with a request to sign; `declined` and v2 still signed; `proto-subj-v4` with Nadia's signature and `respond_by` five days later; `signed` and v2 `superseded` | `no_change`, `already_proposed`, `already_answered`, `not_a_signer`, `not_yours`; a version reads `expired` at its `respond_by` and a later answer is `invalid_event` | T11 to T13, MCP |
| W4. `tables.create` "Main results" under v2 → two rows of three results → `tables.freeze` | `frozen`; the manifest row of 0.712, 0.705 and 0.719 reads count 3, mean 0.7120 and sd 0.0070, and the CSV has the same row | `mixed_protocols`, `duplicate_result`, `not_completed`; the freeze checks in the plan's order | T15, T16, MCP |
| W4. `result.invalidated` on a cited result → `tables.revise` → rerun → freeze | The frozen manifest is unchanged and reads `cites_invalidated`; version 2 `frozen` and version 1 `superseded` | `tables.revise` of a table with a draft or of a superseded version `invalid_state`; `results.update` without a reason `reason_required` | T14, T17, MCP |
| All. Each event of the plan's list of rejected events, and each seed of the plan's `validateSeed` list | `invalid_event` or `invalid_seed`, and the state is unchanged | Also each structure check and seed rule that the package adds. A fixed walk of 300 steps commits each valid step | T18, T18b, T21, T21b, MCP |
| All. Notifications and records | One notification for each occurrence of the seven types; one allocation notice for a change of the allocation or of the researcher's share, none for a labmate's share only (T19g); none for the researcher's own writes (except `job.ended`) or a change of time; `job.ended` listed only from the end of the job and removed by a cancellation, hold or interruption; one activity row for each write, event and effect | The ten example events apply to the task seed in time order | T19, T19b, T20c, MCP |
| All. Core contracts through real MCP | A repeated `request_id` returns the stored receipt and submits no second job. Reset restores the loaded seed and time | `idempotency_conflict`, `stale_version`, `permission_denied` for each `env.*` operation; each of the 23 App errors and the first one when two fit | T20, T20b, T20d, MCP |
| Mail. A notification with a stored wire message, and Infra runs the sender | An inbox record whose title and text equal the notification, and a committed receipt, only once the clock has reached its release time | Seed history never sent; a removed notice never sent; identical retry `duplicate` and one record; no grant: rejected before dispatch and no Mail record; a reset or a new seed: `<id>.e<epoch>`; Mail refuses or does not answer: the sender stops and Benchline keeps its commit; without Mail, writes and events commit | T19c (Mail), T19d to T19f |
| Data. The delivery dataset of 2025 to 2026 | The month-start seeds pass the seed checks, the consistency script and the story rules; the files reproduce; only acts count; a seed loads and is read through MCP | A planted contradiction for each story rule is caught; the selector refuses a later timestamp and a time outside the window | T23 to T23f |

## Requests of the design review

The design review approved the plan with two requests for the acceptance matrix (comment on PR #180 of 2026-11-26). The proposal file is not changed.

| What the review asked | What the package does | Evidence |
| --- | --- | --- |
| "keep scheduled submissions on the same quota/share checks as manual submissions" | `job.script_submitted` calls the same check as `jobs.submit` (`views.check` in `src/views.cjs`). A pass adds the same job with `submitted_by: script`; a failing step adds no job and writes one `job.submission_rejected` notice with the arguments and the error | T22 compares the two paths on two copies of one state for a pass, a held pass and each of the five failing steps; MCP applies `ev-bl-212` |
| "show that a held submission consumes no allocation until release reruns the full checks" | A held job reserves nothing and is never charged. `jobs.release` runs all six steps, and the job does not count against its own job count | T22b: the usage summary is byte-identical after a held submission and a day later; the release fails with `over_share` and `over_allocation` and passes once the hours are back. MCP shows an unchanged summary and a release that fails with `over_allocation` |

## Plan and implementation

The App follows the approved plan. The delivery dataset differs from the plan's approximate counts, as the next section says. The README section ["Plan and implementation"](../../apps/benchline/README.md#plan-and-implementation) lists the answers to the review, the points where the package adds a rule or reads a sentence of the plan in one way (an unknown reference in a script submission, the allocation period as loaded history, the reason `agent` of a hold, a removed notification that stays stored, and the share sentence of the allocation notice), the seed rules that it adds (`T21`; `T21b` shows that they never make a valid write or event fail), and the 10 choices that the plan left open. Each point names its test. The fixture has the counts that the plan promises, and a `PKG` test asserts them.

## Data and licence

The fixtures are authored and synthetic. `dev/build-fixture.cjs` replays a scripted history from 2 November to 9 December 2026 through the App's own hooks, so the App accepted every step. `fixtures/minimal.json` holds 115 records in 166,648 bytes: 12 configs, 7 protocol versions, 30 run plans, 60 jobs, 4 table versions and 2 allocation changes, with the 14 newest notifications. `contribution/dataset.json` records the provenance and the public pages that were read for the shape of the workflows (Slurm's job submission, job states and resource limits, and MLflow Tracking). No text, data, logo or brand was copied. The package has no media (0 assets). Code and fixtures are under the repository's MIT License.

### Differences from the plan

The plan's data section gives approximate counts. The delivered dataset differs in these, for the reason in the last column. The reviewer can accept or change this.

| What | The plan says | The dataset has | Why |
| --- | --- | --- | --- |
| Configs | about 40 configs in 8 families | 387 configs in 8 families: 42 base configs and 345 steps of hyperparameter sweeps | A config never changes, and a version covers one dataset release, split and seed list, so the 42 base configs allow at most about 200 distinct runs. About 1,800 jobs on about 40 configs would repeat each run about nine times, which is duplicated filler. |
| Jobs | about 1,800, about 500 of the researcher | 1,534, 371 of the researcher | Every job is a distinct run or a rerun with a reason. No job was added to reach the planned count. |
| Table versions | about 25 | 36 | Tables for 7 deadlines, a progress table every other month when there are complete rows, and the corrections. |
| Notifications and activity rows | (not stated) | only those of the current period (Q4 2026) | The whole history would pass the request size of `env.load_seed`. Every record keeps its own history. |

### Delivery dataset, 2025 to 2026

The plan promises a delivery dataset of one fictional lab from 2025-01-01 to 2026-12-31 (section 4). It is in `apps/benchline/data/evaluation/` ([README](../../apps/benchline/data/evaluation/README.md), [coverage report](../../apps/benchline/data/evaluation/coverage.md)).

- **Synthetic, all of it.** Benchline models no real cluster or website (open question 5 of the plan), so nothing is collected and there is no real anchor. `data/evaluation/dataset.json` names one source, `evaluation-generator` of kind `synthetic`, and `contribution/dataset.json` declares the same source with the size and SHA-256 of each file. Real: 0, mixed: 0.
- **How it is made.** `dev/generate-dataset.cjs` builds stories from the templates in `dev/evaluation-scenarios.cjs` with a seeded PRNG (mulberry32, seed 20250101), and replays their steps in time order through the App's own hooks. Every record of the window belongs to exactly one story (the 18 setup records from before the window belong to none), and `manifest.json` lists each story with its template and record IDs. A rerun is byte-identical on Node 18 and 22.
- **What it holds.** 8 quarterly periods with 12 allocation changes, 387 configs in 8 families, 6 protocol lines with 22 versions in all six states, 1,534 jobs (371 of the researcher, 45 of them from her script) on working days, with quiet weeks around holidays and busy weeks before paper deadlines, their results, 36 table versions, 307 run plans and the notifications of the current period. That is 2,298 App records; the periods are setup, not records.
- **No repeated run under the same evaluation.** A config never changes, so a run with a usable result under a protocol is not done again under the same dataset release, split and metrics, under any version of a line. When a new version only adds seeds, campaigns run only the new seeds. A seed runs again only after it failed or timed out (117 rerun stories, each with its reason in `manifest.json`), was interrupted or cancelled, or was invalidated. A script sweep has no protocol, so its results cannot enter a table: when Nadia wants such a config in a table, she runs its seeds again under the signed version (32 of the 45 script results are run again this way, and 29 of these reruns are cited in tables). The story rule `duplicates` and `T23` check the first rule on the whole seed.
- **The allocation runs short once.** Before the Autumn conference 2026 the lab head cuts the allocation below what is already used: the cut holds three queued jobs of the researcher, a later submission is held and cancelled, and two held jobs are released when the department returns hours (W2 of the plan).
- **Every step commits or is skipped on purpose.** The generator stops on any step that the App refuses. A step whose act does not happen at that time is skipped with its reason and counted in `manifest.json` (`skipped_counts`, and the list `skipped`).
- **Story rules.** `dev/check-evaluation.cjs` holds 16 committed rules (story, metrics, versions, hours, members, reruns, tables, rationale, allocation, failures, notifications, names, deadlines, answers, withdrawals, duplicates). The rationale of a version names what it changes, a decline note fits the kind of change, and the version withdrawn for a typo carries the typo. They pass on the delivered seed and on the 24 month-start seeds, and `T23d` shows that a planted contradiction for each is caught.
- **Clock.** The seed is read at `2026-12-31T23:00:00-05:00`. `dev/select-evaluation-seed.cjs --as-of TIME` writes a seed with only the history before an earlier time, in the period that contains it, each record in its state then, and refuses any later timestamp except a planned time.
- **Counting only acts that happened.** The seven record kinds of the plan count, each on the date of an act: the submission of a job, the proposal of a version, a sign-off, the creation of a table version, an allocation change, a result disposition, and the release of a notification that was released by the clock and not removed. A `respond_by`, the planned run of a job that has not ended, a notice released after the clock and a notice that was removed before its release are listed apart and never counted. A job that was held or cancelled before it ran counts once, on its submission. 1,707 counted rows fall on 382 distinct dates, and every month of the window has records.
- **Excluded rows, with reasons.** The first protocol versions and their sign-offs of November 2024, which are the setup of the lab before the window.

## What is not claimed

- No acceptance, approval or merge is claimed.
- Realism is not claimed. The allocation, partition and policy values, the run times, the metrics and the notification wording are synthetic, and they need human review. So does the provenance of the fixtures and the dataset.
- The first version is MCP only, as approved. There is no GUI and no CUA interface, so there is no GUI evidence. There is no console for the lab head: what labmates, the lab head and the cluster do arrives as events.
- The cluster is not simulated. Benchline runs no code: what a job does comes from task-supplied run plans.
- These are outside the first version, as the plan says: files, logs, checkpoints and artifacts; interactive sessions; job arrays, dependencies and sweeps; priorities, fair-share scores and a node inventory; plots and comments on results; corrected comparisons across protocol versions; several projects or accounts in one instance; the lab head's side of the App; and push, SMS and chat channels.
- The checks call no model API. No agent trial and no benchmark task is part of this evidence.
- The Mail script shows a receiver that refuses and a receiver that does not answer. It does not reproduce a commit by Mail whose acknowledgement is lost.
- All checks use local stdio MCP. Remote deployment, OAuth, HTTPS and production credentials are outside this evidence.
- The official CI result is not part of this report. A maintainer run of the App validation workflow on the submitted commit remains to be done.

Recommendation: ready for code and implementation review, with automated local evidence attached. Merge and acceptance remain maintainer decisions.
