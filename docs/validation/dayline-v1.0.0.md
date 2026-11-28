# Dayline 1.0.0: implementation and verification

Owner: @byshail. App `dayline` 1.0.0 under `apps/dayline/`; public runtime 1.6.0, Core API 1.2.0, no App dependencies. It implements the plan in [PR #213](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/213), `proposals/environment/dayline.md` at `7d2c59d544f86d1afaca4bd83e3dc5f409450547`, which the assigned Track reviewer approved for implementation on 2026-11-24 (review "APPROVE", and `/approve-plan` for that commit). The proposal file is unchanged since that commit (blob `3d8e6c04a099a460b7864fd6759af78b54f54edd`). The package is at commit `54af613ecf034e25547a976215bd2c586cbb1b27`; this report is updated in the next commit, which changes only `docs/validation/`. The first submission was `2eb62d9` (package `c4b8fa7`). The second, `5ac38e0` (package `b95b7b2`), and this one answer the v1 review of 2026-11-26 (clock cutoff and evaluation dataset), as described under [Evaluation dataset and clock cutoff](#evaluation-dataset-and-clock-cutoff-added-after-plan-approval-260). `d13ee46` moved the dataset's sha256 into a field the dataset schema allows, and `8d9bd03` made generated editions consistent with the fixture: the 2026 Gulls schedule after Oct. 13, the 2025 stamp increases and the early-October storms. `54af613` makes an agent write that replaces a seeded later read or save report it in the receipt (below). This document records implementation evidence; it claims no acceptance.

Checked on 2026-11-28 (UTC) on macOS 27.2.1 (Darwin arm64) with Node v22.23.2 and v18.20.8. All data is synthetic. The runs used temporary directories and local stdio MCP, with no network, credentials or model API. Versions, the package hash and every count below are in [dayline/index.json](dayline/index.json), next to the raw reports.

**Automated outcome: passed.** Independent reproduction, official CI on the implementation commit and human review are still to come.

## Evidence

| Evidence | Result | What was exercised |
| :--- | :--- | :--- |
| App-only business tests, package alone | 23 passed, on both Node versions | A copy of `apps/dayline/` with nothing beside it, run with only `PATH` and `LANG` set. The tests call the real business functions through an App-only harness that mirrors Core's event handling (the clock moves to the event's time before validation; a failed event rolls back). Every result is checked against `tools.json`, and every refused call or event is checked to leave business data identical |
| Event example and generated files | Passed, on both | `examples/run.cjs` from the package alone. `dev/build-fixtures.cjs`, `dev/build-contracts.cjs` and `dev/build-dataset.cjs`, run in a copy, leave every committed file byte-identical (fixtures, task data, dataset counts, schemas, `tools.json` and the evaluation dataset) |
| Public App verifier | 42 checks passed, on both ([node22](dayline/public-runtime.node22.json), [node18](dayline/public-runtime.node18.json)) | An isolated package copy, then real MCP: discovery without Infra tools, published input and output of the 8 tools the default `scenario` profile lists, the Agent denied all seven Infra operations, history loading and rejection, the declared event with retry and conflict, reset, a separate run and a restarted process |
| CI job, reproduced | `dayline: PASS`, on both | `node runtime/ci/verify-submissions.cjs . <out> a4bce02…`, the command of the `public-runtime` job; it selected `dayline` only (`full: false`) |
| Real-MCP walkthrough | 45 checks passed, 87 calls traced, on both ([node22](dayline/mcp-walkthrough.node22.json), [node18](dayline/mcp-walkthrough.node18.json)) | What the verifier does not exercise for this App: two reader instances (Ana and Ben) with separate state roots, the approved event applied to both, all three write tools, the three approved workflows answered from what each reader saw, replays, `idempotency_conflict`, `stale_version`, rejected events, the task data rebuilt and loaded directly, and reset of data and clock per instance. Every call is joined to run, account, connection and request or event ID |
| Evaluation dataset over real MCP | 20 checks passed, on both ([node22](dayline/dataset-demo.node22.json), [node18](dayline/dataset-demo.node18.json)) | `examples/dataset-demo.cjs` loads `data/evaluation/seed.json`, with the dataset's own `dataset.json` as the bundle dataset, in one `env.load_seed` call at 2025-03-15, queries it, advances the clock with `env.advance_time` to the dataset clock and to 2026-12-31, and queries again: search totals equal the editions added by each clock, the next later edition is `not_found`, history shows nothing later, and advancing time changes no stored record |
| Dataset coverage | 517 distinct dates in 24 of 24 months ([coverage.json](dayline/coverage.json)) | `dev/coverage-report.cjs --json` over the delivered file; details below |
| Repository suite | 22/22 stages passed, on both ([node22](dayline/reference-suite.node22.json), [node18](dayline/reference-suite.node18.json)) | The unchanged public suite (`npm test`) with this package present |
| Independent base validator | Passed, 42 checks ([report](dayline/base-runtime.json)) | An unmodified export of `main` at `a4bce023953061483c41de5a287ba5e43f4a5648`, the PR's base, validated the candidate checkout with its own `runtime/ci/verify-submissions.cjs`; it selected `dayline` only |
| Package identity | `b9845b9cd3b4b34b8cb2f150347e8fc5ca4f61981eb508d316c8df3b76e68c23` | The same package hash in the two verifier reports, the base validator report, the two walkthrough reports and the two dataset reports; git tree `a9c36591d90ca3c143e58649d09d00a968d0f1ee` |
| Human review | Pending | Realism of the editions, bylines and credits, including the generated dataset; that outlets, people, places and teams are fictional |

