# Brindle Card credit card account validation report

Checked 26 November 2026 (America/New_York). Scope: the package `apps/brindle` version **1.0.0**, public runtime **1.6.0**, Core API **1.2.0**, and Mail **1.3.0** as the optional receiver. The approved plan is [`proposals/environment/brindle-card.md`](../../proposals/environment/brindle-card.md), approved at commit `4ec2754ae2cec70de08fbbaf2df8bf965f7aca11`. That file is unchanged: its blob is `a5b41135504495e217a2d6016e39bdd19fed2e7f` at the approved commit and in the candidate tree. The package SHA-256 is `53cb6bcb0fcdf494cb5812ef8818fd42b6871863e2adf1ddd4926f24a8857900`. It is the same in both Node runs and in the base-runtime report. The counts of every run and the raw reports are in [`brindle/index.json`](brindle/index.json) and the files beside it.

**Automated outcome: passed.** This document records implementation evidence for review. Human workflow acceptance and provenance review remain pending; no approval is claimed.

## Delivery evidence index

This index follows the "Delivery evidence index" of [`docs/submission-evidence.md`](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/6933c430942c64f94874083815829e4a4b20920a/docs/submission-evidence.md). Versions for every row: Brindle 1.0.0, runtime 1.6.0, Core API 1.2.0, Mail 1.3.0, Node 18.20.8 and 22.23.5.

| Workflow / requirement | Scope and pinned versions | Reference screenshots | Implemented sequence / actions | Business and MCP tests | Dependency result / files / receipts | Date report / source mapping | Verdict and remaining gap |
| --- | --- | --- | --- | --- | --- | --- | --- |
| W1 The account, the bill and activity | Required, MCP only | N/A: MCP-only scope, no GUI | Task seed → events of the plan → `account.get`, `transactions.get`, `account.close_preview` (see "Workflow evidence") | T01 to T04, T20; [MCP report](brindle/mcp-integration-node22.json) | N/A: no dependency | N/A: no Task history supplied | Passed. Human review of realism pending |
| W2 Payments, autopay and preferences | Required, MCP only | N/A: MCP-only scope, no GUI | `payments.schedule` → `env.advance_time` → `payment.returned`; autopay with `statement.issued` | T05 to T09, T20; MCP report | N/A: no dependency | N/A: no Task history supplied | Passed |
| W3 Refunds, disputes and temporary credits | Required, MCP only | N/A: MCP-only scope, no GUI | Refund → `disputes.open` → `dispute.updated` credit → merchant refund → `closed_matched` with reversal | T10 to T13, T20; MCP report | N/A: no dependency | N/A: no Task history supplied | Passed |
| W4 The annual fee, offers, points and closing | Required, MCP only | N/A: MCP-only scope, no GUI | `offer.issued` → `offers.accept` → credit event; `rewards.redeem`, `rewards.transfer`; `account.close` | T14 to T18b, T20; MCP report | N/A: no dependency | N/A: no Task history supplied | Passed |
| Mail notifications | Delivered optional, send-only | N/A: MCP-only scope, no GUI | Event commits a notification → Infra sender → `router.publish` → Mail inbox | T19g to T19m; `tests/mail.integration.cjs` | Real Router and Mail 1.3.0: inbox record and committed receipt read with the Mail Agent, identical retry, no grant, receiver refusal, reset and new seed; 54 of 54 ([report](brindle/mail-integration-node22.json)) | N/A: no Task history supplied | Passed |
| Environment dataset, 2025-01-01 to 2026-12-31 | Required by the plan, all synthetic | N/A: MCP-only scope, no GUI | `env.load_seed` of `data/evaluation/seed.json` → MCP reads | T21 to T21f; `tests/evaluation.integration.cjs` | Files and SHA-256 in `contribution/dataset.json` and `manifest.json`; 25 of 25 ([report](brindle/evaluation-integration-node22.json)) | [`coverage.md`](../../apps/brindle/data/evaluation/coverage.md): 666 distinct dates, every month has records, 0 real and 0 mixed rows | Passed. No real anchor, because Brindle models no real issuer (plan open question 5) |

## Reproduction and evidence

