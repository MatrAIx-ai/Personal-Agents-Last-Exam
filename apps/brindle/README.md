# Brindle Card credit card account App

Self-contained PALE App package, version 1.0.0, Core API 1.2.0. It is a resettable credit card account seen from one cardholder's account at a fictional issuer: the bill, payments and autopay, refunds and disputes with the issuer's temporary credits, the annual fee, offers, points and closing. Data is synthetic: the issuer, merchants, people, banks and loyalty programs are fictional, and no affiliation is claimed. See `tools.json` for exact inputs and outputs and `schemas/seed.schema.json` for records. Business logic lives in `src/`; `plugin.cjs` exports the standard hooks.

The approved plan is [`proposals/environment/brindle-card.md`](../../proposals/environment/brindle-card.md). The validation report is [`docs/validation/brindle-v1.0.0.md`](../../docs/validation/brindle-v1.0.0.md).

## Run locally

Requires Node.js 18 or newer. No package install, private Core, account or remote service is needed (from repository root):

```sh
node --test apps/brindle/tests/business.test.cjs
node apps/brindle/examples/run.cjs
node runtime/cli.cjs verify --app apps/brindle --output .artifacts/brindle.json
node apps/brindle/tests/mcp.integration.cjs --runtime runtime
node apps/brindle/tests/mail.integration.cjs --runtime runtime
node apps/brindle/dev/check-fixture.cjs
node apps/brindle/dev/generate-dataset.cjs --check
node apps/brindle/dev/coverage.cjs --check
node apps/brindle/dev/check-fixture.cjs --evaluation
node apps/brindle/tests/evaluation.integration.cjs --runtime runtime
```

The business tests carry the plan's names `T01` to `T21`. A letter after the number marks one more test for that number, for example `T07b`. Five `PKG` tests check the package itself. That is 56 tests. On Node 18 and 22, 53 pass and 3 are skipped. With `PALE_RUNTIME_ROOT=runtime`, all 56 pass. The real MCP script passes 118 of 118 checks, the Mail script passes 54 of 54, and the evaluation data script passes 25 of 25. The three scripts take `--report FILE` to write their checks as JSON.

With only this App folder, run `node --test tests/business.test.cjs` and `node examples/run.cjs` from inside it. The tests that need the public runtime are skipped there: `T19i` runs `tests/mail.integration.cjs`, `T20` runs `tests/mcp.integration.cjs`, and `T21e` runs `tests/evaluation.integration.cjs`. Set `PALE_RUNTIME_ROOT` to the public `runtime/` directory to run them. `T19i` also needs the public checkout that holds this package as `apps/brindle` and Mail as `examples/apps/mail`, so in a copy outside the checkout it stays skipped. A script that cannot run prints `SKIP` with the reason and exits with code 77, and its test is then reported as skipped, not as passed. `service.cjs` uses that runtime; it does not embed a second server.

## Workflows and operations

The App has 25 Agent operations, named `brindle.<name>`, and four workflows.

| Workflow | Read | Write |
| --- | --- | --- |
| W1 The account, the bill and activity | `account.get`, `account.close_preview`, `transactions.list`, `transactions.get`, `statements.list`, `statements.get`, `payments.list`, `disputes.list`, `disputes.get`, `offers.list`, `offers.get`, `rewards.get`, `notifications.list`, `preferences.get` | none |
| W2 Payments, autopay and preferences | | `payments.schedule`, `payments.cancel`, `autopay.set`, `preferences.update` |
| W3 Refunds, disputes and temporary credits | | `disputes.open`, `disputes.withdraw` |
| W4 The annual fee, offers, points and closing | | `offers.accept`, `offers.decline`, `rewards.redeem`, `rewards.transfer`, `account.close` |

