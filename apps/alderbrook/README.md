# Alderbrook Mutual claims App

Self-contained PALE App package, version 1.0.0, Core API 1.2.0. It is a resettable insurer's claims portal for auto and renters claims, seen from one policyholder's account. Data is synthetic: the insurer, people, shops, lender and policies are fictional, and no affiliation is claimed. See `tools.json` for exact inputs and outputs and `schemas/seed.schema.json` for records. Business logic lives in `src/`; `plugin.cjs` exports the standard hooks.

The approved plan is [`proposals/environment/alderbrook-claims.md`](../../proposals/environment/alderbrook-claims.md). The validation report is [`docs/validation/alderbrook-v1.0.0.md`](../../docs/validation/alderbrook-v1.0.0.md).

## Run locally

Requires Node.js 18 or newer. No package install, private Core, account or remote service is needed (from repository root):

```sh
node --test apps/alderbrook/tests/business.test.cjs
node apps/alderbrook/examples/run.cjs
node runtime/cli.cjs verify --app apps/alderbrook --output .artifacts/alderbrook.json
node apps/alderbrook/tests/mcp.integration.cjs --runtime runtime
node apps/alderbrook/tests/mail.integration.cjs --runtime runtime
```

With only this App folder, run `node --test tests/business.test.cjs` and `node examples/run.cjs` from inside it. Two tests need the public runtime and are skipped there: `T19` runs `tests/mcp.integration.cjs`, and `T19b` runs `tests/mail.integration.cjs`. Set `PALE_RUNTIME_ROOT` to the public `runtime/` directory to run them. `T19b` also needs the public checkout that holds this package and Mail, so in a copy outside the checkout it stays skipped. A script that cannot run prints `SKIP` with the reason and exits with code 77, and its test is then reported as skipped, not as passed. `service.cjs` uses that runtime; it does not embed a second server.

## Workflows and operations

The App has 22 Agent operations, named `alderbrook.<name>`, and four workflows.

| Workflow | Read | Write |
| --- | --- | --- |
| W1 Policies, claims and money | `policies.list`, `policies.get`, `coverage.check`, `claims.list`, `claims.get`, `estimates.get`, `payments.list`, `notifications.list`, `preferences.get` | none |
| W2 Filing a claim and answering the insurer | | `claims.file`, `claims.update`, `claims.add_evidence`, `claims.withdraw`, `requests.respond`, `preferences.update` |
| W3 Repairs | | `estimates.submit`, `determinations.dispute`, `payee.set` |
| W4 Total-loss offers and the rental benefit | | `offers.accept`, `offers.reject`, `rental.start`, `rental.end` |

- Every read returns `now`, the current virtual time with the insurer's UTC offset.
- Every write takes Core's `request_id` and `expected_version`, and returns the `id` of the object it wrote.
- The 11 App errors are checked in this order, and the first one that fits is returned: `not_found`, `invalid_state`, `invalid_timezone`, `invalid_window`, `not_in_force`, `not_covered`, `nothing_to_dispute`, `already_disputed`, `too_late`, `duplicate_claim`, `already_active`.
- The insurer, the shop and the lender act through eight events: `request.issued`, `estimate.submitted`, `determination.issued`, `dispute.decided`, `offer.issued`, `payment.issued`, `repair.completed` and `claim.closed`. An event that breaks a rule is rejected with `invalid_event`, and the state does not change.

## State and time

`fixtures/minimal.json` is the initial history: 2 policies, 9 claims and their parts. `fixtures/binding.json` binds people and accounts, and `fixtures/policies.json` grants the local scenario and sandbox actions. `fixtures/clock.json` sets the example clock. Task authors replace them through Infra's `env.load_seed`; Agents cannot load history, reset or inject events. `examples/task-data/` holds a smaller seed that a task can edit.

The App has no timer and no scheduler. It uses `ctx.virtual_now`, and an event is handled at its own time. Time-based values are never stored. They are computed when they are read or checked: the last day to file, the `request_overdue` flag, an `expired` offer, the end of a dispute window, the covered days of a rental, the money summary and the flags. A day is a calendar day in the insurer's time zone. A limit of N days after a moment ends at the end of the calendar day that is N days after the day of that moment.

Core owns commit receipts and audit; the App owns business history. The state has one activity row for every committed Agent write, one for every applied event and one for each effect of a write or an event. Optional `ctx.log` contains identifiers and operation steps, not claim text.