| Evidence | Result | What was actually exercised |
| --- | --- | --- |
| App-only business | 56 tests: 53 passed and 3 skipped in a copy of the package alone. In the checkout with `PALE_RUNTIME_ROOT` set, 56 of 56 passed | The real App hooks, the input, output, seed and event schemas, each of the 14 App errors and the order of the error table, every rejected event and seed of the plan's lists, and the structure checks and seed rules that the package adds. Also the balance, the bill and `paid_toward`, payments and autopay (with a manual payment returned after the autopay day), the recovery summary and its flags, offers and spending progress, the product change and the fee refund, points, closing, notification text, the stored wire message, activity rows, and the Mail sender with a fake router. Five `PKG` tests check the package itself, and six `T21` tests check the delivery dataset. The 3 skipped tests, `T19i`, `T20` and `T21e`, run the three real-runtime scripts (next rows) |
| Isolated App package | Passed | The public verifier copies the package to a temporary folder with no sibling runtime. It then runs its tests and its event example there, with a 60 second limit. The business tests take about 14 seconds on Node 18 there |
| Real public MCP, common checks | 48 checks passed | Discovery, the published input and output of the read tools, Agent denial of the `env.*` operations, a caller that tries to override its run or role, a read, history loading, event application and retry, reset, a separate run, a restarted process and an unchanged package |
| Real public MCP, Brindle workflows | 118 checks passed | `tests/mcp.integration.cjs`: the task seed with its own `virtual_now`, the 25 Agent tools (14 read and 11 write), the plan's W1 to W4 paths with its numbers, clock moves with `env.advance_time` and no App event (a payment reads `posted`, an offer `expired`, a dispute window closes), refused calls and refused events that change nothing, replays, `idempotency_conflict`, `stale_version`, `permission_denied`, audit rows with `id`, `start` and `end`, activity rows with their effect flags and join scope, two denied attempts as two deny rows, reset to the loaded seed and time, and a second run that is not affected |
| Brindle to Mail | 54 checks passed | `tests/mail.integration.cjs`: the real Router process and the real Mail package. `ntf-0058`, the plan's example message, arrives as an inbox record with a committed receipt, read through the Mail Agent. Seed history not sent, an identical retry, a reset of Brindle only and a new seed in the same run (each new notice once as `<id>.e<epoch>`, a reused plain ID refused), a second sender object, no grant, a refusal by Mail, a receiver that does not answer, and Brindle without Mail |
| Delivery dataset, load and query | 25 checks passed | `tests/evaluation.integration.cjs`: `env.load_seed` loads `data/evaluation/seed.json` (1,500 records) at `2026-12-31T23:00:00-05:00` with its synthetic provenance bundle. The Agent's read tools return the counts of `coverage.json`: transactions for each month, the 24 window statements, the payment postings, returns and requests (and the cancelled, skipped and scheduled payments that the report lists apart), disputes, offers, points and notifications, and the state at the clock (fee refund open, three retention offers available, one open dispute). A seed as of 1 June 2026 shows no record after that time |
| Delivery dataset, generation, story rules and coverage | Passed | `dev/generate-dataset.cjs --check` (byte-identical, 1,813 steps from 1,220 stories, replay 3.6 s on Node 18, a load request of 1.33 MB), `dev/coverage.cjs --check` (666 distinct dates from 1,579 counted rows, 54 excluded with reasons, 0 empty months; `T21f` checks that a cancelled or skipped payment adds no posting), `dev/check-fixture.cjs --evaluation` (the delivered seed and the 24 month-start seeds), the selector at the clock gives the delivered seed byte for byte, and `T21d` plants one contradiction for each of the 14 story rules and each is caught |
| Node 18.20.8 | All rows above, and 22/22 full-suite stages passed | The existing Mail, Calendar, Core and Messaging regression suite with this package present |
| Node 22.23.5 | All rows above, and 22/22 full-suite stages passed | The same on the second supported runtime family |
| Independent base validator | All eight discovered packages passed | Unmodified main at `a4bce023953061483c41de5a287ba5e43f4a5648`, on Node 22.23.5, validated the candidate tree: this package (48 checks, the same package hash) and the seven existing ones |
| Development checks | Passed on both Node versions | `dev/build.cjs --check`, `dev/build-fixture.cjs --check`, `dev/build-task-seed.cjs --check`, `dev/check-fixture.cjs`, `dev/check-plan-examples.cjs` (11 of 11), `examples/run.cjs`, `npm run contracts:check` |
| Human review | Pending | Realism of the issuer rules, the amounts, the offer terms and the notification wording, and provenance; automated green results do not grant acceptance |

The host was macOS (Darwin 27.2.0, arm64) with Node.js release builds. All test data was synthetic. Tests used temporary folders and local stdio MCP, without private services, user credentials, network services or model APIs. The App validation workflow of this repository has not run on this pull request yet: a run from a fork waits for a maintainer.

Run from the root of the candidate checkout:

```sh
node --version
npm run contracts:check
node apps/brindle/dev/build.cjs --check
node apps/brindle/dev/build-fixture.cjs --check
node apps/brindle/dev/build-task-seed.cjs --check
node apps/brindle/dev/check-fixture.cjs
node apps/brindle/dev/check-plan-examples.cjs
node apps/brindle/examples/run.cjs
node --test apps/brindle/tests/business.test.cjs
PALE_RUNTIME_ROOT=$PWD/runtime node --test apps/brindle/tests/business.test.cjs
npm run app:verify -- --app apps/brindle --output .artifacts/brindle.json
node apps/brindle/tests/mcp.integration.cjs --runtime runtime --report .artifacts/brindle-mcp.json
node apps/brindle/tests/mail.integration.cjs --runtime runtime --report .artifacts/brindle-mail.json
node apps/brindle/dev/generate-dataset.cjs --check
node apps/brindle/dev/coverage.cjs --check
node apps/brindle/dev/check-fixture.cjs --evaluation
node apps/brindle/dev/select-evaluation-seed.cjs --as-of 2026-12-31T23:00:00-05:00 --out .artifacts/brindle-at-clock.json
node apps/brindle/tests/evaluation.integration.cjs --runtime runtime --report .artifacts/brindle-evaluation.json
npm test
```

Run the package alone from a copy that holds only `apps/brindle/`:

```sh
node --test tests/business.test.cjs
node examples/run.cjs
```

Run the independent package check from a separate checkout of the pinned base:

```sh
node runtime/ci/verify-submissions.cjs /path/to/candidate /path/to/reports
```

The base checker was not changed or supplied from the candidate. With no base commit as a third argument it validates every package of the candidate tree. This pull request changes no file under `runtime/`, `examples/` or the root, and it does not add the App to `apps.registry.json`. Beside the approved proposal file, it adds only `apps/brindle/`, this report and `docs/validation/brindle/`.

## Workflow evidence

Test IDs are the IDs of the plan's acceptance table. A letter after an ID marks one more test for that ID. "MCP" is `tests/mcp.integration.cjs` and "Mail" is `tests/mail.integration.cjs`. Each control that returns an error is checked before and after: the data, the version and the activity rows do not change. The README has the same mapping with one row for each item of the plan: ["Workflow-to-test mapping"](../../apps/brindle/README.md#workflow-to-test-mapping).