- Every read returns `now`, the current virtual time with the issuer's UTC offset.
- Every write takes Core's `request_id` and `expected_version`, and returns the `id` of the object it wrote. The target object is always `id`. For `payments.schedule`, `autopay.set`, `rewards.redeem`, `rewards.transfer` and `account.close` it is the account, and for `disputes.open` it is the purchase.
- The 14 App errors are checked in this order, and the first one that fits is returned: `not_found`, `invalid_state`, `invalid_timezone`, `invalid_window`, `no_statement`, `nothing_due`, `over_balance`, `not_disputable`, `over_net`, `already_disputed`, `too_late`, `insufficient_points`, `below_minimum`, `invalid_increment`. The App's own argument checks (`invalid_arguments`) come before them.
- The issuer and the merchants act through seven events: `transaction.posted`, `transaction.dropped`, `statement.issued`, `payment.returned`, `dispute.updated`, `offer.issued` and `points.adjusted`. An event that breaks a rule is rejected with `invalid_event`, and the state does not change.

## State and time

`fixtures/minimal.json` is the initial history, read at `2026-12-05T10:00:00-05:00` (`fixtures/clock.json`). It has the counts of the plan: 1 issuer with its four rules, 2 products (Brindle Reserve with an annual fee of 550.00 and 3 transfer partners, and Brindle Everyday with no fee), 1 account, 13 statements, 180 transactions (12 pending, 9 refunds, 2 annual fees, 6 credits, 3 temporary credits and 2 reversals among them), 16 payments (3 autopay, 2 returned, 1 cancelled and 1 skipped among them), 5 disputes (one in each state), 7 offers (the 4 kinds and the 5 read states), 30 points entries and the 24 newest notifications. That is 251 records in about 275 KB. `fixtures/binding.json` binds people and accounts, and `fixtures/policies.json` grants the local scenario and sandbox actions. Task authors replace them through Infra's `env.load_seed`; Agents cannot load history, reset or inject events. `examples/task-data/` holds a smaller seed that a task can edit. The acceptance tests use it, because the plan's examples (a statement of 1,240.00 and one hotel hold of 300.00) fit a small account better than the larger fixture.

The App has no timer and no scheduler. It uses `ctx.virtual_now`, and an event is handled at its own time. Time-based states are never stored. They are computed when they are read or checked: a payment that reads `posted` or `skipped`, an offer that reads `expired`, the dispute window, the fee refund window, the spending window of an offer, the due time of a statement and the flags. A day is a calendar day in the issuer's time zone. A limit of N days from a moment ends at the end of the calendar day that is N days after the day of that moment.

The balance is computed when it is read: the posted purchases, fees, interest and reversals, minus the posted refunds, credits and temporary credits, minus the payments that posted and were not returned. Only posted transactions count in any sum. A pending transaction of another kind than a purchase is shown and counts nowhere.

Core owns commit receipts and audit; the App owns business history. The state has one activity row for every committed Agent write, one for every applied event and one for each effect of an event: an autopay payment, a temporary credit or a reversal of `dispute.updated`, and a notification. Effect rows have `effect: true`. The effects of a write are in the records it changes: transactions, payments, disputes, offers and points entries keep a `history` list, and the account keeps one for autopay, product changes and closing. Optional `ctx.log` gets the action and the object ID of each row, not amounts or text.

`examples/scenario.json` is one event for the fixture, applied through `env.apply_event` at the supplied time. `dev/build.cjs` writes `tools.json` and the seed and event schemas from one set of record shapes. `dev/build-fixture.cjs` and `dev/build-task-seed.cjs` write the two seeds: they replay a scripted history through the App's own hooks (`dev/replay.cjs`), so the App accepted every step. `dev/check-fixture.cjs` is the consistency script of the plan, with its own code, and `dev/check-plan-examples.cjs` compares the example events and the example message in `tests/` with the approved plan. They are development tools and do not run in the App.

## Evaluation data

`data/evaluation/` holds the delivery dataset of the plan: two years of synthetic history of one cardholder, from 1 January 2025 to 31 December 2026, read at `2026-12-31T23:00:00-05:00`. Every record is synthetic, because Brindle models no real issuer or website (open question 5 of the plan). The folder's [README](data/evaluation/README.md) says how it is made. It has 1,500 records: 25 statements (24 in the window and the opening one of December 2024), 1,389 transactions, 31 payments, 8 disputes in every state, 16 offers and 31 points entries, with 103 notifications and 1,949 activity rows. The dated rows fall on 666 distinct dates, and every month of the window has some.

