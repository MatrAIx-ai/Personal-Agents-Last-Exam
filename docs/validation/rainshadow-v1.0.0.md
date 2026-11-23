# Rainshadow 1.0.0: implementation and verification

Owner: Ming Yin (@mingyin1). App `rainshadow` 1.0.0 under `apps/rainshadow/`; public runtime 1.6.0, Core API 1.2.0; Mail 1.3.0 for the optional notice flow. It implements the plan in [PR #123](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/123), `proposals/environment/rainshadow.md` at `d08ce78fd3b8939c554dcf4e6f8dff683d906943`, which was approved for implementation on 2026-11-22 (`/approve-plan`, recorded 22:24:35 UTC). The proposal file is unchanged since that commit. This document records implementation evidence; it claims no acceptance.

Checked on 2026-11-23 (UTC) on Linux x86_64 with Node v22.23.4 and v18.20.8. All data is synthetic. The runs used temporary directories and local stdio MCP, with no network, credentials or model API. Versions, the package hash and every count below are in [rainshadow/index.json](rainshadow/index.json), next to the raw reports.

**Automated outcome: passed.** Independent reproduction, official CI on the implementation commit and human review are still to come.

## Evidence

| Evidence | Result | What was exercised |
| :--- | :--- | :--- |
| App-only business tests, package alone | 21 passed, 2 skipped, on both Node versions | A copy of `apps/rainshadow/` with nothing beside it. The tests call the real business functions and check every argument, result and state against `tools.json` and the seed schema. The 2 skipped tests are the real-MCP scripts, which need the runtime |
| The same tests in the checkout | 23 passed, on both | With `PALE_RUNTIME_ROOT` set, T17 and T15b run the two real-MCP scripts below |
| Event example, fixture check, generated contracts | Passed, on both | `examples/run.cjs` from the package alone; `dev/check-fixture.cjs`; `dev/build.cjs --check` |
| Public App verifier | 52 checks passed, on both ([node22](rainshadow/public-runtime.node22.json), [node18](rainshadow/public-runtime.node18.json)) | An isolated package copy, then real MCP: discovery without Infra tools, published input and output of 18 tools, the Agent denied all seven Infra operations, history loading and rejection, a declared event with retry and conflict, reset, a separate run and a restarted process |
| Package real-MCP script | 90 checks passed, on both ([node22](rainshadow/mcp-integration.node22.json), [node18](rainshadow/mcp-integration.node18.json)) | What the verifier does not exercise for this App: all 21 tools through MCP, policy narrowing by tool, object and field, replays and how they are recorded, stale versions, failure atomicity, rejected events, time moved with `env.advance_time` and no App event, a task seed with its own `virtual_now`, and reset to the loaded seed and time |
| Rainshadow → Mail | 25 checks passed, on both ([node22](rainshadow/mail-integration.node22.json), [node18](rainshadow/mail-integration.node18.json)) | The real Mail package as receiver through public Messaging: the committed receipt, the message the Mail Agent reads, a held notice published only after `env.advance_time`, an identical retry, changed content, a forged source, a missing grant, and no write-back into Rainshadow |
| Repository suite | 22/22 stages passed, on both ([node22](rainshadow/reference-suite.node22.json), [node18](rainshadow/reference-suite.node18.json)) | The unchanged public suite (`npm test`) with this package present; `runtime/sdk/sync.cjs --check` and `runtime/build-contracts.cjs --check` also pass |
| Independent base validator | Passed, 52 checks ([report](rainshadow/base-runtime.json)) | An unmodified checkout of `main` at `a4bce023953061483c41de5a287ba5e43f4a5648` validated the candidate package with `runtime/ci/verify-submissions.cjs`; it selected `rainshadow` only |
| Package identity | `3ea5d7bef4548ecd0f314f647b9d0dc39d3b8ecaffcde026aa06ed77f200ced4` | The same package hash in the two verifier reports and the base validator report; git tree `4168a871ae81656d1ef1918e907020aa6c5b3311` |
| Human review | Pending | Realism of forecast numbers, alert and notice wording, and the invented names |

## Reproduce

From the candidate checkout, with Node 18 or 22 and nothing to install:

```sh
cd apps/rainshadow && npm test && npm run example && npm run check:fixture && npm run check:contracts && cd ../..
npm run app:verify -- --app apps/rainshadow --output .artifacts/rainshadow.json
node apps/rainshadow/tests/mcp.integration.cjs --runtime runtime --report .artifacts/rainshadow-mcp.json
node apps/rainshadow/tests/mail.integration.cjs --runtime runtime --report .artifacts/rainshadow-mail.json
npm test
```

The package alone: copy `apps/rainshadow/` to an empty directory and run `npm test` and `npm run example` there. The independent check, from a separate checkout of the base revision:

```sh
node runtime/ci/verify-submissions.cjs /path/to/candidate /path/to/reports a4bce023953061483c41de5a287ba5e43f4a5648
```

The base checkout was not modified and nothing in it came from the candidate.

## Workflow evidence

Each row: starting state → action → observed result, then a control that must leave state unchanged. The App-only tests are in `apps/rainshadow/tests/business.test.cjs`; "MCP" is `tests/mcp.integration.cjs` and "Mail" is `tests/mail.integration.cjs`.

| Workflow | Starting state → action → observed result | Failure or control | Where |
| :--- | :--- | :--- | :--- |
| W1 Places and preferences | Three saved places → search, save a fourth with a label, change its alert rule, remove it → the list and the open-watch counts follow; units, default sources, quiet hours and email notices change one field at a time | Saving twice: `already_saved`. Removing a place with an open watch: `place_in_use`, the place stays. An unknown time zone: `invalid_timezone`. A default source of the wrong kind: `not_found` | T01–T03; MCP |
| W2 Forecast evidence | Three issuances per source and place → hourly, daily and issuance reads → the latest issuance by `issued_at` with its ID and issue time, rows as issued, `coverage.missing` for hours past the horizon; a named earlier issuance is returned with `is_latest: false`; two sources stay separate | An issuance of another place or source, or an unknown place or source: `not_found`. An empty window or one longer than the limit: `invalid_window`. A place the source has no issuance for returns no rows with `coverage.reason: no_issuance`, never another source's forecast. Every read leaves state identical. An issuance that arrives late with an older issue time does not become the latest | T04–T07; MCP |
| W3 Alerts | Six alert threads in every status → list by place and status, read a thread with its messages, acknowledge the latest message → the acknowledgement is stored; an update clears it and writes one notice | Acknowledging an older message: `stale_message`. A second time: `already_acknowledged`. An expired or cancelled thread: `invalid_state`. An update for an unknown thread or with a duplicate message ID: `invalid_event`, state unchanged | T08–T11; MCP |
| W4 Watches and notices | A saved place and a window → create a watch with alternative conditions → evaluated at once, with a record that names the issuances used, the hours and dates covered or missed and what met each condition. A new weather issuance, an air-quality issuance that rises to 110, or an alert message re-evaluates it; a change into `triggered` or back to `clear` writes exactly one notice. In quiet hours the notice gets a release time and reads `held` until then | A window already over or longer than 10 days: `invalid_window`. A 21st open watch: `limit_exceeded`. An ended or cancelled watch cannot be changed: `invalid_state`. An issuance for another place or source, or an Agent edit, writes no notice | T12–T15; MCP; Mail |
| The platform clock | A held notice, 20 open watches and an upcoming alert → Infra moves time with `env.advance_time`, no App event → the notice reads `released` and the sender publishes it, the watches whose window has ended read `ended`, hold no place and no longer count towards the limit, and the alert reads `active` and then `expired` | Every clock move leaves business data and the activity log identical. An earlier time: `invalid_time`. The Agent calling `env.advance_time`: `permission_denied` | T16, T16b; MCP; Mail |
| Core contracts | A committed write → the same `request_id` again → the stored receipt marked `duplicate`, with no new version, activity row or audit row | Changed input: `idempotency_conflict`. An old version: `stale_version`. A failed call: data and version unchanged, one denial audit row. The Agent calling any Infra operation: `permission_denied` | T17 (MCP) |
| Seeds, reset and records | A task seed with its own `virtual_now` → Agent writes and a clock move → reset → the loaded seed and time again, a new epoch, no clock receipts. One activity row for each committed write, each event and each effect of an event | A seed with a dangling reference, a foreign account, a timestamp without an offset or a stored time-based state is rejected and leaves the baseline. A rejected call, a replay and a time-driven change write no activity row | T18; MCP |
| Optional Mail notices | A watch is triggered → the sender publishes the stored wire message → Mail has one received message with the notice's title and body and a committed receipt; the notice written at 23:10 is published only after the clock passes 07:00 | An identical retry returns the first receipt and leaves one record. Changed content: `idempotency_conflict`. Another source account: `source_identity_mismatch`. No grant: `recipient_not_authorized`, and Mail has no record. Rainshadow's state is identical before and after dispatch | T15b (Mail) |

## Plan and implementation

Everything in the plan's first version is implemented: 21 operations (13 read, 8 write), five events, the state table and rules of §2, the notice log with release times, the activity log, the optional send-only Mail notices with an Infra-run outbound adapter (`infra/sender.cjs`), tests T01–T18, the fixture with its generator and consistency check, and the two real-MCP scripts. The README has the operation list, the rules and a workflow-to-test mapping.

Where the implementation differs from the plan's wording, or adds to it:

- The plan lists "one small fixture per test". The tests build their small variations in code from the package fixture, so there are no separate fixture files.
- Five tests beyond T01–T18: T13b (alert messages and results that stand after the last window hour has started), T15b (the Mail flow), T16b (a seed notice still held when the seed is loaded), a check that contracts, fixture and declarations are in step, and a static check that no import or file path leaves the package.
- `watches.create` and `watches.update` answer `invalid_arguments` for `aq_source_id` on a watch without an `aqi` condition, and `not_found` when an `aqi` condition has no air-quality source to use (none named and no account default). Both follow from the plan's rule that a watch stores an air-quality source exactly when it has an `aqi` condition.
- Notices that came with a seed are history for the sender, except those still held when the seed was loaded; these are published once their release time has passed.

Notes from the plan approval, and how they were followed:

- "Pull main and re-run the verifier before you submit": `main` at `a4bce023953061483c41de5a287ba5e43f4a5648` is merged into the branch below the package commit, and every result in this report was produced on that merge. The runtime and Mail versions are the ones the plan names (1.6.0 and 1.3.0).
- "Date the seeded history from 2026-01-01 onward": every record in the fixture is dated between 10 and 26 November 2026.
- Shared field names with #126 (Gustline): nothing changed in Rainshadow. The revised #126 proposal states that Gustline will adopt the same field names where the meaning is the same.

## Package boundary

The package imports only Node built-ins and its own files; a test scans every script for this. `service.cjs` is the provided launcher. `tests/schema-validator.cjs` is a copy of the public validator, and the real-MCP script checks that it is identical to the one of the runtime in use. The two real-MCP scripts are given the runtime directory (`--runtime` or `PALE_RUNTIME_ROOT`). The Mail flow also needs the package inside a public checkout with the pinned Mail package, because the public Messaging router resolves a publisher package and its receiver registry relative to its own checkout. A copy that holds only `apps/rainshadow/` and `runtime/` starts the App through its launcher and passes the 90 real-MCP checks.

## Data and licence

`fixtures/minimal.json` (406 KB, 100 records, all dated in November 2026) is a snapshot of a scripted synthetic history: 2 invented regions in 2 time zones, 6 places, 8 zones, 3 sources, 54 issuances (36 weather, 18 air quality), 12 observations, 6 alert threads with 9 messages, and one account with 3 saved places, 3 watches and 8 notices. `dev/build-fixture.cjs` rebuilds it by replaying that history through the App's own functions and `dev/check-fixture.cjs` checks it independently. Nothing was crawled or copied; provenance is in `contribution/dataset.json`. There are no media assets. Code and fixtures are under the repository's MIT License. The code, fixtures and this report were prepared with AI assistance (Claude); the author reviews them and is accountable for them.

## Not claimed, and what remains

- No agent trials or model runs. The first design review left it to a maintainer whether Environment acceptance needs them.
- No GUI and no Web/CUA adapter: the first version is MCP only, as planned.
- Mail is the only connected App, and the delivery check uses the public Messaging router with a local Infra config. Production Messaging credentials are a platform matter.
- Remaining: independent maintainer reproduction and acceptance, official PR CI on the implementation commit (`public-runtime (18)`, `public-runtime (22)`, `base-runtime-compatibility`), and human review of realism and of the invented names.