| Preconditions → action | Expected and observed result | Failure/control | Where |
| --- | --- | --- | --- |
| W1. Credit limit 8,000.00, a statement of 1,240.00 (minimum 35.00, due 26 December), a purchase of 210.00 since and a hotel hold of 300.00 → `account.get` | Balance 1,450.00, `pending_total` 300.00, `available_credit` 6,250.00, 0 paid toward the statement, and the issuer's four rule values | An unknown transaction returns `not_found`. A window that ends before it starts returns `invalid_window`. The business data is byte-identical after every read | T01 to T03, MCP |
| W1. On 5 December, an annual fee of 550.00 posted on 1 December and 12,000 points → `account.close_preview` | A fee refund of 550.00 until 31 December, 12,000 points lost, the offers that would end, the bonus not arrived, and what stays open | The preview writes nothing | T04, MCP |
| W2. On 10 December `payments.schedule` for the statement balance on 20 December, then `env.advance_time` to 20 December | `scheduled` for 1,240.00, then `posted` with no App event; the balance is 210.00 and the statement is paid in full | Yesterday `invalid_window`; 2,000.00 against 1,450.00 `over_balance`; no statement `no_statement`; paid in full `nothing_due`; cancel on 19 December `cancelled`, on the payment's day `too_late` | T05 to T06b, T08, MCP |
| W2. Autopay on the minimum due, then the next statement (210.00, minimum 35.00, due 26 January), and a manual 100.00 on 10 January | An autopay payment of 35.00 for 26 January, which reads `skipped` on 26 January | Cancelling an autopay payment keeps the setting and schedules nothing new. A manual payment returned after the autopay day restores the debt and does not raise the autopay amount (design review). A same-day payment changes nothing | T06b, T07 to T07c, MCP |
| W2. `payment.returned` on the posted payment; the due time passes with nothing paid; `preferences.update` | The balance is 1,450.00 again and the account reads `payment_returned`; `past_due`; `statement_unpaid` when only the minimum is paid | An unknown time zone returns `invalid_timezone`. With `email_notices` off no email is stored | T08, T08b, T09 |
| W3. Gym 60.00 posted on 2 November, refund 20.00, dispute 40.00 on 13 November, temporary credit 40.00, the merchant's refund of 40.00, then `closed_matched` with a reversal | `refunded_final` 20.00 and `net_charge` 40.00; `open`; `temporary_credit` 40.00 with `net_charge` 40.00; `refunded_final` 60.00, `net_charge` 0 and `double_credited`; `temporary_credit` 0 and no flag | 50.00 `over_net`; the hotel hold `not_disputable`; a second dispute `already_disputed`; 61 days after posting `too_late`; a withdrawal keeps the credit temporary until a reversal posts | T10 to T13, MCP |
| W4. Three offers in one group; accept the 150.00 credit | `enrolled`, the others `unavailable`, and the credit posts later naming the offer | After `accept_by` `too_late`; the second offer `invalid_state`; declining the third leaves the others `available` | T14, MCP |
| W4. A spending offer and a product change | Progress from acceptance to the deadline, less refunds by the deadline; `open`, `met`, `missed`; the account moves at once and the fee refund is recorded once | A later closing records no second refund; a transfer to a partner of the old product returns `not_found` | T15, T16 |
| W4. 12,000 points: redeem 10,000, transfer 2,000; on another run close on 5 December | A credit of 100.00 and 2,000 left, then 0; `closed`, one entry forfeits 12,000 points, the fee refund of 550.00 is recorded | 500 `below_minimum`; 1,500 `invalid_increment`; 13,000 `insufficient_points`; after closing every W4 write and `autopay.set` returns `invalid_state`; a closing on 2 January records no refund | T17 to T18b, MCP |
| All. Each event of the plan's list of rejected events, and each seed of the plan's `validateSeed` list | `invalid_event` or `invalid_seed`, and the state is unchanged | Also each structure check and seed rule that the package adds. A fixed walk of 400 steps commits each valid step | T19 to T19e, MCP |
| All. Notifications and records | One notification for each applied event except purchase postings and drops; none for the account holder's writes or a change of time; one activity row for each write, event and effect | The seven example events apply to the task seed in time order, and `ntf-0058` is the plan's wire message byte for byte | T19f to T19h, T19n, T20c, MCP |
| All. Core contracts through real MCP | A repeated `request_id` returns the stored receipt and schedules no second payment. Reset restores the loaded seed and time | `idempotency_conflict`, `stale_version`, `permission_denied` for each `env.*` operation; each of the 14 App errors and the first one when two fit | T20, T20b, T20d, MCP |
| Mail. A notification is committed while `email_notices` is on, and Infra runs the sender | An inbox record whose title and text equal the notification, and a committed receipt | Seed history never sent; identical retry `duplicate` and one record; no grant: rejected before dispatch and no Mail record; a reset or a new seed: `<id>.e<epoch>`; Mail refuses or does not answer: the sender stops and Brindle keeps its commit; without Mail, writes and events commit | T19g, T19i (Mail), T19j to T19m |
| Data. The delivery dataset of 2025 to 2026 | The month-start seeds pass the seed checks, the consistency script and the story rules; the files reproduce; a seed loads and is read through MCP | A planted contradiction for each story rule is caught; the selector refuses a later timestamp and a time outside the window; a cancelled or skipped payment adds no posting to the coverage count | T21 to T21f |

## Design review suggestions