- `dev/evaluation-scenarios.cjs` holds the story templates: a purchase with its pending hold and its refund, a dispute with its credits and its end, an offer with its payout, a payment story, a trip, the fees and interest. Every record belongs to exactly one story, and `manifest.json` lists each story with its template and record IDs.
- `dev/generate-dataset.cjs` builds the stories with a seeded PRNG and replays every step in time order through the App's own hooks. `--check` compares with the committed files, the size limit of an `env.load_seed` request and the time of the replay.
- `dev/check-evaluation.cjs` holds the 14 committed story rules (for example: a refund names a purchase of the same merchant and is never above what is still owed; a temporary credit equals the disputed amount; a credit or bonus names an accepted offer and has its amount). `T21d` plants a contradiction for each rule and checks that it is caught.
- `dev/select-evaluation-seed.cjs --as-of TIME` writes a seed with only the history before that time, each record in its state at that time. It refuses a seed that holds a later timestamp, except the due times of a schedule. At the clock it gives the delivered seed byte for byte.
- `dev/coverage.cjs` counts the dates of the seed in `America/New_York` and writes [`coverage.md`](data/evaluation/coverage.md) and `coverage.json`: one date field for each family, monthly counts, gaps, exclusions and file hashes. A payment counts only for its acts: its request and any cancel, its posting of money and a return, each at its own time. The planned day of a cancelled, skipped or still scheduled payment is listed apart and never counted. The December 2024 opening history is excluded with its reason.
- `dev/check-fixture.cjs --evaluation` runs the consistency script on the delivered seed and on the 24 month-start seeds, and the story rules on the delivered seed.
- `tests/evaluation.integration.cjs` loads the dataset with `env.load_seed` on the real runtime and reads it back through MCP.

The small fixtures stay as smoke fixtures. The dataset is not loaded by default.

## Mail notifications

Mail is optional and send-only. No other App is required to run this package. Each applied event writes one notification, except `transaction.dropped` and a `transaction.posted` for a purchase. When `email_notices` is on at that moment, the App stores the full wire message with it, for the receive contract of Mail 1.3.0 (`channel.email`, `urn:pale:email-message:2`). `schemas/router-message.schema.json` is a byte copy of Mail's schema.

`infra/sender.cjs` is the Infra-run sender. Infra gives it two connections, Brindle's Infra connection and the Messaging publisher connection, and calls `publishPending()` when it wants the pending messages sent. `infra/router.config.example.json` is an example grant.

The sender keeps publishing after a Brindle reset or a new seed. This lifecycle rule answers the first suggestion of the design review:

- Infra keeps one sender for the whole run, like its one publisher connection. The sender reads `env.snapshot` and calls `router.publish`. It never writes to Brindle.
- It never sends a notification that was in the loaded seed. It reads that list from the `initial_data` of each snapshot, so the list is right after a reset or a new seed.
- In the epoch that the sender started in, the message `id` and the `request_id` are the notification ID, as the plan says.
- After `env.reset` or a new seed in the same run, Brindle has a new epoch and can make an old notification ID again. From then on both IDs are `<notification id>.e<epoch>`. So a new notice never reuses an identity that the router or Mail already has. Mail keeps the messages that were delivered before the reset.
- An exact retry keeps its identity. The router returns the first receipt, marked `duplicate`, and Mail keeps one inbox record.
- The sender remembers the first epoch in memory. A second sender in the same run must get it as `createSender({infra, router, firstEpoch})`.
- The sender publishes a notification until it gets a final answer. A delivery is final. A refusal for lack of a route (no grant, or no bound mailbox) is also final: Mail has no record, and the sender goes on to the next notification.
- Every other answer stops the sender for inspection: a halted run, an unknown outcome, or an identity or a contract that the router refuses. The next call tries the same notification again. None of these outcomes changes Brindle.

