# Alderbrook Mutual claims validation report

Checked November 23, 2026 (America/New_York). Scope: the package `apps/alderbrook` version **1.0.0**, public runtime **1.6.0**, Core API **1.2.0**, Mail **1.3.0**. The approved plan is [`proposals/environment/alderbrook-claims.md`](../../proposals/environment/alderbrook-claims.md) at commit `556d425`, and that file is unchanged. The exact package hash, the counts of every run and the raw reports are in [`alderbrook/index.json`](alderbrook/index.json) and the files beside it. The package hash is the same in both Node runs and in the base-runtime report.

**Automated outcome: passed.** This document records implementation evidence for review. Human workflow acceptance and provenance review remain pending; no approval is claimed.

## Reproduction and evidence

| Evidence | Result | What was actually exercised |
| --- | --- | --- |
| App-only business | 75 tests: 73 passed and 2 skipped in a copy of the package alone | The real App hooks, the input, output, seed and event schemas, every App error, every seed rule of the plan and every invalid event of the plan's list that can occur, every seed rule and event check that the package adds, the money and rental sums, day limits in five time zones, notification text, activity rows, and the sender with fake connections. The 2 skipped tests need the runtime (next rows) |
| Isolated App package | Passed | The public verifier copies the package with no sibling runtime, then runs its tests and its event example |
| Real public MCP, common checks | 43 checks passed | Discovery, argument and role restrictions, a read, history loading, event application and retry, reset, a separate run and a restarted process |
| Real public MCP, Alderbrook workflows | 124 checks passed | `tests/mcp.integration.cjs`: a task seed with its own `virtual_now`, the W2 to W4 paths of the plan with its numbers, time moved with `env.advance_time` and no App event, refused calls and refused events that change nothing, replays, audit and activity records, reset, a second run, Core's `invalid_arguments` for data that breaks a schema, and all reads at the default clock of a registry with no `initial_time` |
| Alderbrook to Mail | 47 checks passed | `tests/mail.integration.cjs`: the real Router process and the real Mail package. An inbox record and a committed receipt, read through the Mail Agent. Seed history not sent, an identical retry, a missing grant, no mailbox bound to the owner, a new notice after a reset of Alderbrook only, a refusal by Mail, and a receiver that does not answer |
| Node 18.20.8 | All rows above, and 22/22 full-suite stages passed | The existing Mail, Calendar, Core and Messaging regression suite with this package present |
| Node 22.23.5 | All rows above, and 22/22 full-suite stages passed | The same on the second supported runtime family |
| Independent base validator | All eight discovered packages passed | Unmodified main at `a4bce023953061483c41de5a287ba5e43f4a5648` validated the candidate tree: this package and the seven existing ones |
| Development checks | Passed | `dev/build.cjs --check`, `dev/build-fixture.cjs --check`, `dev/check-fixture.cjs` (4 of 4), `dev/check-plan-examples.cjs` (11 of 11), `examples/run.cjs`, `npm run contracts:check` |
| Human review | Pending | Realism of rules, amounts and wording, and provenance; automated green results do not grant acceptance |

The Node binaries were official releases. All test data was synthetic; tests used temporary directories and local stdio MCP, without private services, user credentials or model APIs. The App validation workflow of this repository has not run on this pull request yet: a run from a fork waits for a maintainer.

Run from the candidate checkout:

```sh
node --version
npm run contracts:check
node apps/alderbrook/dev/build.cjs --check
node apps/alderbrook/dev/build-fixture.cjs --check
node apps/alderbrook/dev/check-fixture.cjs
node apps/alderbrook/dev/check-plan-examples.cjs
PALE_RUNTIME_ROOT=$PWD/runtime node --test apps/alderbrook/tests/business.test.cjs
npm run app:verify -- --app apps/alderbrook --output .artifacts/alderbrook.json
node apps/alderbrook/tests/mcp.integration.cjs --runtime runtime --report .artifacts/alderbrook-mcp.json
node apps/alderbrook/tests/mail.integration.cjs --runtime runtime --report .artifacts/alderbrook-mail.json
npm test
```

Run the package alone from a copy that holds only `apps/alderbrook/`:

```sh
node --test tests/business.test.cjs
node examples/run.cjs
```

Run the independent package check from a separate checkout of the pinned base:

```sh
node runtime/ci/verify-submissions.cjs /path/to/candidate /path/to/reports
```

The base checker was not changed or supplied from the candidate. With no base commit as a third argument it validates every package of the candidate tree. This pull request changes no file under `runtime/`, `examples/` or the root, and it does not add the App to `apps.registry.json`.

## Workflow evidence

Test IDs are the IDs of the plan's acceptance table. A letter after an ID marks one more test for that ID. "MCP" is `tests/mcp.integration.cjs` and "Mail" is `tests/mail.integration.cjs`.

| Preconditions → action | Expected and observed result | Failure/control | Where |
| --- | --- | --- | --- |
| W1. On 2 December, `coverage.check` on the auto policy for `collision`, its first vehicle and a loss on 1 December | `covered: true`, deductible 500, last day to file 31 December. With an estimate of 420: expected payment 0 and `under_deductible` | A loss on 15 June lists `not_in_force` and `too_late`. A loss on 20 October lists `too_late` alone. Every read leaves the business data byte-identical | T01 to T04d, MCP |
| W1. `claims.get` on a claim with three lines approved for 2,000 | `approved_total` 2,000, `insurer_owes` 1,500, `my_share` 500, `still_due` 1,500 | A limit with `over_limit`, a line approved for less, a total under the deductible, cents, and sums above the largest single amount | T04 to T04d |
| W2. `claims.file` on 2 December, then a request with two asks, two evidence items, two answers and a driver update | The claim is `open` on the `repair` path with `driver: null`. The request stays `open` after the first answer and is `answered` after the second | `duplicate_claim` for the same vehicle and loss day, and the other vehicle is accepted. `request_overdue` once the clock reaches the due time, with no App event. `claims.withdraw` after a payment returns `invalid_state` | T05 to T08d, MCP |
| W3. An estimate of 2,000, a determination, `payee.set` to the shop, a payment of 1,500, a supplement of 1,500, a second determination and a second payment | `insurer_owes` 1,500, then 3,000 after the supplement is approved. `still_due` 0 and `my_share` 500 at the end. The pending supplement reads `lines_pending` and `not_approved_total` 1,500 | `nothing_to_dispute`, `too_late` on day 31, `already_disputed`. A third payment of 200 to the policyholder reads `payee_mismatch` and `overpaid` 200 | T09 to T13, MCP |
| W4. `offer.issued` with a valuation of 14,200 and a payoff of 15,100, a rejection, a new offer of 15,900, an acceptance | `net` 13,700, `shortfall` 1,400 and `below_payoff`. Then `net` 15,400, `to_lienholder` 15,100 and `to_me` 300 | An offer reads `expired` once the clock reaches its `respond_by`, and `offers.accept` returns `too_late`. A rejected offer returns `invalid_state`. `estimates.submit` after the first offer returns `invalid_state` | T14 to T15c, T17, MCP |
| W4. A rental from 3 December at 45 a day, cap 40, 30 rental days, 5 grace days, read on 18 December | 12 covered days, 3 uncovered days, `my_cost` 195 and `rental_uncovered` | A second rental while one is active returns `already_active`. The 30 day limit across two periods, a stop at the repair completion day, and a 31st rental period on one claim | T16 to T16d, MCP |
| The platform clock. `env.advance_time` moves the clock and no App code runs | Overdue requests, expired offers, the last day to file and the dispute window follow the clock. Nothing is rewritten | The exact instant before and at each limit. A second time zone, the end of daylight saving time, a zone east of UTC, zones where a day has no midnight or two, and the clock of 1970 | T05c, T07b, T11b, T17 to T17l, MCP |
| All. Each event of the plan's list of rejected events that can occur, and each seed of the plan's `validateSeed` list. Two cases of the list cannot occur, "an unknown estimate" and "an unknown offer", because no event names an existing one (README, "Plan and implementation") | `invalid_event` or `invalid_seed`, and the state is unchanged | Also each seed rule and each event check that the package adds (README, "Plan and implementation"). Each case is refused by the rule that its label names | T18, T18b, T18g, T18k to T18n, MCP |
| All. Notifications and activity rows | One notification for each applied event, none for the policyholder's own writes or for a change of time. One activity row for each committed write, each applied event and each effect | A refused call writes no activity row. The example wire message of the plan is reproduced for the same input, except for its notification ID and time | T18c to T18f, T18h to T18j |
| All. Core contracts through real MCP | A repeated `request_id` returns the stored receipt and files no second claim. Reset restores the loaded seed and time | `idempotency_conflict`, `stale_version`, and `permission_denied` for the Agent calling `env.*` | T19 (MCP) |
| Mail. A notification is committed while `email_notices` is on, and Infra runs the sender | An unread inbox record whose subject and body equal the notification, and a committed receipt. The wire time is the event time, and Mail's `received_at` is Mail's own clock | No grant: `recipient_not_authorized` and no Mail record. No mailbox for the owner: `recipient_unavailable`. An identical retry: `duplicate` and one record. Mail refuses, or does not answer: the run halts and Alderbrook keeps its commit | T19b (Mail), T19c to T19h |