`examples/scenario.json` is one `alderbrook.estimate.submitted` event, applied through `env.apply_event` at the supplied time. `dev/build.cjs` writes `tools.json` and the seed and event schemas from one set of record shapes, `dev/build-fixture.cjs` writes the fixture, `dev/check-fixture.cjs` checks its consistency, and `dev/check-plan-examples.cjs` compares the example events and the example message in `tests/` with the approved plan. They are development tools and do not run in the App.

## Mail notifications

Mail is optional and send-only. No other App is required to run this package. Each applied event writes one notification. When `email_notices` is on at that moment, the App stores the full wire message with it, for the receive contract of Mail 1.3.0 (`channel.email`, `urn:pale:email-message:2`). `schemas/router-message.schema.json` is a byte copy of Mail's schema.

`infra/sender.cjs` is the Infra-run sender. Infra gives it two connections, Alderbrook's Infra connection and the Messaging publisher connection, and calls `publishPending()` when it wants the pending messages sent. `infra/router.config.example.json` is an example grant.

- Infra keeps one sender for the whole run, like its one publisher connection. The sender reads `env.snapshot` and calls `router.publish`. It never writes to Alderbrook.
- It never sends a notification that was in the loaded seed. It takes that list from the snapshot each time.
- The message `id` and the `request_id` are the notification ID. An identical retry returns the first receipt, marked `duplicate`, and Mail keeps one inbox record.
- After `env.reset` or a new seed in the same run, the App has a new epoch. From then on both IDs are `<notification id>.e<epoch>`. So a new notice never reuses an identity that the router or Mail already has. Mail keeps the messages that were delivered before the reset. The sender remembers the first epoch in memory. A second sender in the same run must get it as `createSender({infra, router, firstEpoch})`.
- The sender publishes a notification until it gets a final answer. A delivery is final. A refusal for lack of a route (no grant, or no bound mailbox) is also final: Mail has no record, and the sender goes on to the next notification.
- Every other answer stops the sender for inspection: a halted run, an unknown outcome, or an identity or a contract that the router refuses. The next call tries the same notification again. If Mail rejects the message, or its answer is unknown, the router also halts the run. None of these outcomes changes Alderbrook.

## Plan and implementation

The package follows the approved plan. Four points differ from a sentence of the plan. The other points are choices that the plan left to the implementation. Each point has a test.

Points that differ from a sentence of the plan:

- The sender takes the notifications of the loaded seed from each snapshot, not once when it starts. After `env.reset` or a new seed in the same run, the message `id` and the `request_id` are `<notification id>.e<epoch>`, not the bare notification ID. Both answer the first suggestion of the design review.
- `coverage.check` returns `not_found` as an error for an unknown policy, vehicle or address. It lists the other five failures in `failures`.
- Core checks the package's schemas before the App runs. So through `env.load_seed` or `env.apply_event`, data that breaks `schemas/seed.schema.json` or `schemas/events.schema.json` returns Core's `invalid_arguments`: for example a timestamp with no UTC offset, a year outside 1970 to 2999, or an unknown field. The hook `validateSeed` itself answers `invalid_seed` for a timestamp with no UTC offset.
- No event names an existing estimate or an existing offer: `estimate.submitted` and `offer.issued` only create one. So the plan's cases "an unknown estimate" and "an unknown offer" cannot occur. An unknown claim, line or dispute is rejected.

Arguments and IDs:

- `claims.file` and `coverage.check` name the vehicle or the insured address with `subject_id`.
- `determinations.dispute` takes `claim_id` beside `id`, because a line ID is unique inside its claim. So the audit row of a refused dispute shows the line, and the Agent trace shows its claim.
- The optional filter of `claims.list` is `id` (a policy), and the optional filter of `payments.list` and `notifications.list` is `id` (a claim). So their audit rows show the object, like every other call. `payments.list` can also filter by `kind`.
- An evidence item has one of five kinds: the plan's `photo`, `receipt`, `report` and `statement`, and `other`.
- The App makes these IDs: `clm-`, `evd-`, `dsp-`, `rnt-` and `ntf-` with a number, and `est-p` and `ln-p` with a number for an estimate that the policyholder submits. A new ID has the number after the highest one in use with that form: `clm-0010` follows `clm-0009`, also when a lower number is free. If another object already has that ID, the App takes the next free number.
- A task's events give their own IDs to requests, estimates, lines, determinations, offers and payments. If they do not use the forms above, no write of the Agent can take an ID that a later event needs.