## Evaluator records

The plan names three places for evaluator records. This is how they join, which answers the second suggestion of the design review:

- Every join is scoped by the run, the App, the account and the epoch. `env.snapshot` gives `run_id`, `app_id`, `epoch` and the version next to the data, and the data has `account_id`. Inside that scope, rows join on `request_id` (Agent writes), `event_id` (events) and the version.
- An activity row with `effect: false` is a separate action: a committed Agent write or an applied event. A row with `effect: true` is an effect of the event in the same `event_id`. The effects of a write are not rows: they are the history entries of the records it changed.
- Take the snapshot before `env.reset` and before `env.load_seed`, because both start a new epoch and clear the audit.
- A replay returns the stored receipt and writes no row, so it is counted from the trace as a retry of the original. A denied call writes one deny row in Core's audit and no activity row, so two denied attempts are two deny rows. A change that time alone causes writes no row, and it is read from the stored due times and the clock.

## Plan and implementation

The package follows the approved plan. This section lists the points where the package adds a rule or reads a sentence of the plan in one way, then the choices that the plan left open, then the answers to the design review, and last the workflow-to-test mapping. Each point names its test, or the rule in the code when no test covers it.

### Points that add a rule or differ from the plan

The plan says that Brindle rejects only the events in its list and applies every other event as given. The package adds no business rule that rejects an event. It adds only structure checks, so that every record stays readable. Each one rejects an event with `invalid_event` (`T19b`):

- An amount of zero or less, or with more than two decimals, in any transaction, temporary credit, reversal, statement or offer amount. The plan names this for a posted transaction only. A pending amount or an offer credit of zero has no meaning either.
- One ID for the temporary credit and the reversal of one `dispute.updated`.
- The structure that the event schema checks: a fee names its `fee_type` (`annual` or `other`), only a credit names an offer, a reversal names its `dispute_id` and no `relates_to`, and an offer has the fields of its kind. Core checks the schema before the App runs, so these return Core's `invalid_arguments` through `env.apply_event`.
- After an event, the App runs the seed rules, as the plan says. So a refund that relates to a fee or to nothing, and a points change that takes the balance below zero, are rejected.

Seed rules (`T19d`). Beside the plan's list, `validateSeed` rejects a seed with `invalid_seed` unless it keeps these rules:

- One ID space: no two records, notifications or products share an ID, and the partners of a product have different IDs.
- Every reference resolves: the product of the account and of an offer, `relates_to`, `dispute_id`, `offer_id`, `points_entry_id`, the purchase of a dispute, the statement and the autopay payment, the fee of a fee refund, the partner of a transfer, the transactions of a dispute's history, and the objects of notifications and activity rows.
- A temporary credit or a reversal relates to the purchase of the dispute it names. A refund relates to a purchase.
- The state fields of each record agree. A posted transaction has `posted_at`, a dropped one `dropped_at`, a pending one neither, and only a posted one keeps `pending_amount`. A cancelled payment was cancelled before the start of its day, and a returned one was returned after it posted. A closed account has `closed_at` and autopay off. An offer's `enrolled_at`, `declined_at` and `unavailable_at` fit its state. A dispute's state is the last status of its history, with `withdrawn_at` or `ended_at` to match.
- An autopay payment names its statement, and the statement names it back. A redemption credit and its points entry name each other.
- A redeemed, transferred or forfeited entry takes points off, and only a transferred entry has a transfer. No points entry is 0.
- A fee refund names an annual fee, once.
- Amounts and rates have at most two decimals, days are real dates, time zones are known, and every timestamp has a UTC offset.

`T19e` checks that no seed rule makes a valid write or event fail: a fixed walk of 400 steps of writes, events and clock moves commits each valid step.

Other points:

- A posting event for a pending transaction changes only its amount and note. The App keeps the stored kind, merchant, `relates_to` and transaction time, and the history row keeps the event's amount. The held amount is kept as `pending_amount`. (`T02b`)
- A reversal in `transaction.posted` names its dispute. The App sets `relates_to` to the dispute's purchase, so a reversal can never point at the wrong purchase. (`T12`, `T19b`)
- A notification is written for a `transaction.posted` of a pending refund, fee or credit too, with the title "A pending ... was added". Only purchases and drops write none, as the plan says. (`T19n`)
- A redemption whose points are worth less than one cent returns `below_minimum`. With the issuer's rules of the seeds this cannot happen. (No test; the rule is `rewards.redeem` in `src/operations.cjs`.)
- `rewards.transfer` to a partner that the current product does not have returns `not_found` before `invalid_state`, by the order of the table. (`T20d`)
- A `credit` that relates to a purchase is shown in `related`, and it is not in the recovery summary. The plan counts only the merchant's refunds and the dispute credits. (`T02`)
- The App returns `invalid_arguments` for some inputs that the input schema allows: a day that is not a real calendar date (for example `2026-11-31`), an amount with more than two decimals, and `preferences.update` with no field. These checks run before any App error. (`T05`, `T09`, `T20d`)

### Choices that the plan left open

1. List windows (`start`, `end`) are calendar days in the issuer's time zone, both included. They are the transaction day for `transactions.list`, the closing day for `statements.list`, `pay_on` for `payments.list` and the day of `at` for `notifications.list`. (`T02`, `T03`)
2. `paid_toward` the latest statement is the plan's rule: the payments that posted after its closing time and were not returned. For an older statement the sum stops at the closing time of the next statement, so it does not grow forever. The bill, the flags and the payment amounts read only the latest statement. (`T03`, `T08`)
3. A payment stores `posts_at`, the later of the start of its day and the moment it was scheduled. It reads `posted` from then. So a payment for today posts at once, and the Autopay rule's "before the start of its day" uses the same moment. (`T05`, `T07`)
4. A skipped autopay payment has a stored `scheduled_amount` above zero and a posted amount of 0.00. The seed rule "a payment with an amount of zero or less" is on `scheduled_amount`. The posted amount of an autopay payment is computed, never stored. (`T07`, `T19d`)
5. `amount` is allowed only for a `fixed` payment, and `preferences.update` needs at least one field (input schema). (`T05`, `T09`)
6. `autopay.set` keeps the stored `source` when it gives none. (`T07`)
7. Dispute reasons are `not_received`, `not_as_described`, `credit_not_processed`, `duplicate_charge`, `wrong_amount`, `not_recognized`, `cancelled_recurring` and `other`: the billing-error kinds of Regulation Z section 1026.13(a) and the usual card network reasons. (`T11`)
8. `transactions.list` matches `merchant` exactly, ignoring case. (`T02`)
9. A redemption credit and a partner's points round down: a credit is the points times `redeem_cents_per_point`, rounded down to the cent. (`T17b`)
10. A closing with 0 points writes no points entry, because an entry of 0 is not a change. (`T18b`)
11. The App makes these IDs: `pay-`, `dsp-` and `ntf-` with four digits, and `txn-a` and `pts-a` with four digits for a redemption credit and for redeemed, transferred and forfeited entries. Events give their own IDs to statements, transactions, offers and points entries. A new ID has the number after the highest one in use with that form. (`T05`, `T17`, `T19f`)
12. Notification topics are `<account_id>:<topic>`, with `transaction-updates`, `statement-updates`, `payment-updates`, `dispute-updates`, `offer-updates` and `points-updates`. Days in the text are written as "2 November", with the year only when it is not the year of the notification, and times use the time zone of the preferences. The temporary-credit notice is the plan's example, byte for byte. (`T19g`, `T19h`, `T09`)
13. Stored times and days need years 1970 to 2999. Reads still work at Core's default clock of 1970. (`T19b`, `T03`)
14. `account.get` also returns `payment_options`: what each payment choice would schedule now (0.00 where it would return `nothing_due`, null with no statement), and `products`, so the agent can read the product of a product-change offer. `account.close_preview` returns `already_closed`, `points_lost`, `fee_refund` with its last day, `offers_ending`, `bonus_not_arrived` and `stays_open` (balance, scheduled payments, open disputes, pending transactions and credits the issuer still owes). (`T01`, `T04`)
15. `transactions.list` has no pagination, because the plan has none. Its rows are short summaries. On the evaluation seed, read it in month windows.