## Design review suggestions

The design review approved the plan with two suggestions. Both are answered in code and in tests. The proposal file is not changed.

| Suggestion | What the package does | Evidence |
| --- | --- | --- |
| Say what the sender does after a reset of Alderbrook only, and test an identical retry and a new notice | Publishing continues. In a later lifecycle the message `id` and the `request_id` are `<notification id>.e<epoch>`. The seed exclusions come from each snapshot. An exact retry keeps its identity | Mail: after `env.reset`, a new notification reuses an old ID, is delivered once as a new record, and old messages stay. A retry adds no record. Also a new seed in the same run, and a second sender object. T19c, T19d, T19h |
| Exercise the receiver-rejection and unknown-acknowledgement outcomes | The sender stops, and it never writes to Alderbrook | Mail: a full mailbox makes Mail refuse the delivery (`receiver_rejected`, `stop_run`). A locked Mail instance gives no answer (`unknown`, `receiver_unconfirmed`). For both: the run is halted, the next publish returns `run_halted`, the notification is still in Alderbrook, and the Mail Agent shows what Mail holds |

## Review gates

| Review gate | Outcome |
| --- | --- |
| Package and contracts | Passed the package and schema checks. The same package hash in both Node runs and in the base validator. The wire schema is a byte copy of Mail's, and the shared schema copies match `runtime/contracts/schemas/` |
| App-only business | Passed from an isolated copy with no runtime sibling |
| Public runtime and independent integration | Passed real MCP, lifecycle, permission and delivery checks, and the unmodified base validator. Mail is the only other App, and it is optional |
| Workflow and human review | Automated workflow evidence passed. Human scope, realism and provenance acceptance remain pending |

## Plan and implementation

The package follows the approved plan. The README section ["Plan and implementation"](../../apps/alderbrook/README.md#plan-and-implementation) lists four points that differ from a sentence of the plan, and the choices that the plan left to the implementation. The four points are the sender's rule after a reset, `not_found` as an error of `coverage.check`, Core's `invalid_arguments` for data that breaks a schema, and two cases of the rejected-event list that cannot occur. The choices are argument names, the form of the IDs that the App makes, the stored state of an offer, the bounds of windows, amounts, timestamps and clocks, and the structure checks that the event handlers and `validateSeed` add. Each of them has a test. The fixture has the counts that the plan promises, and `T03c` asserts them.

## Data and licence

The fixture is authored and synthetic. `dev/build-fixture.cjs` replays the authored history once through the App's own hooks. It then keeps the 22 newest notifications, to match the count of the plan, and every activity row. `contribution/dataset.json` records the provenance and the two public pages that were read for the shape of the workflows. No text, data, form, logo or brand was copied. The package has no media. Code and fixtures are under the repository's MIT License.

## Not claimed, and what remains

- No acceptance, approval or merge is claimed.
- The first version is MCP only, as approved. There is no GUI evidence because there is no GUI.
- The checks call no model API. No agent trial and no benchmark task is part of this evidence.
- The Mail script shows a receiver that refuses and a receiver that does not answer. It does not reproduce a commit by Mail whose acknowledgement is lost.
- All checks use local stdio MCP. Remote deployment, OAuth and production credentials are outside this evidence.
- The official CI result is not part of this report. The workflow run on a pull request from a fork waits for a maintainer.

Recommendation: ready for code and implementation review, with automated local evidence attached. Merge and acceptance remain maintainer decisions.