## Reproduce

From the candidate checkout, with Node 18 or 22 and nothing to install:

```sh
cd apps/dayline && npm test && npm run example && cd ../..
npm run app:verify -- --app apps/dayline --output .artifacts/dayline.json
node runtime/ci/verify-submissions.cjs . .artifacts/submissions a4bce023953061483c41de5a287ba5e43f4a5648
node apps/dayline/examples/mcp-walkthrough.cjs > .artifacts/dayline-walkthrough.json
node apps/dayline/examples/dataset-demo.cjs > .artifacts/dayline-dataset-demo.json
node apps/dayline/dev/coverage-report.cjs
npm test
```

The package alone: copy `apps/dayline/` to an empty directory and run `npm test` and `npm run example` there. To check the generated files, run `npm run build:fixtures`, `npm run build:contracts` and `npm run build:dataset` in a copy and compare it with the original. The independent check, from a separate export of the base revision:

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
| Events | `edition.publish` inserts at the 1-based position among the entries visible at the event time, keeps the relative order of later entries and sets `added_at` to the event time; a pre-declared empty story group stays hidden until its first edition | An unknown story, outlet, credited edition or front page, an out-of-range position, an already-published ID, blank text, a repeated credit or a credit to a later edition: `invalid_event`, state unchanged. The Agent cannot inject events | B3–B4, B11, B19–B20; W3, W10–W13 |
| Core contracts | A committed write → the same `request_id` again → the stored receipt marked `duplicate`, with no new version | Changed input: `idempotency_conflict`. An old version: `stale_version`. The default `scenario` policy exposes the 8 reads and denies the writes. The Agent calling any Infra operation: `permission_denied` | B7–B8; W1–W3, W6, W9–W10, W32–W36; verifier |
| Seeds, reset and records | `examples/task-data` (Ben, 26 editions, 07:20) equals the minimal catalog plus the event, rebuilt through MCP, and loads directly with its own `dataset.json` → reset restores the loaded editions, history, bookmarks, front pages and clock of that instance | Inconsistent seeds are refused (`invalid_seed`). A seed loaded before its latest record still loads, because Core validates package fixtures at registration under the registry clock; Dayline then shows only what existed at the clock, a read or write on a later edition is `not_found` and changes nothing, and moving the clock reveals the later records without changing any | B10, B17–B18, B21–B23; W15–W18, W42–W45; dataset demo |

## Evaluation dataset and clock cutoff (added after plan approval, #260)