### The design review suggestions

The design review of the plan approved it with three suggestions, which do not affect approval:

- **A source-lifecycle identity for publications.** The sender uses `<notification id>.e<epoch>` after a reset or a new seed, and reads the seed exclusions from each snapshot ("Mail notifications"). `T19j` to `T19m` test it with a fake router. `tests/mail.integration.cjs` tests a reset of Brindle alone and a new seed in the same run with the real router and Mail: Mail keeps its old messages and gets each new notice once, a reused plain ID is refused, and the seed history is never sent.
- **Explicit evidence joins.** "Evaluator records" above gives the scope (run, App, account, epoch), the difference between an action and an effect, the export before reset and before a new seed, and how denied attempts are counted. `T20c` and `tests/mcp.integration.cjs` check the effect flags, one row for each action, and one deny row for each denied call.
- **Autopay after a late return.** `T07b` lets an earlier manual payment reduce an autopay payment, and in a second case make it `skipped`, and then returns the manual payment after the autopay day. The debt comes back, and the autopay amount and state do not change.

### Workflow-to-test mapping

Each control that returns an error is checked before and after: the data, the activity rows and the commit count do not change. `T20` runs the main paths again on the real host.

| Workflow | Plan item | Tests |
| --- | --- | --- |
| W1 | Main path: credit limit 8,000.00, a statement of 1,240.00 (minimum 35.00, due 26 December), a purchase of 210.00 since and a hotel hold of 300.00 read a balance of 1,450.00, `pending_total` 300.00, `available_credit` 6,250.00 and 0 paid toward the statement | `T01`, `T20` |
| W1 | Main path: on 5 December, with `fee_refund_days` of 30, an annual fee of 550.00 posted on 1 December and 12,000 points, `account.close_preview` reads a fee refund of 550.00 until 31 December and 12,000 points lost | `T04`, `T20` |
| W1 | Transactions, the recovery summary, statements, payments, disputes, offers, rewards, notifications and preferences | `T01b` to `T03` |
| W1 | Control: an unknown transaction returns `not_found`; a window that ends before it starts returns `invalid_window` | `T02`, `T03`, `T20d` |
| W1 | Control: the business data is byte-identical after every read, `account.close_preview` included | `T03`, `T04`, `T20` |
| W2 | Main path: on 10 December a statement-balance payment for 20 December is `scheduled` for 1,240.00; after `env.advance_time` to 20 December it reads `posted`, the balance is 210.00 and the statement is paid in full | `T05`, `T08`, `T20` |
| W2 | Main path: autopay on the minimum due; the next statement (210.00, minimum 35.00, due 26 January) schedules 35.00 for 26 January; a manual 100.00 on 10 January makes it `skipped` | `T07`, `T20` |
| W2 | Controls: yesterday `invalid_window`, 2,000.00 against 1,450.00 `over_balance`, no statement `no_statement`, paid in full `nothing_due` | `T05`, `T05b`, `T20d` |
| W2 | Controls: cancel on 19 December `cancelled`, on the payment's day `too_late`; an unknown time zone `invalid_timezone` | `T06`, `T06b`, `T09` |
| W2 | Controls: `payment.returned` makes the balance 1,450.00 again and the account reads `payment_returned`; with nothing paid after the due time the account reads `past_due` | `T08`, `T08b`, `T20` |
| W2 | Autopay details: partial reduction, same-day payment, a late return, turning on later, a zero amount, a new setting | `T07b`, `T07c` |
| W3 | Main path: gym 60.00 on 2 November, refund 20.00 on 9 November read `refunded_final` 20.00 and `net_charge` 40.00; a dispute of 40.00 on 13 November is `open`; a temporary credit of 40.00 keeps `net_charge` 40.00; the merchant's refund of 40.00 reads `refunded_final` 60.00, `net_charge` 0 and `double_credited`; `closed_matched` with a reversal of 40.00 reads `temporary_credit` 0 and no flag | `T10`, `T11`, `T13`, `T20` |
| W3 | Controls: 50.00 `over_net`, the hotel hold `not_disputable`, a second dispute `already_disputed`, 61 days after posting `too_late` | `T11`, `T11b`, `T20d` |
| W3 | Control: a withdrawal after the temporary credit is `withdrawn`, and `temporary_credit` stays 40.00 until a reversal posts | `T12` |
| W4 | Main path: three offers in one group; accepting the 150.00 credit makes the others `unavailable`, and the credit posts later naming the offer | `T14`, `T20` |
| W4 | Main path: 10,000 points redeemed give a credit of 100.00 and leave 2,000; a transfer of 2,000 with a step of 1,000 leaves 0 | `T17`, `T20` |
| W4 | Main path: `account.close` on 5 December is `closed`, one entry forfeits 12,000 points, and the fee refund of 550.00 is recorded | `T18`, `T20` |
| W4 | Controls: after `accept_by` `too_late`; the second offer `invalid_state`; 500 points `below_minimum`; 1,500 points `invalid_increment`; 13,000 points `insufficient_points`; a redemption after closing `invalid_state`; a closing on 2 January records no fee refund; declining the third offer leaves the others `available` | `T14`, `T17`, `T18`, `T18b`, `T20d` |
| W4 | A spending offer, a product change and its fee refund | `T15`, `T16` |
| All | Main path: after `env.advance_time` and no App event a payment reads `posted`, an offer `expired` and a window closed, and business data is unchanged | `T20b`, `T20` |
| All | Main path: reset restores the loaded seed and time; activity rows follow the counting rules | `T20`, `T20c` |
| All | Controls: each invalid event of the plan's list `invalid_event`; replay, `idempotency_conflict`, `stale_version`; the Agent calling `env.*` gets `permission_denied` | `T19`, `T20` |
| All | Each of the 14 App errors, and the first one of the table when two fit | `T20d` |
| All | The seed rules, and no seed rule that makes a valid write fail | `T19d`, `T19e` |
| Mail | Example messages pass Mail's wire schema, and `ntf-0058` is the plan's example message | `T19g`, `T19h` |
| Mail | A notification is a received message in the bound Mail account with a committed receipt; an identical retry keeps one inbox record; without a grant Mail has no record | `T19i` |
| Data | The delivery dataset of 2025 to 2026: month-start seeds load and pass the consistency script and the story rules, the generator, coverage report and selector reproduce, a seed loads and is read through MCP, and the coverage count adds no posting for a cancelled or skipped payment | `T21` to `T21f` |