The design review of the plan (PR #182, at the approved commit) approved it with three suggestions, which do not affect approval. The proposal file is not changed.

| What the review asked | What the package does | Evidence |
| --- | --- | --- |
| A source-lifecycle identity for publications after a reset or a new seed | Infra keeps one sender for the run. In the epoch it started in, the message `id` and `request_id` are the notification ID, as the plan says. In a later epoch both are `<notification id>.e<epoch>`, and the seed exclusions are read from each snapshot | Mail: after a reset of Brindle only and after a new seed in the same run, Mail keeps its old messages and gets each new notice once; a reused plain ID is refused; the seed history is not sent. T19j to T19m |
| Explicit evidence joins | The README section "Evaluator records" gives the join scope (run, App, account, epoch, then request, event and version), the difference between an action and an effect, the export before reset and before a new seed, and the counting of denied attempts | MCP checks the scope fields next to the activity rows, the effect flags and two deny rows for two denied attempts. T20c |
| Autopay after a late return | A return after the autopay day restores the debt and does not change the posted amount or state of the autopay payment | T07b, for a reduced and a skipped autopay payment |

## Plan and implementation

The package follows the approved plan. The README section ["Plan and implementation"](../../apps/brindle/README.md#plan-and-implementation) lists the structure checks and seed rules that the package adds (`T19b`, `T19d`; `T19e` shows that they never make a valid write or event fail), the points where it reads a sentence of the plan in one way (for example `paid_toward` of an older statement, the moment a payment of today posts, and a pending refund notice), and the 15 choices that the plan left open. Each point names its test. One rule has no test, and the README names its code instead: a redemption worth less than one cent (`rewards.redeem` in `src/operations.cjs`), which the issuer rules of the seeds cannot reach. The fixture has the counts that the plan promises, and `dev/check-fixture.cjs` asserts them.

## Data and licence

The fixtures are authored and synthetic. `dev/build-fixture.cjs` replays a scripted year through the App's own hooks in 311 steps, so the App accepted every step. `fixtures/minimal.json` holds 251 records in 275,020 bytes, under the 1 MB of the plan: 13 statements, 180 transactions, 16 payments, 5 disputes, 7 offers and 30 points entries, with 24 notifications. `contribution/dataset.json` records the provenance and the two public pages that were read for the shape of the workflows (the credit card pages of the Consumer Financial Protection Bureau and Regulation Z, section 1026.13). No text, data, form, logo or brand was copied. The package has no media (0 assets). Code and fixtures are under the repository's MIT License.

### Delivery dataset, 2025 to 2026

The plan promises a delivery dataset of one cardholder from 2025-01-01 to 2026-12-31 (section 4). It is in `apps/brindle/data/evaluation/` ([README](../../apps/brindle/data/evaluation/README.md), [coverage report](../../apps/brindle/data/evaluation/coverage.md)).

- **Synthetic, all of it.** Brindle models no real issuer or website (open question 5 of the plan), so nothing is collected and there is no real anchor. `data/evaluation/dataset.json` names one source, `evaluation-generator` of kind `synthetic`, and `contribution/dataset.json` declares the same source with the size and SHA-256 of each file. Real: 0, mixed: 0.
- **How it is made.** `dev/generate-dataset.cjs` builds 1,220 stories from the templates in `dev/evaluation-scenarios.cjs` with a seeded PRNG (mulberry32, seed 20241202), and replays their 1,813 steps in time order through the App's own hooks. Every record belongs to exactly one story, and `manifest.json` lists each story with its template and record IDs. A rerun is byte-identical on Node 18 and 22.
- **Story rules.** `dev/check-evaluation.cjs` holds 14 committed rules (story, merchant, posting, refund, dispute, offer, fees, statement, interest, payments, points, times, names, notifications). They pass on the delivered seed, and `T21d` shows that a planted contradiction for each is caught.
- **Clock.** The seed is read at `2026-12-31T23:00:00-05:00`. `dev/select-evaluation-seed.cjs --as-of TIME` writes a seed with only the history before an earlier time, each record in its state then, and refuses any later timestamp except the due times of a schedule.
- **Counts.** 1,500 App records: 25 statements (24 in the window and the opening one of December 2024), 1,389 transactions, 31 payments, 8 disputes in all five states, 16 offers and 31 points entries, with 103 notifications and 1,949 activity rows. 1,579 counted rows fall on 666 distinct dates, and every month of the window has records. A payment counts only for its acts, each at its own time: 32 requests (schedule, autopay and cancel), 28 postings of money and 1 return.
- **Excluded rows, with reasons.** The opening history of December 2024 (before the window). Due times and offer deadlines are listed apart and never counted. So are the planned days (`pay_on`) of the three payments that moved no money: the cancelled `pay-0014` (27 October 2025), the skipped autopay `pay-0007` (22 July 2025) and the autopay `pay-0031` still scheduled for 22 January 2027.

## What is not claimed

- No acceptance, approval or merge is claimed.
- Realism is not claimed. The issuer rules, the amounts, the offer terms and the notification wording are synthetic, and they need human review. So does the provenance of the fixtures and the dataset.
- The first version is MCP only, as approved. There is no GUI and no CUA interface, so there is no GUI evidence. There is no console for the issuer or a merchant: what they do arrives as events.
- Money does not move: a payment is a record, and the bank account is a label. Brindle computes no interest and has no card number or credit score. Interest and fees are amounts that the issuer posts.
- These are outside the first version, as the plan says: declines, virtual cards and delegates, a late-fee rule, several cards, authorized users or accounts in one instance, a request for information inside a dispute, pooled points, award search and booking, reopening a closed account, the law of any real place, and push, SMS and chat channels.
- The checks call no model API. No agent trial and no benchmark task is part of this evidence.
- The Mail script shows a receiver that refuses and a receiver that does not answer. It does not reproduce a commit by Mail whose acknowledgement is lost.
- All checks use local stdio MCP. Remote deployment, OAuth, HTTPS and production credentials are outside this evidence.
- The official CI result is not part of this report. A maintainer run of the App validation workflow on the submitted commit remains to be done.

Recommendation: ready for code and implementation review, with automated local evidence attached. Merge and acceptance remain maintainer decisions.