The plan was approved on 2026-11-24. On 2026-11-25, #260 added the Environment dataset rule (`docs/submission-evidence.md`, section 3). The v1 review of 2026-11-26 asked for an enforceable clock cutoff with an early-clock regression, and for a separately loadable dataset with reproducible counts. Both are in this revision and are recorded here as additions to the approved scope.

**Clock cutoff.** Every read and write goes through `catalog.visible(data, ctx.virtual_now)`. An edition exists from its `added_at`, a reading-history entry from its `read_at` and a bookmark from its `saved_at`. A later edition is `not_found` to `edition.get`, `story.get` (when the group has no visible edition), the write tools and search; front pages and `entry_count` skip it. Nothing is stored: `env.advance_time` or an event moves the clock and the later records appear, with no record changed (B17, dataset demo). An agent read or save that precedes a seeded later one replaces it (B18), and the write reports that: its receipt's `later_history_removed` counts the replaced entries by list (`{"reading_history": 1}`), the diagnostics log keeps the stored entry, and it is `null` otherwise. The receipt holds only the count because it goes to the Agent and the entry is dated after the clock. B23 checks this on the dataset against an independent before/after diff (Feb. 5, 2025 brief read at 22:58, marked read at noon; a Mar. 11 story saved the next morning, saved at midnight; a never-read edition reports `null`). The README tells Task authors to start at or after the dataset clock, or stage later records as events, when the Agent writes. Event positions count visible entries (B19). The fixtures are unchanged, and the default scene is correctly clocked, so the walkthrough's 45 checks are the same.

**Dataset.** `apps/dayline/data/evaluation/` (version 1.0.0): `seed.json` (600,872 bytes; sha256 in `dataset.json` and `coverage.json`), `binding.json`, `policies.json`, `clock.json` and `dataset.json`, which follows `schemas/dataset.schema.json` (test 22) and records the seed's sha256 under the generated source's `generation.parameters.outputs`. It holds 940 editions from the six outlets in 416 story groups (English and Spanish) and reader Ana Torres's history: 359 reads and 17 saves. The 25 fixture editions, the fixture front pages and Ana's fixture history are included verbatim, and the arcs around them run before and after: the April 2026 flood behind the October rail vote, the Calder budget from January to its Oct. 15 signing, the Velmora race from 2025 to the Dec. 1 inauguration, the 2025 stamp increases behind October's "third increase in two years", the early-October storms, two Gulls seasons ending with the fixture's October schedule, councils, schools, weather and the Spanish-language Costa Norte. The dataset clock is the fixture clock, 07:00 Pacific on Oct. 14, 2026. Ana's history ends there; catalog editions continue to Dec. 31 and appear as the run clock reaches them, so they are never pre-session history.

**Coverage**, counted by `dev/coverage-report.cjs` in America/Los_Angeles on each record's own date field (`published_at` for editions, `read_at`, `saved_at`; stories, outlets and front pages are not counted):

| Source | Records | Distinct dates | Earliest | Latest |
| --- | ---: | ---: | --- | --- |
| Capitol Courier editions | 96 | 84 | 2025-01-02 | 2026-12-29 |
| El Faro del Litoral editions | 151 | 142 | 2025-01-02 | 2026-12-25 |
| Harbor Ledger editions | 295 | 231 | 2025-01-22 | 2026-12-31 |
| The National Standard editions | 76 | 74 | 2025-01-03 | 2026-12-21 |
| Tallywire editions | 123 | 109 | 2025-01-03 | 2026-12-16 |
| Valley Daily editions | 199 | 172 | 2025-01-04 | 2026-12-28 |
| Reading history (`read_at`) | 359 | 264 | 2025-01-02 | 2026-10-13 |
| Reading list (`saved_at`) | 17 | 16 | 2025-03-12 | 2026-10-13 |
| **All sources, deduplicated** | 1,316 | **517** | 2025-01-02 | 2026-12-31 |

Every month of the window has records (fewest: 13 distinct dates); the longest stretch with no record is 5 days. 467 of the 517 dates fall on or before the dataset clock. The month table, the provenance split and the content checks are in [coverage.json](dayline/coverage.json). No record falls outside the window or lacks a valid date.

