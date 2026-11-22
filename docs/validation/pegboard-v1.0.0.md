# Pegboard 1.0.0: implementation and verification

Owner: Ming Yin (@mingyin1). App `pegboard` 1.0.0 under `apps/pegboard/`; public runtime 1.6.0, Core API 1.2.0; Mail 1.3.0 for the optional notification flow. It implements the plan in [PR #173](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/173), `proposals/environment/pegboard.md` at `aa98311bef207f31440e1d67082580b519d5f752`, which was approved for implementation on 2026-11-22 (`/approve-plan`, recorded 01:52:53 UTC). The proposal file is unchanged since that commit. This document records implementation evidence; it claims no acceptance.

Checked on 2026-11-22 (UTC) on Linux x86_64 with Node v22.23.4 and v18.20.8. All data is synthetic. The runs used temporary directories and local stdio MCP, with no network, credentials or model API. Versions, the package hash and every count below are in [pegboard/index.json](pegboard/index.json), next to the raw reports.

**Automated outcome: passed.** Independent reproduction, official CI on the implementation commit and human review are still to come.

## Evidence

| Evidence | Result | What was exercised |
| :--- | :--- | :--- |
| App-only business tests, package alone | 22 passed, 2 skipped, on both Node versions | A copy of `apps/pegboard/` with nothing beside it. The tests call the real business functions and check every argument, result and state against `tools.json` and the seed schema. They include 199 refused calls and events, each checked to leave business data identical, with every one of the 15 App errors among them. The 2 skipped tests are the real-MCP scripts, which need the runtime |
| The same tests in the checkout | 24 passed, on both | With `PALE_RUNTIME_ROOT` set, T18 and T16b run the two real-MCP scripts below |
| Event example, fixture check, generated contracts | Passed, on both | `examples/run.cjs` from the package alone; `dev/check-fixture.cjs`; `dev/build.cjs --check`; `dev/build-fixture.cjs --check` |
| Seeded random walks | 30 walks (4,800 operations) on Node 22 and 10 walks (1,600) on Node 18, no failure ([node22](pegboard/random-walk.node22.json), [node18](pegboard/random-walk.node18.json)) | `dev/walk.cjs` from the package alone: every write, every event and the clock in random order, with manager approval on and off, with and without a personal cap, and with a 24-hour and a two-hour cut-off. Each argument, result and resulting state is checked against the contracts and the seed rules, every refusal must be a declared error, and every fourth step reads are compared with each other |
| Public App verifier | 55 checks passed, on both ([node22](pegboard/public-runtime.node22.json), [node18](pegboard/public-runtime.node18.json)) | An isolated package copy, then real MCP: discovery without Infra tools, published input and output of 21 tools, the Agent denied all seven Infra operations, history loading and rejection, a declared event with retry and conflict, reset, a separate run and a restarted process |
| Package real-MCP script | 108 checks passed, on both ([node22](pegboard/mcp-integration.node22.json), [node18](pegboard/mcp-integration.node18.json)) | What the verifier does not exercise for this App: all 22 tools through MCP, policy narrowing by tool, object and field, all 15 App errors by name, replays and how they are recorded, stale versions, failure atomicity, rejected events, time moved with `env.advance_time` and no App event, a task seed with its own `virtual_now`, and reset to the loaded seed and time |
| Pegboard → Mail | 29 checks passed, on both ([node22](pegboard/mail-integration.node22.json), [node18](pegboard/mail-integration.node18.json)) | The real Mail package as receiver through public Messaging: the committed receipt, the message the Mail Agent reads, a held notification published only after `env.advance_time`, an identical retry, changed content, a forged source, another message type, a missing grant, no Mail account bound for the person, email notices off, no write-back into Pegboard, and a reset of Pegboard that leaves Mail's records |
| Package and runtime only | Passed, on both | A copy that holds only `apps/pegboard/` and `runtime/` starts the App through its launcher and passes the 108 real-MCP checks |
| Repository suite | 22/22 stages passed, on both ([node22](pegboard/reference-suite.node22.json), [node18](pegboard/reference-suite.node18.json)) | The unchanged public suite (`npm test`) with this package present; `runtime/sdk/sync.cjs --check` and `runtime/build-contracts.cjs --check` also pass |
| Independent base validator | Passed, 55 checks ([report](pegboard/base-runtime.json)) | An unmodified checkout of `main` at `61b637164e4abddf81536bb48935cdb688a69ff1` validated the candidate package with `runtime/ci/verify-submissions.cjs`; it selected `pegboard` only |
| Package identity | `65c57b8e0fcfa0402d37063ce2b849ea6737831b420a8cf7382b3a1f068217a0` | The same package hash in the two verifier reports and the base validator report; git tree `80da54f46ac2f584168cb670f3caf020cfeaaf31` |
| Human review | Pending | Realism of the schedule and the policy values, notification wording, and that the workplace and people are fictional |

## Reproduce

From the candidate checkout, with Node 18 or 22 and nothing to install:

```sh
cd apps/pegboard && npm test && npm run example && npm run check:fixture && npm run check:contracts && npm run check:walk && cd ../..
npm run app:verify -- --app apps/pegboard --output .artifacts/pegboard.json
node apps/pegboard/tests/mcp.integration.cjs --runtime runtime --report .artifacts/pegboard-mcp.json
node apps/pegboard/tests/mail.integration.cjs --runtime runtime --report .artifacts/pegboard-mail.json
npm test
```

The package alone: copy `apps/pegboard/` to an empty directory and run `npm test` and `npm run example` there. The independent check, from a separate checkout of the base revision:

```sh
node runtime/ci/verify-submissions.cjs /path/to/candidate /path/to/reports 61b637164e4abddf81536bb48935cdb688a69ff1
```

The base checkout was not modified and nothing in it came from the candidate.

## Workflow evidence

Each row: starting state → action → observed result, then a control that must leave state unchanged. The App-only tests are in `apps/pegboard/tests/business.test.cjs`; "MCP" is `tests/mcp.integration.cjs` and "Mail" is `tests/mail.integration.cjs`. The account holder is Noor, an hourly employee with a personal cap of 24 hours; the fixture clock is Saturday 21 November 2026, 18:00.

| Workflow | Starting state → action → observed result | Failure or control | Where |
| :--- | :--- | :--- | :--- |
| W1 Schedule and hours | The week of 23 November is posted → `shifts.list` returns her four shifts with no flags and `hours.summary` 20 of 24 hours with an estimated pay of 336.00. The manager moves Monday's open from 06:00 to 05:00, nine hours after Sunday's close ends → the change is applied, the shift reads `short_rest` and its history has the new row. `eligibility.check` on the open six-hour Wednesday shift → `eligible: false`, `over_hours`, 26 hours as the result | An unknown shift or person: `not_found`. A window that ends before it starts: `invalid_window`. State is byte-identical after every read, `eligibility.check` included. A cancelled shift counts nowhere | T01–T05; MCP |
| W2 Availability, time off and preferences | `availability.update` marks Thursday 09:00–13:00 → her Thursday 08:00–14:00 shift reads `outside_availability` and nothing is rescheduled. `time_off.request` for 12–13 December, 21 days ahead → `pending`; `time_off.decided` with `approve` → `approved`; a shift the manager later assigns her on 12 December reads `during_time_off` | Five days ahead: `too_late`. A day on which she holds a shift: `shift_assigned`. Days of another pending or approved entry: `conflict`. More than 30 days, or already begun: `invalid_window`. Cancelling a closed entry: `invalid_state`. A pending entry reads `expired` when its first day begins, and a decision after that is `invalid_event` | T06, T07; MCP |
| W3 Getting a shift covered | `handoffs.cover` for Thursday's shift to Tomas → `awaiting_coworker`, the shift still hers; `handoff.answered` with `accept` → `awaiting_manager`; `handoff.decided` with `approve` → `approved`, the shift is Tomas's with one new history row. A trade exchanges both shifts in one event. A release approved by the manager leaves the shift open. A coworker's request arrives → `awaiting_me`; `handoffs.respond` accepts or declines it | Kai, who is not a barista: `not_qualified`. Tomas, who works at that time: `overlap`. Ines, who closes at 21:00 the evening before a 06:00 open: `short_rest`. A coworker at their cap: `over_hours`. Twenty hours before the start under a 24-hour cut-off: `too_late`. A second handoff on the same shift: `already_requested`. When two apply, the first in the documented order is returned. Accepting Ada's Sunday open would take Noor to 26 hours: `over_hours` | T08–T12; MCP |
| W4 Open shifts | With 20 of 24 hours the open Wednesday shift is refused (`over_hours`). After Friday's close has been released and approved, `eligibility.check` returns `eligible: true`; `handoffs.pickup` → `awaiting_manager`, then `approved` and the shift is hers at 22 hours. Where the workplace asks for no approval, the pickup is `approved` at once | A shift that is not open: `not_open`. Her own pending pickup again: `already_requested`. Withdrawn or denied: the shift stays open | T13; MCP |
| Void and expiry | A pending cover, trade or pickup → the manager changes, reassigns or cancels a shift it names → the handoff is `void` and nothing changed hands. A handoff still pending at its cut-off reads `expired` | An answer, decision, withdrawal or cancellation after that is refused (`invalid_event`, `invalid_state`). Closed and expired handoffs are not voided | T14; MCP |
| Events and notifications | Each of the eight events → one activity row for the event and one for each effect. One notification for each event that concerns the account holder, held until 07:00 when written in quiet hours unless it is about a shift that starts within 12 hours. The proposal's example event produces the proposal's example wire message, word for word (its ID aside) | 62 invalid events (duplicate IDs, unknown references, a shift longer than 16 hours, a change to an ended shift, a request that names the wrong assignee or a shift with a pending handoff, answers and decisions in the wrong state): `invalid_event`, state unchanged. Her own writes and events about other people's shifts write no notification | T15, T16 |
| The platform clock | A held notification, three pending handoffs, a pending time-off entry and an upcoming shift → Infra moves time with `env.advance_time`, no App event → the notification reads `released` and the sender publishes it, the handoffs and the entry read `expired` at their cut-off and first day, the shift reads `started` and then `ended` and can no longer be handed over | Every clock move leaves business data and the activity log identical. An earlier time: `invalid_time`. The Agent calling `env.advance_time`: `permission_denied` | T17, T17b; MCP; Mail |
| Core contracts | A committed cover request → the same `request_id` again → the stored receipt marked `duplicate`, with no second handoff, no new version, activity row or audit row | Changed input: `idempotency_conflict`. An old version: `stale_version`. A failed call: data and version unchanged, one denial audit row. The Agent calling any Infra operation: `permission_denied` | T18 (MCP) |
| Seeds, reset and records | A task seed with its own `virtual_now` and policy → an Agent write and a clock move → reset → the loaded seed and time again, a new epoch, no clock receipts; another run keeps the package fixture | 70 invalid seeds are refused by the App's rules (`invalid_seed`), among them an approved cover whose shift is still hers, two pending handoffs on one shift and a timestamp without its offset; 11 shapes are refused by the seed schema, among them every stored time-based state. A rejected call, a replay and a time-driven change write no activity row | T19; MCP |
| Optional Mail notifications | The manager changes a shift → the sender publishes the stored wire message → the bound Mail account has one received message with the notification's title and body and a committed receipt; the notification written at 23:10 is published only after the clock passes 07:00 | An identical retry returns the first receipt and leaves one record. Changed content: `idempotency_conflict`. Another source account: `source_identity_mismatch`. Another message type: `invalid_arguments`. No grant: `recipient_not_authorized`. No Mail account bound for the person: `recipient_unavailable`. In each case Mail has no new record. Pegboard's state is identical before and after dispatch | T16b (Mail) |

## Plan and implementation

Everything in the plan's first version is implemented: 22 operations (12 read, 10 write), eight events, the state table and rules of §2, the one eligibility check and the five flags, weekly hours and estimated pay, the notification log with release times, the activity log, the optional send-only Mail notifications with an Infra-run outbound adapter (`infra/sender.cjs`), tests T01–T19, the fixture at the planned scale with its builder and consistency check, and the two real-MCP scripts. The README has the operation list, the rules and a workflow-to-test mapping.

The plan's four open questions were approved with its defaults: fixtures under the repository's MIT terms, a manager's decision applied as given with flags, a cover request to one named coworker, and one workplace per account.

Where the implementation differs from the plan's wording, or adds to it:

- The fixture is a snapshot written by an authoring-time script (`dev/build-fixture.cjs`) that replays a scripted history through the App's own functions. No generator runs at run time, and the tests build their small variations from the fixture in code.
- Five tests beyond T01–T19: T16b (the Mail flow), T17b (a seed notification still held when the seed is loaded), a seeded random walk, a check that contracts, fixture and declarations are in step, and a static check that no import or file path leaves the package.
- The plan lists a timestamp without a UTC offset among the seeds `validateSeed` rejects. The App's rule does reject it (`invalid_seed`); on the host, Core checks `env.load_seed` against the seed schema first and answers `invalid_arguments`, as it does for a stored time-based state. Either way nothing is loaded.
- Two seed rules make "a handoff whose state does not fit the shifts it names" checkable: a shift's history must lead to the shift as it is, and an approved handoff must have a history row on each shift it moved.
- `short_rest` is flagged on both shifts either side of the short rest. A release always goes to the manager, also where `manager_approval` is off, as in the plan's state table. Notification text names people by the first word of their name.
- Notifications that came with a seed are history for the sender, except those still held when the seed was loaded; these are published once their release time has passed.
- In the Mail flow, Infra first loads the account holder's empty mailbox into the run's Mail instance with the run's shared binding. The pinned Mail package ships only its own example account, and the plan's delivery is to "an account that has a Mail account bound in the run".

## Package boundary

The package imports only Node built-ins and its own files; a test scans every script for this. `service.cjs` is the provided launcher. `tests/schema-validator.cjs` is a copy of the public validator, and the real-MCP script checks that it is identical to the one of the runtime in use. The two real-MCP scripts are given the runtime directory (`--runtime` or `PALE_RUNTIME_ROOT`). The Mail flow also needs the package inside a public checkout with the pinned Mail package, because the public Messaging router resolves a publisher package and its receiver registry relative to its own checkout. Only `apps/pegboard/` and this report are added; no registry or runtime file is changed.

## Data and licence

`fixtures/minimal.json` (135 KB, 219 records) is a snapshot of a scripted synthetic history: one invented café with 2 locations, 3 positions and a policy of five values; 10 people; 4 posted weeks with 168 shifts (12 open, 3 cancelled, 16 the account holder's); 3 availability blocks; 5 time-off entries and 14 handoffs that between them cover every kind and state; 16 notifications. `dev/build-fixture.cjs` rebuilds it and `dev/check-fixture.cjs` checks it independently, including that the only flag present is the one it is meant to show. Nothing was crawled or copied; provenance is in `contribution/dataset.json`. There are no media assets. Code and fixtures are under the repository's MIT License. The code, fixtures and this report were prepared with AI assistance (Claude); the author reviews them and is accountable for them.

## Not claimed, and what remains

- No agent trials or model runs.
- No GUI, no manager's console and no Web/CUA adapter: the first version is MCP only, as planned.
- Mail is the only connected App, and the delivery check uses the public Messaging router with a local Infra config. Production Messaging credentials are a platform matter.
- Remaining: independent maintainer reproduction and acceptance, official PR CI on the implementation commit (`public-runtime (18)`, `public-runtime (22)`, `base-runtime-compatibility`), and human review of realism and of the invented workplace and names.