Time:

- An offer is stored as `open` and reads `expired` once the clock reaches its `respond_by`. Nothing is rewritten when a due time passes. An offer stored as `open` also reads `expired` when its claim has a later offer or is not open. The seed rules allow such an offer only when its `respond_by` had passed by then.
- A window (`start` to `end`) includes both ends. A time zone is an IANA name, so a bare offset such as `+05:00` is refused.
- The App supports stored times and clocks with a year from 1970 to 2999. The schemas refuse a given or seeded time outside that range. At a clock outside that range a read still works and returns `now`. A write is refused there, because the time that it would store breaks the seed schema.
- `now` and a default due time carry the insurer's UTC offset. An old offset with seconds has no ISO form, so such an instant is written in UTC.
- A day starts at its first instant in the insurer's zone, also where the clocks change at midnight. A calendar date that a zone skipped, such as 30 December 2011 in `Pacific/Apia`, still counts as a day.
- A rental period whose stored start is after the clock ends at its own start when its claim is withdrawn or closed.

Amounts and text:

- An amount is a number with at most two decimals. `10.001` and `10.000000001` are refused: `invalid_arguments` in a call, `invalid_event` in an event and `invalid_seed` in a seed.
- The App also returns `invalid_arguments` for `claims.update` or `preferences.update` with no field, and for one call that answers the same ask twice. The App runs these argument checks before any App error, as Core does for the input schema.
- A notification title is cut to 200 characters and its text to 4,000 characters, the limits of Mail's wire schema.

Checks and lists:

- The event handlers also check the structure of what an event gives. These events are rejected with `invalid_event`, beside the plan's list:
  - a second `repair.completed` on one claim;
  - an offer with a valuation of zero or less, a payoff below zero, or a payoff that does not fit the vehicle (a payoff needs a lienholder, and a lienholder needs a payoff);
  - an estimate line with an amount of zero or less;
  - a determination that names no line, or one line twice;
  - a line decision that is approved with no amount or with an amount of zero or less, or denied with no reason or with an amount;
  - a `dispute.decided` that is `changed` with no line decision, or `upheld` with one;
  - a payment to a shop with no name;
  - a request with two asks with one key.
- `validateSeed` checks more than the plan's list. The added checks are structure rules: they keep the records of a seed consistent with each other. For example it rejects a claim filed before its loss, offers or line decisions that are not in order of time, a rental period on a policy with no rental benefit, an open dispute on a decision that a newer decision replaced, and an activity row that names an object that does not exist. A seed can still hold history that the App itself would refuse to write, for example a claim filed after its last day to file. The rules do not compare stored times with the clock.
- A stored list that calls can grow has no upper bound in the seed schema, so no write of the Agent and no event can fail at a limit. One call is limited by its input schema, for example 20 evidence items or 60 estimate lines.
- The flags `lines_pending` and `lines_denied` are shown on both paths. On the `total_loss` path the lines stay as history, and the flags still say what that history holds.

## Package map

```text
app.json                     Package identity, entrypoints and capabilities
tools.json                   Agent operations and input/output schemas
service.cjs                  Public MCP launcher (platform-provided entry)
plugin.cjs                   Standard hooks delegating to src/
src/                         Rules, views, operations, events, notification text and day arithmetic
schemas/                     Seed, state and event rules, Mail's wire schema and copied public contracts
contribution/                Capabilities, the publish declaration, empty media catalog and provenance
infra/                       Infra-run Mail sender and an example Router grant
fixtures/                    Initial records, account bindings, policy and clock
examples/run.cjs             Runnable event example without a host
examples/scenario.json       Input to an Infra event injection, not an automatic scheduler
examples/task-data/          Replaceable task seed, binding and policy examples
tests/                       App-only tests and harness, schema validator, and two real-runtime scripts
dev/                         Builders for schemas, tools and the fixture, and the fixture consistency check
LICENSE                      MIT for this implementation and synthetic fixtures
```

See the [cross-App guide](../../docs/app-integrations.md) and the [implementation review](../../docs/review/app-implementation.md). The implementation is original PALE code. It copies no policy text, form, logo or brand name.
