# Dayline 1.0.0: implementation and verification

Owner: @byshail. App `dayline` 1.0.0 under `apps/dayline/`; public runtime 1.6.0, Core API 1.2.0, no App dependencies. It implements the plan in [PR #213](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/213), `proposals/environment/dayline.md` at `7d2c59d544f86d1afaca4bd83e3dc5f409450547`, which the assigned Track reviewer approved for implementation on 2026-11-24 (review "APPROVE", and `/approve-plan` for that commit). The proposal file is unchanged since that commit (blob `3d8e6c04a099a460b7864fd6759af78b54f54edd`). The package is at commit `c4b8fa7cbecacfceeaa3e5a0814217fedc5d2682`; this report is added in the next commit, which changes only `docs/validation/`. This document records implementation evidence; it claims no acceptance.

Checked on 2026-11-25 (UTC) on macOS 27.2.1 (Darwin arm64) with Node v22.23.2 and v18.20.8. All data is synthetic. The runs used temporary directories and local stdio MCP, with no network, credentials or model API. Versions, the package hash and every count below are in [dayline/index.json](dayline/index.json), next to the raw reports.

**Automated outcome: passed.** Independent reproduction, official CI on the implementation commit and human review are still to come.

## Evidence

| Evidence | Result | What was exercised |
| :--- | :--- | :--- |
| App-only business tests, package alone | 19 passed, on both Node versions | A copy of `apps/dayline/` with nothing beside it, run with only `PATH` and `LANG` set. The tests call the real business functions through an App-only harness that mirrors Core's event handling (the clock moves to the event's time before validation; a failed event rolls back). Every result is checked against `tools.json`, and every refused call or event is checked to leave business data identical |
| Event example and generated files | Passed, on both | `examples/run.cjs` from the package alone. `dev/build-fixtures.cjs` and `dev/build-contracts.cjs`, run in a copy, leave every committed file byte-identical (fixtures, task data, dataset counts, schemas and `tools.json`) |
| Public App verifier | 42 checks passed, on both ([node22](dayline/public-runtime.node22.json), [node18](dayline/public-runtime.node18.json)) | An isolated package copy, then real MCP: discovery without Infra tools, published input and output of the 8 tools the default `scenario` profile lists, the Agent denied all seven Infra operations, history loading and rejection, the declared event with retry and conflict, reset, a separate run and a restarted process |
| CI job, reproduced | `dayline: PASS`, on both | `node runtime/ci/verify-submissions.cjs . <out> a4bce02…`, the command of the `public-runtime` job; it selected `dayline` only (`full: false`) |
| Real-MCP walkthrough | 45 checks passed, 87 calls traced, on both ([node22](dayline/mcp-walkthrough.node22.json), [node18](dayline/mcp-walkthrough.node18.json)) | What the verifier does not exercise for this App: two reader instances (Ana and Ben) with separate state roots, the approved event applied to both, all three write tools, the three approved workflows answered from what each reader saw, replays, `idempotency_conflict`, `stale_version`, rejected events, the task data rebuilt and loaded directly, and reset of data and clock per instance. Every call is joined to run, account, connection and request or event ID |
| Repository suite | 22/22 stages passed, on both ([node22](dayline/reference-suite.node22.json), [node18](dayline/reference-suite.node18.json)) | The unchanged public suite (`npm test`) with this package present |
| Independent base validator | Passed, 42 checks ([report](dayline/base-runtime.json)) | An unmodified export of `main` at `a4bce023953061483c41de5a287ba5e43f4a5648`, the PR's base, validated the candidate checkout with its own `runtime/ci/verify-submissions.cjs`; it selected `dayline` only |
| Package identity | `5f5c19df1164cd72d6bc39ff956dd1e25fe023636a0b86a9fd46113ac89e5803` | The same package hash in the two verifier reports, the base validator report and the two walkthrough reports; git tree `ddeea80dfec5d3725bafcd2960a47ae8face9663` |
| Human review | Pending | Realism of the editions, bylines and credits; that outlets, people, places and teams are fictional |