**Provenance.** Every record is synthetic: 30 are the authored fixture records, and the rest were written by `dev/build-dataset.cjs` from templates with a fixed random seed. Rerunning it gives byte-identical files. The approved design uses invented outlets, places and people, so there is no real website to anchor in November 2026, and nothing was collected from real sources. Member papers and Tallywire republish 27 editions word for word with a credit; 0 other editions share a text, and 0 other pairs share 80% or more of their word 5-grams (highest 0.75). New team and place names were checked by web search for exact matches in the same domain on 2026-11-26; none was found.

**Added scope against the approval baseline:** the dataset and its three scripts; the clock cutoff, which replaces the write-only `invalid_state` check; and a larger package: 980,866 bytes of tracked files under `apps/dayline/`, up from 253,604, mostly `data/evaluation/seed.json`.

## Plan and implementation

Everything in the plan's first version is implemented: the 11 operations it describes (8 reads, 3 writes), the `edition.publish` event, the state and lifecycle rules, the fixture for one reader, task data for a second reader, and evidence for the three example requests. The README has the operation list, the rules, the data a task can use for each workflow and a quality-check-to-evidence table.

The plan's open question was settled in review: Dayline is a standalone package rather than an extension of Belltower (#172).

Where the implementation adds to the plan's wording:

- `dayline.search` is case- and accent-insensitive, and each query word must match the start of a word. There is no ranking or stemming.
- A story group with no edition is hidden from the Agent, so a task can declare a group for a later event without revealing it.
- Saving an already-saved edition or marking an already-read one succeeds with `changed: false`. Removing an edition that is not saved returns `not_found`.
- Dayline does not compare seed dates with the clock, because Core validates package fixtures when it registers them, under the registry's own clock. Instead, every tool shows only records dated at or before the run clock. The first submission let reads see later editions and refused only writes, with `invalid_state`; that check is gone because a later edition is now `not_found`.
- `front_page` and `position` in an event must be supplied together.
- Core's policy `constraints.ids` compares an `id` argument, and Dayline's tools take `edition_id`, `story_id` or `front_page_id`. Tasks restrict access with the `allow` list.
- The walkthrough's reference replies are evidence for the data and tools, not model trials. Code assembles the morning briefing from tool output. The travel and sports replies use hand-written wording, with outlet names, the saved edition ID and the converted game time filled in from tool results; checks compare each reply's facts with the editions the reader opened. The report's `reference_reply_sources` says which reply is which.

## Package boundary

The package imports only Node built-ins and its own files. `service.cjs` is the provided launcher and the only file that loads the runtime. The optional diagnostics adapter carries IDs only and cannot change business results (B14). `tests/schema-validator.cjs` is a copy of the public validator. The walkthrough finds the runtime by walking up to the checkout, or through `PALE_RUNTIME_ROOT`. Only `apps/dayline/` and this report are added; no registry or runtime file is changed.

## Data and licence

`fixtures/minimal.json` (28 KB) holds 25 editions in 9 story groups from 6 invented outlets, in English and Spanish, with one reader's history and reading list. `examples/task-data/` holds the second reader's seed, binding, policies and dataset (26 editions). `dev/build-fixtures.cjs` rebuilds both. `data/evaluation/` holds the 2025-2026 evaluation dataset described above, rebuilt by `dev/build-dataset.cjs`. All text is original and fictional; nothing was crawled, copied, translated or adapted, and provenance is in `contribution/dataset.json`. There are no media assets. Code and fixtures are under the repository's MIT License. The code, fixtures and this report were prepared with AI assistance (Claude); the author reviews them and is accountable for them.

In `dayline/reference-suite.node*.json`, report paths inside stage commands were rewritten from a local temporary directory to `.artifacts/`. No other report was edited.

## Not claimed, and what remains

- No agent trials or model runs.
- No GUI or reviewer console: MCP is the declared interface, as approved.
- No production deployment.
- Remaining: independent maintainer reproduction and acceptance, official PR CI on the implementation commit (`public-runtime (18)`, `public-runtime (22)`, `base-runtime-compatibility`; the fork's workflow run awaits maintainer approval), and human review of realism, including the generated dataset, and of the invented outlets, places and names.
