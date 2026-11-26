# Kinodex 1.0.0: implementation and verification

Owner: @byshail. App `kinodex` 1.0.0 under `apps/kinodex/`; public runtime 1.6.0, Core API 1.2.0, no App dependencies. It implements the plan in [PR #226](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/226), `proposals/environment/kinodex.md` at `907cc505306baeca5250f4fadbf50cbed2024659`. The reviewer Chenngzz approved that commit for implementation on 2026-11-24 (`/approve-plan` at 07:08:04 UTC), after a review that recommended scope approval and left three items to resolve during implementation. The proposal file is unchanged since that commit (blob `7eb7aef8ce1cdad0096fa8436e6512c37b65d16c`). The package is at commit `c3031bf725feca240a4dc0dd52db4d29efe419bf`; this report is updated in the next commit, which changes only `docs/validation/`. The first submission was `cfb382e` (package `e2f9deb`); this revision adds the clock cutoff and the [evaluation dataset](#evaluation-dataset-and-clock-cutoff-added-after-plan-approval-260) required since #260. This document records implementation evidence; it claims no acceptance.

Checked on 2026-11-26 (UTC) on macOS 27.2.1 (Darwin arm64) with Node v22.23.2 and v18.20.8. All data is synthetic. The runs used temporary directories and local stdio MCP, with no network, credentials or model API. Versions, the package hash and every count below are in [kinodex/index.json](kinodex/index.json), next to the raw reports.

**Automated outcome: passed.** Independent reproduction, official CI on the implementation commit and human review are still to come.

## Evidence

| Evidence | Result | What was exercised |
| :--- | :--- | :--- |
| App-only business tests, package alone | 38 passed, on both Node versions | A copy of `apps/kinodex/` with nothing beside it, run with only `PATH` and `LANG` set. The tests call the real business functions through an App-only harness that mirrors Core: the clock moves to an event's time before validation, a failed write or event rolls back data and clock, and a read must leave the data byte-identical. Every result is checked against `tools.json`, and every refused call or event is checked to leave business data identical |
| Event example and generated files | Passed, on both | `examples/run.cjs` from the package alone. `dev/build-fixtures.cjs`, `dev/build-contracts.cjs` and `dev/build-dataset.cjs`, run in a copy, leave every committed file byte-identical (both seeds, bindings, policies, clock, the example events, task data, dataset files, schemas and `tools.json`) |
| Public App verifier | 52 checks passed, on both ([node22](kinodex/public-runtime.node22.json), [node18](kinodex/public-runtime.node18.json)) | An isolated package copy, then real MCP: discovery without Infra tools, published input and output of the 18 read tools the default `scenario` profile lists, the Agent denied all seven Infra operations, history loading and rejection, the approved `title.update` example with retry and conflict, reset, a separate run and a restarted process |
| CI job, reproduced | `kinodex: PASS`, on both | `node runtime/ci/verify-submissions.cjs . <out> a4bce02…`, the command of the `public-runtime` job; it selected `kinodex` only (`full: false`) |
| Real-MCP walkthrough | 119 checks passed, 198 calls traced, on both ([node22](kinodex/mcp-walkthrough.node22.json), [node18](kinodex/mcp-walkthrough.node18.json)) | What the verifier does not exercise for this App: two account instances (Dana in the US, Ines in the UK) loaded with the same catalog, catalog events applied to both, the three example requests answered for both accounts, 10 of the 14 write tools and 13 of the 18 reads (the list tools and `alerts.delete` are covered by B10 and B19), a separate controls instance with a task `constraints` policy, two account-change runs separated by reset, clock-only changes, replays, `idempotency_conflict`, `stale_version`, a failed event with its `deny` audit row, and reset of data and clock. Every call is joined to run, account, connection and request or event ID |
| Evaluation dataset over real MCP | 26 checks passed, on both ([node22](kinodex/dataset-demo.node22.json), [node18](kinodex/dataset-demo.node18.json)) | `examples/dataset-demo.cjs` loads `data/evaluation/seed.json` with its own `dataset.json` in one `env.load_seed` request (1,323,136 bytes), queries it at 2025-03-15, advances the clock to the dataset clock and to 2026-12-31 with `env.advance_time`, and queries again; nothing dated after the clock is visible and no record changes |
| Dataset coverage | 606 distinct dates in 24 of 24 months, 459 without scheduled and descriptive dates ([coverage.json](kinodex/coverage.json)) | `dev/coverage-report.cjs --json` over the delivered file; details below |
| Repository suite | 22/22 stages passed, on both ([node22](kinodex/reference-suite.node22.json), [node18](kinodex/reference-suite.node18.json)) | The unchanged public suite (`npm test`) with this package present |
| Independent base validator | Passed, 52 checks ([report](kinodex/base-runtime.json)) | An unmodified export of `main` at `a4bce023953061483c41de5a287ba5e43f4a5648`, the PR's base, validated the candidate checkout with its own `runtime/ci/verify-submissions.cjs`; it selected `kinodex` only |
| Package identity | `a30577050afefa464a4044c35ff8866ab10679c176415c01c73002c9ec5e3ac8` | The same package hash in the two verifier reports, the base validator report, the two walkthrough reports and the two dataset reports; git tree `65e40fba3088ebc3a7b496307bdcc48e2742d5f9` |
| Human review | Pending | Realism of the catalog, guides, offers and the two account histories, including the generated dataset; that titles, people, services and prices are fictional (see the name notes under [Data and licence](#data-and-licence)) |

## Reproduce

From the candidate checkout, with Node 18 or 22 and nothing to install:

```sh
cd apps/kinodex && npm test && npm run example && cd ../..
npm run app:verify -- --app apps/kinodex --output .artifacts/kinodex.json
node runtime/ci/verify-submissions.cjs . .artifacts/submissions a4bce023953061483c41de5a287ba5e43f4a5648
node apps/kinodex/examples/mcp-walkthrough.cjs > .artifacts/kinodex-walkthrough.json
node apps/kinodex/examples/dataset-demo.cjs > .artifacts/kinodex-dataset-demo.json
node apps/kinodex/dev/coverage-report.cjs
npm test
```

The package alone: copy `apps/kinodex/` to an empty directory and run `npm test` and `npm run example` there. To check the generated files, run `npm run build:fixtures`, `npm run build:contracts` and `npm run build:dataset` in a copy and compare it with the original. The independent check, from a separate export of the base revision:

```sh
node runtime/ci/verify-submissions.cjs /path/to/candidate /path/to/reports a4bce023953061483c41de5a287ba5e43f4a5648
```

The base export was not modified and nothing in it came from the candidate.

## Workflow evidence

Each row: starting state → action → observed result, then a control that must leave state unchanged. "B" numbers are the business tests in `apps/kinodex/tests/business.test.cjs` at this revision, in run order (their names also carry the proposal's acceptance IDs T01–T13); "W" numbers are the walkthrough checks in the reports above. The fixture account is Dana Marsh (US; Brightreel and Northcast) at Tuesday, Dec. 1, 2026, 09:00 Pacific; the task-data account is Ines Calloway (UK; Northcast and Kettlewing) on the same catalog.

| Workflow | Starting state → action → observed result | Failure or control | Where |
| :--- | :--- | :--- | :--- |
| Request 1: is *Lantern Hill* OK for Mira? | Guide version 1 rates violence and frightening scenes `mild`. Infra applies the approved `title.update` (`lantern-hill-guide-v2`, Dec. 4, 18:00) → version 2 is current, both categories are `moderate`, the summary is "Sustained child peril.", and version 1 stays readable on request. With `hide_spoilers` the flagged barn item is withheld; an unfiltered read includes it. A scripted reference agent answers on Dec. 5 → Dana: US PG, guide raised, a spoiler detail left out, on Brightreel until 23:59 tonight, then rent-only at $3.99. Ines: UK PG, on her Kettlewing subscription with no end date | The reply contains no barn, fire or trapped detail. Answering changes no diary, rating or watchlist for either account. An unknown title or guide version is `not_found` | B1–B2; W25–W38 |
| Request 2: leaving this week | Dana's 14-title watchlist is at `watchlist_version` 1 → `kinodex.offers.search` on her services → *Copper Sky* (Fri) and *Quiet Harbour* (Sun) are `leaving_soon`; *Fieldglass* leaves Brightreel on Wednesday but stays `available` through Northcast → one save puts the two first, the rest in original order, at `watchlist_version` 2. On Monday the Agent reads the new Core version first, finds both titles gone (*Copper Sky* only a rental), and creates one `available_on_my_services` rule each. A US ads offer on Northcast leaves the rule active; `copper-sky-northcast-return` fires it with the Northcast offer and one notice; the follow-up reply names *Copper Sky* and Northcast. For Ines only *Fieldglass* leaves (Kettlewing UK), and `fieldglass-uk-return` brings it back | A write with session 1's Core version is `stale_version` and stores nothing; the watchlist stays at version 2. *Fieldglass* gets no rule. A second matching event adds no notice. After *Copper Sky* leaves, its US offers on her services are only the $4.99 rental | B5, B9, B16; W8–W15, W39–W61 |
| Request 3: log the trip | The task supplies the trip: three films on the flight on Nov. 26, *Harbor Lights* episodes 1 and 2 at the cabin, with Jules (Ines: with Tomas), and a claimed 142-minute *Salt Year* → five diary entries with the companion in `watched_with`; *The Wrenfield Clock* (logged Nov. 2025) is Dana's one rewatch, *Salt Year* is Ines's; ratings follow each style (Dana half stars, never 5; Ines whole stars); *Salt Year* is logged as the 142-minute extended edition | No correction is submitted for either account, because the 142-minute runtime is already listed as a separate edition. A future `watched_on` is `invalid_date`, and so is a date before release or before the episode aired; 3.3 is `invalid_rating`; an episode of another series is `not_found` | B11–B13; W16–W24, W72–W73 |
| Spoiler-safe reads | Nothing of *Harbor Lights* logged → every synopsis withheld; after logging S1E1 and S1E2, synopses appear up to S1E2 and spoiler guide items stay withheld; deleting the S1E2 entry moves the boundary back to S1E1. Mira keeps no diary: with `as_of_person`, her *Pocket Comets* boundary is episode 4 (Dana's entries with Mira in `watched_with`), Dana's is 5 | An `as_of_person` outside the diary's `watched_with` history is `not_found`. Review text marked `contains_spoilers` is withheld on request | B3–B4, B15; W74–W77 |
| Where to watch, by the clock and by account change | Availability is derived from the clock: an offer passing its end time, entering the seven-day `leaving_soon` window, or an upcoming offer starting all change `offers.search`, while an alert reaching `expires_at` reads `expired`. In separate runs, adding Plumvale or switching to the UK triggers an active *Quiet Harbour* rule with the matching offer, cause `services.update` and the request ID | Time passing writes no activity row, notice or stored status. `services.update` writes no notice, and an identical retry is a duplicate that does not trigger again. A stale account update preserves region, subscriptions, rule state and notices. An unknown service or region is `not_found` | B6–B8; W85–W87, W105–W119 |
| Watchlist, lists and diary edits | Lists keep their own `list_version`; a diary edit changes only the patched fields; deleting an entry returns the rating and review it removed | A stale `expected_watchlist_version` or `expected_list_version` is `object_version_conflict`; a no-op write is `no_change`. A task `constraints` policy denies a `watched_on` patch and accepts a `rating` patch | B9–B10, B14; W66–W67, W71, W75 |
| Alerts | `already_true` while Brightreel still carries *Copper Sky* (the message names the offer; no rule is stored). Item 2: an upcoming Northcast offer for *Ambervane* does not make its rule `already_true`; the clock alone makes the offer `available` while the rule stays `active`; `offer.publish` at the start time fires it once. A `new_season` rule waits for a season added later; `price_below` fires on a *Salt Year* purchase price drop | `duplicate_alert`; `invalid_threshold` for subscription-only *Fieldglass*; `not_active` for triggered, expired and deleted rules; an event at exactly `expires_at` leaves the rule expired and writes no notice | B16–B19; W41, W46, W51–W57, W78–W81, W85, W88–W91, W97–W98 |
| Corrections | 142 minutes proposed for the theatrical edition of *Salt Year* (currently 118) is `submitted`; the verbatim `salt-year-runtime-decision` declines it, and it keeps the decision, note and time. A guide-item correction goes `needs_info` → amended once → `approved`, which adds guide version 2 with one decision notice per decision and a `guide_updated` notice for the watchlist title. The seeded pending credit correction is approved by its full key | 142 minutes for the extended edition is `no_change`; a second open correction on the same target is `already_submitted`; withdrawing a decided correction is `already_decided`. A decision with no open correction, or a short-form reference that matches two, fails with `target_not_found`: `applied: false`, a `deny` audit row, data and clock unchanged, no receipt | B20–B22; W82–W84, W92–W96, W99–W104 |
| Events | All four operations commit at their own `at`, move the clock and, for catalog events, evaluate the affected title's active rules. A guide version for a watchlist title writes one notice; *Lantern Hill*, which is not on the watchlist, writes none | An unknown target is `target_not_found`; an unknown service, a region or type the service lacks, a price on a subscription, a reversed window, an existing season, a skipped guide version or dates that would precede diary entries are `invalid_event`. Each failure leaves data and clock unchanged. History loaded under an earlier clock fails writes and events with App errors (`not_found` for records dated after the clock), never `invalid_seed`; the clock-cutoff tests are B25–B30 | B23–B31; W25–W31, W44–W50 |
| Core contracts | A committed write or event → the same `request_id` or `event_id` again → the stored receipt marked `duplicate`, with no new version | Changed input: `idempotency_conflict`. An old version: `stale_version`. The default `scenario` policy exposes the 18 reads and denies writes. The Agent calling any Infra operation: `permission_denied` | B36; W1–W7, W27, W30–W31, W40, W68–W70, W108, W117; verifier |
| Seeds, reset and records | Both accounts load the same catalog; one activity row per committed write or event, each joined to a Core receipt by `request_id` or `event_id` → reset restores the loaded catalog, account and clock of that instance only | Inconsistent seeds are refused (`invalid_seed`), and seed dates are never compared with the clock, because Core validates package fixtures at registration under the registry clock. The fixtures meet the plan's checks: scale, references, offer windows, diary dates between 2025-01-01 and the clock, Dana's mean rating of 3.4. The second account has its own right answers. Diagnostics carry IDs only | B32–B37; W8, W58–W65, W112–W113 |

## Evaluation dataset and clock cutoff (added after plan approval, #260)

The plan was approved on 2026-11-24; #260 published the Environment data rule on 2026-11-25. This scope was added after the plan was approved, for that rule (`docs/submission-evidence.md` sections 3–4). Package `apps/kinodex`, SHA-256 `a30577050afefa464a4044c35ff8866ab10679c176415c01c73002c9ec5e3ac8`.

**Clock cutoff.** Tools show only the records that exist at `ctx.virtual_now` (`visible` in `src/catalog.cjs`); nothing is stored for it. Diary entries (`logged_at`), public reviews (`posted_at`), lists, alert rules (`created_at`), corrections (`submitted_at`), notices (`at`), seasons with their episodes (`added_at`) and guide versions after the first (`published_at`) are hidden until their time: `not_found` by ID and absent from lists, counts and search. Rule triggers and deletions, and correction decisions, amendments and withdrawals dated after the clock are read as of the clock. Release dates, air dates, offer windows, `expires_at` and guide version 1 stay visible. Current-state objects (account settings, watchlist, list contents, diary edits, catalog values changed by approved corrections) are shown as stored. An agent write or event on a record with a later seeded history replaces that history; events that collide with later seeded catalog records fail with `invalid_event`. The `invalid_date` error for editing a diary entry logged after the clock became `not_found`; no tool schema or error code changed. The full field table is in the App README, "Clock cutoff".

**Dataset.** `apps/kinodex/data/evaluation/seed.json`, version 1.0.0, 1,347,301 bytes (1,318,218 compact), sha256 `95aa56ff242038af932c8332b9bd4a6efb866ccb8759c069f46603f2e7cbbd55`, built by `dev/build-dataset.cjs` (generator seed 20250101; reruns are byte-identical on Node 18 and 22). Shared catalog plus Dana Marsh's account, from `fixtures/minimal.json` with every fixture record, ID and date kept; repeated review texts and generated episode synopses rewritten one per record; added 16 guide versions, 2 seasons (10 episodes), 41 public reviews (2026-10-15 to 2026-12-30), 17 alert rules (12 fired by the offer or season they matched, 2 expired, 2 deleted, 1 waiting), 6 corrections, 18 notices and 3 lists. Dataset clock: 2026-12-01T09:00:00-08:00 (the fixture clock); Dana's history ends there; catalog records continue through December (the last on 2026-12-30). All records are synthetic; the approved design uses an invented catalog, services and people, so there is no real November 2026 anchor.

**Coverage** (`node apps/kinodex/dev/coverage-report.cjs`, America/Los_Angeles, each record's own date field):

| Measure | Value |
| --- | --- |
| Dated records / counted / excluded / invalid | 2,772 / 1,899 / 873 / 0 |
| Global distinct dates (2025-01-02 to 2026-12-30) | 606, in 24 of 24 months; 585 on or before the clock; no record on the endpoints 2025-01-01 and 2026-12-31 |
| Longest gap | 3 days |
| Distinct dates without offer windows, air dates and release dates | 459 (longest gap 6 days) |
| Dana's history (diary and account records) | 286 distinct dates |
| Provenance | 0 real; 1,514 fixture verbatim, 272 fixture with rewritten text, 113 generated |
| Identical prose texts / pairs at 5-gram Jaccard ≥ 0.8 | 0 / 0 (max 0.765) |
| Exclusions | 510 pre-2025 release dates, 248 pre-2025 air dates, 39 pre-2025 seasons, 76 offer windows opening in 2027 |

**Loading and queries.** `node apps/kinodex/examples/dataset-demo.cjs` loads the seed with `env.load_seed` over real MCP (one request, 1,323,136 bytes, bundle dataset `data/evaluation/dataset.json`), queries it at 2025-03-15, the dataset clock and 2026-12-31 with `env.advance_time`, and checks that nothing dated later is visible and that advancing time changes no record: 26 checks passed on Node 22.23.2 and 18.20.8.

**Tests and verification.**

| Command | Node 22.23.2 | Node 18.20.8 |
| --- | --- | --- |
| `npm test` in `apps/kinodex` | 38 passed | 38 passed |
| `node runtime/cli.cjs verify --app apps/kinodex` | passed, 52 checks | passed, 52 checks |
| `npm run walkthrough` | 119 checks passed, same checks as before | 119 checks passed, same checks as before |
| `node apps/kinodex/examples/dataset-demo.cjs` | 26 checks passed | 26 checks passed |

New tests: `Cutoff: …` (six) and `Evaluation dataset: …` in `apps/kinodex/tests/business.test.cjs`. The walkthrough report is unchanged apart from `package_sha256`.

**Added scope against the approval baseline:** the dataset and its three scripts; the clock cutoff, which replaces the diary-edit `invalid_date` case for entries logged after the clock with `not_found`; and a larger package: 4,594,384 bytes of tracked files under `apps/kinodex/`, up from 3,116,402, mostly `data/evaluation/seed.json`.

## Plan and implementation

Everything in the plan's first version is implemented:

- the 32 operations it lists (18 reads, 14 writes);
- the four events `offer.publish`, `offer.end`, `title.update` and `correction.decision`;
- the state, lifecycle, notice and activity-row rules;
- the fixture for Dana at the stated scale (184 titles, 298 episodes, 900 people, 2,427 credits, 244 guide versions, 6 services, 1,230 offers, 250 diary entries);
- task data for a second account with a different region and services;
- evidence for the three example requests against both accounts.

The README has the operation list, the error codes, the rules, the data a task can use for each workflow and an acceptance-row-to-evidence table.

The approval review left three items to resolve during implementation:

1. **Versions.** `expected_version` on every write is Core's instance `{epoch, revision}`. The watchlist, list and account-settings versions are App fields (`watchlist_version`, `list_version`, `settings_version`), returned in reads and receipts. The optional per-object checks use their own arguments (`expected_watchlist_version`, `expected_list_version`, `expected_settings_version`) and their own error, `object_version_conflict`. The proposal's "version 2" is `watchlist_version` 2, and the Monday session reads the new Core version before writing (W39–W40).
2. **Clock-driven offers.** In v1, rules are evaluated only by catalog events on the rule's title and by `kinodex.services.update`. An upcoming offer that starts by the clock alone fires no alert and writes nothing; a task delivers it with `offer.publish` at its start time, and the README says so for task authors. This is the most conservative reading: stored state never disagrees with the snapshot, reads stay pure, and example request 2 still works because *Copper Sky* returns by event. "Expired" means `expires_at` was reached with no recorded trigger, and an event at exactly `expires_at` fires nothing (B17, B19; W85–W90, W97–W98).
3. **Correction target.** A correction is identified by `{title_id, field, target}`, where `target` is the `edition_id`, `region`, `credit_id` or guide `item_id`. `correction_ref` uses the same key, the one-open-correction rule counts on it, and `no_change` compares against that target's current value. 142 minutes for the theatrical edition of *Salt Year* is accepted; for the extended edition it returns `no_change` (B20; W82–W83).

The review's answers are followed:

- Spoiler-safe reads default to the bound person's diary, and `as_of_person` stays.
- Mira's and Jules's boundaries come from Dana's entries whose `watched_with` includes them, and T02 has the Mira example (B4; W77).
- A certification correction is allowed with the required evidence note.
- The fixtures are MIT.

The suggestion on time coverage is followed: offers, guide versions, alerts and corrections cover 2026 onward, and the seed accepts any history.

Where the implementation adds to the plan's wording:

- The optional per-object version arguments and `object_version_conflict` (item 1).
- `no_change` for any write whose patch changes nothing; for `services.update`, the order of services does not matter. The plan names `no_change` for corrections only.
- A `withdrawn` correction status, a single `needs_info` round, and `current_value` stored on each correction at submission.
- `already_true` also on `alerts.update`; `already_submitted` when amending a correction that is already submitted; `alerts.delete` limited to active rules, like updates.
- `invalid_date` also for an `expires_at` that is not in the future and an episode watched before it aired. A diary entry logged after the clock is `not_found`, so editing it fails with `not_found` (this replaced the first submission's `invalid_date` case).
- App-level `invalid_arguments` for shape errors the schema cannot express, and `invalid_event` beside the plan's `target_not_found` for event payload errors.
- Each account records an IANA `time_zone` in its seed, used only to decide "today" for `watched_on`. The same instant gives the same answer however Infra spells the clock (B13). It is not returned by any tool, so the approved tool contracts are unchanged.
- A derived per-title `my_subscriptions` summary in offer searches; back-to-back windows count as continuous, so a title is "leaving" only when that coverage ends within seven days.
- `kinodex.account.get` lists the people in the diary's `watched_with`, so the Agent can find valid `as_of_person` values.
- Writes that change an existing object take `{id, patch}`, and deletes and withdraw take `{id}`, so Core's `constraints.ids` and `constraints.fields` apply directly (W66–W67).
- The walkthrough's reference replies are evidence for the data and tools, not model trials. Code assembles every reply from tool output, using fixed sentence templates; checks compare each reply's facts with what that account saw.

Open item kept as built: the short-form `correction_ref`. The approved example event names its correction by `{title_id, field}` only. Kinodex accepts that short form only when exactly one open correction matches the title and field; otherwise it fails with `target_not_found` and asks for the target (B22). It was kept so that the approved example applies verbatim (W99), while the full key `{title_id, field, target}` remains the documented form and can never reach the wrong correction.

## Package boundary

The package imports only Node built-ins and its own files. `service.cjs` is the provided launcher and the only file that loads the runtime. The optional diagnostics adapter carries IDs only and cannot change business results (B37). `tests/schema-validator.cjs` is a byte-identical copy of the public validator. The walkthrough finds the runtime by walking up to the checkout, or through `PALE_RUNTIME_ROOT`. Only `apps/kinodex/` and this report are added; no registry or runtime file is changed.

## Data and licence

`data/evaluation/` holds the 2025-2026 evaluation dataset described above, rebuilt by `dev/build-dataset.cjs`; the fixtures below are unchanged.

`fixtures/minimal.json` (1,247,667 bytes, one record per line) holds the public catalog:

- 160 films and 24 series, 40 of them with two editions;
- regional certifications for the US, UK and CA;
- versioned parental guides;
- 6 invented services and their offers.

It also holds Dana's account: watchlist, 250 diary entries, 3 lists, 5 alerts, 3 corrections and 4 notices. Its compact JSON stays under the runtime's 2 MB MCP request line.

`examples/task-data/` holds Ines's seed (1,186,276 bytes, same catalog), binding, policies and dataset. `dev/build-fixtures.cjs` rebuilds both from hand-written word lists and hand-authored named records with the generator seed `20261201`. `contribution/dataset.json` records that as `method: scripted` with that seed.

All text is original and fictional; nothing was crawled, copied, translated or adapted. There are no media assets. Code and fixtures are under the repository's MIT License. The code, fixtures and this report were prepared with AI assistance (Claude); the author reviews them and is accountable for them.

Some titles fixed by the approved proposal share names with real works or products:

- *Lantern Hill*: a 1990 TV film.
- *Copper Sky*: a 1957 Western.
- *Harbor Lights*: a 1963 film and a song.
- *Fieldglass*: a software product.

They are kept as approved, and the README lists them for a decision. A web search on 2026-11-24 found no exact match for the other named titles, services and places (among them Kinodex, Brightreel, Northcast, Kettlewing, Plumvale, Tinlark Store, Openfern, *Salt Year*, *Quiet Harbour*, *Ambervane*, *The Wrenfield Clock* and *Pocket Comets*). Generated people's names were not searched one by one.

In `kinodex/reference-suite.node*.json`, report paths inside stage commands were rewritten from a local temporary directory to `.artifacts/`. No other report was edited.

## Not claimed, and what remains

- **Model-agent runs:** deferred for v1. No task uses Kinodex yet; designated-model rollouts with a failure analysis will be attached to those tasks or to this PR.
- **Interface:** no GUI or reviewer console. MCP is the declared interface, as approved.
- **`kinodex.services.list` behavior:** no business test or walkthrough step calls this read. Only the verifier's check of its published input and output exercises it.
- **Deployment:** no production deployment.
- **Remaining:**
  - independent maintainer reproduction and acceptance;
  - official PR CI on the implementation commit (`public-runtime (18)`, `public-runtime (22)`, `base-runtime-compatibility`), which awaits maintainer approval of the fork's workflow run;
  - human review of realism (including the generated dataset) and of the invented titles, people, services and names, including the proposal-fixed namesakes above;
  - a decision on the short-form `correction_ref`.