## Reproduce

From the candidate checkout, with Node 18 or 22 and nothing to install:

```sh
cd apps/dayline && npm test && npm run example && cd ../..
npm run app:verify -- --app apps/dayline --output .artifacts/dayline.json
node runtime/ci/verify-submissions.cjs . .artifacts/submissions a4bce023953061483c41de5a287ba5e43f4a5648
node apps/dayline/examples/mcp-walkthrough.cjs > .artifacts/dayline-walkthrough.json
npm test
```

The package alone: copy `apps/dayline/` to an empty directory and run `npm test` and `npm run example` there. To check the generated files, run `npm run build:fixtures` and `npm run build:contracts` in a copy and compare it with the original. The independent check, from a separate export of the base revision:

```sh
node runtime/ci/verify-submissions.cjs /path/to/candidate /path/to/reports a4bce023953061483c41de5a287ba5e43f4a5648
```

The base export was not modified and nothing in it came from the candidate.

## Workflow evidence

Each row: starting state → action → observed result, then a control that must leave state unchanged. "B" numbers are the business tests in `apps/dayline/tests/business.test.cjs`, in run order; "W" numbers are the walkthrough checks in the reports above. The fixture reader is Ana Torres at Wednesday, Oct. 14, 2026, 07:00 Pacific; the task-data reader is Ben Ikeda at 07:20, after the approved event.

| Workflow | Starting state → action → observed result | Failure or control | Where |
| :--- | :--- | :--- | :--- |
| Morning briefing | Ana read the rail-vote wire dispatch last night. Infra applies the approved `edition.publish` (`rail-local-2` at position 1 of `local`, at 07:10) → the Valley page reads `rail-local-2`, `library-1`, then the reprint `rail-local-1`, and story `rail-funding` holds the preview, the dispatch, two identical reprints and the expanded edition. A scripted reference agent picks one unread development per page → Ana's local item is the Eastbank interview, crediting the wire; Ben, who already read it, gets the library story | Opening editions to build the briefing leaves Ana's history unchanged. No briefing spends a slot on a reprint whose text equals an edition the reader read | B1–B3, B5; W4–W9, W19–W25 |
| Family travel | The national headline names no airports → search "Puerto Claro" finds the English wire `strike-wire-1`, whose credit leads to the Spanish regional report `strike-faro-1` → both give all of Friday, Oct. 16 from 00:00 at San Telmo and Bahía Honda, and Puerto Claro unresolved. One story group is reached from the world and transport sections | The reply names the source outlet, leaves Puerto Claro unresolved and promises nothing about the flight | B6, B12, B16; W26–W30 |
| Sports without spoilers | Ana asks to keep the game for later → `dayline.saved.add` on the full recap returns `{edition_id, saved, changed}` with no headline → the reading list holds it once. The schedule edition gives the next game, Friday, Oct. 16, 7:10 p.m. CDT, shown as 5:10 PM PDT in the reader's time zone | An identical retry is a `duplicate`; the same `request_id` for another edition is `idempotency_conflict`; saving again with a new request is `changed: false`; a stale `expected_version` is `stale_version`. The reply and link text carry no result. Writes that share the session clock list latest first | B7, B13, B15; W31–W39 |
| Private state across readers | Two instances load the same catalog → Infra applies the same event to both → identical catalogs; Ben's `mark_read` and Ana's save stay in their own instance | Resetting Ana leaves Ben's history intact | B9; W14, W40–W41, W45 |
| Events | `edition.publish` inserts at the 1-based position, keeps the relative order of later entries and sets `added_at` to the event time; a pre-declared empty story group stays hidden until its first edition | An unknown story, outlet, credited edition or front page, an out-of-range position, an already-published ID, blank text, a repeated credit or a credit to a later edition: `invalid_event`, state unchanged. The Agent cannot inject events | B3–B4, B11, B18; W3, W10–W13 |
| Core contracts | A committed write → the same `request_id` again → the stored receipt marked `duplicate`, with no new version | Changed input: `idempotency_conflict`. An old version: `stale_version`. The default `scenario` policy exposes the 8 reads and denies the writes. The Agent calling any Infra operation: `permission_denied` | B7–B8; W1–W3, W6, W9–W10, W32–W36; verifier |
| Seeds, reset and records | `examples/task-data` (Ben, 26 editions, 07:20) equals the minimal catalog plus the event, rebuilt through MCP, and loads directly with its own `dataset.json` → reset restores the loaded editions, history, bookmarks, front pages and clock of that instance | Inconsistent seeds are refused (`invalid_seed`). A seed loaded before its latest record still loads, because Core validates package fixtures at registration under the registry clock; a private write on a later edition then fails with `invalid_state` and changes nothing | B10, B17, B19; W15–W18, W42–W45 |