## Remaining manual review

Automated checks do not cover these points. A person should review the realism of the issuer rules (the 60-day dispute window, the 30-day fee refund window, 1 cent a point and 1,000 points at least), the amounts and merchants of the fixtures and the dataset, the offer terms, and the notification wording.

## Package map

```text
app.json                     Package identity, entrypoints, capabilities and limitations
tools.json                   Agent operations and input/output schemas
service.cjs                  Public MCP launcher (platform-provided entry)
plugin.cjs                   Standard hooks delegating to src/
src/                         Seed rules, views, operations, events, notification text and day arithmetic
schemas/                     Seed, state and event rules, Mail's wire schema and copied public contracts
contribution/                Capabilities, the publish declaration, empty media catalog and provenance
infra/                       Infra-run Mail sender and an example Router grant
fixtures/                    Initial records, account bindings, policy and clock
dev/                         Schema and seed builders, the consistency script, the evaluation generator, story rules, selector and coverage report
examples/run.cjs             Runnable event example without a host
examples/scenario.json       Input to an Infra event injection, not an automatic scheduler
examples/task-data/          Replaceable task seed, binding and policy examples
data/evaluation/             Synthetic evaluation dataset of 2025 to 2026, its provenance and its coverage report
tests/                       App-only tests and harness, schema validator, plan examples and three real-runtime scripts
```