## Plan and implementation

Everything in the plan's first version is implemented: the 11 operations it describes (8 reads, 3 writes), the `edition.publish` event, the state and lifecycle rules, the fixture for one reader, task data for a second reader, and evidence for the three example requests. The README has the operation list, the rules, the data a task can use for each workflow and a quality-check-to-evidence table.

The plan's open question was settled in review: Dayline is a standalone package rather than an extension of Belltower (#172).

Where the implementation adds to the plan's wording:

- `dayline.search` is case- and accent-insensitive, and each query word must match the start of a word. There is no ranking or stemming.
- A story group with no edition is hidden from the Agent, so a task can declare a group for a later event without revealing it.
- Saving an already-saved edition or marking an already-read one succeeds with `changed: false`. Removing an edition that is not saved returns `not_found`.
- Dayline does not compare seed dates with the clock, because Core validates package fixtures when it registers them, under the registry's own clock. Instead, a private write on an edition dated after the run clock fails with `invalid_state`.
- `front_page` and `position` in an event must be supplied together.
- Core's policy `constraints.ids` compares an `id` argument, and Dayline's tools take `edition_id`, `story_id` or `front_page_id`. Tasks restrict access with the `allow` list.
- The walkthrough's reference replies are evidence for the data and tools, not model trials. Code assembles the morning briefing from tool output. The travel and sports replies use hand-written wording, with outlet names, the saved edition ID and the converted game time filled in from tool results; checks compare each reply's facts with the editions the reader opened. The report's `reference_reply_sources` says which reply is which.

## Package boundary

The package imports only Node built-ins and its own files. `service.cjs` is the provided launcher and the only file that loads the runtime. The optional diagnostics adapter carries IDs only and cannot change business results (B14). `tests/schema-validator.cjs` is a copy of the public validator. The walkthrough finds the runtime by walking up to the checkout, or through `PALE_RUNTIME_ROOT`. Only `apps/dayline/` and this report are added; no registry or runtime file is changed.

## Data and licence

`fixtures/minimal.json` (28 KB) holds 25 editions in 9 story groups from 6 invented outlets, in English and Spanish, with one reader's history and reading list. `examples/task-data/` holds the second reader's seed, binding, policies and dataset (26 editions). `dev/build-fixtures.cjs` rebuilds both. All text is original and fictional; nothing was crawled, copied, translated or adapted, and provenance is in `contribution/dataset.json`. There are no media assets. Code and fixtures are under the repository's MIT License. The code, fixtures and this report were prepared with AI assistance (Claude); the author reviews them and is accountable for them.

In `dayline/reference-suite.node*.json`, report paths inside stage commands were rewritten from a local temporary directory to `.artifacts/`. No other report was edited.

## Not claimed, and what remains

- No agent trials or model runs.
- No GUI or reviewer console: MCP is the declared interface, as approved.
- No production deployment.
- Remaining: independent maintainer reproduction and acceptance, official PR CI on the implementation commit (`public-runtime (18)`, `public-runtime (22)`, `base-runtime-compatibility`; the fork's workflow run awaits maintainer approval), and human review of realism and of the invented outlets, places and names.
