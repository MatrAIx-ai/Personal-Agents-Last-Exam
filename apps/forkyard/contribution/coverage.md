# Forkyard coverage

Counting zone `America/Los_Angeles`. Window `2025-01-01` through `2026-12-31`, inclusive. Timestamps are normalized in that zone before the calendar date is taken. Records dated before `2025-01-01` are excluded from the window and listed by seed and by month. None of these seeds has a record after `2026-12-31`.

Primary date fields are `commits[].committed_at`, pull `created_at`, `merged_at`, and `closed_at` when the pull was not merged, `reviews[].created_at` (or `submitted_at` when a review has that field), review-comment `created_at`, and published `releases[].published_at`. Tags, issues, ordinary comments, checks, timeline entries and draft releases are counted separately. Account, repository and branch timestamps are not counted.

A missing optional timestamp is left out of the count. The smoke seed's in-progress `ci/package` check on `c41f2a0` has `completed_at` null, so that row is one of those exclusions. A missing or malformed required date (commit `committed_at`, pull `created_at`, review `created_at` or `submitted_at`, published release `published_at`) is printed with its source and record id, and the command exits nonzero. `--load` exits nonzero when a list call returns a status other than `ok`, or when `env.advance_time` or `env.apply_event` returns a status other than `committed`. The December statuses are still printed.

Reproduce:

```sh
cd apps/forkyard
node examples/coverage-report.cjs
node examples/coverage-report.cjs --json
node examples/coverage-report.cjs --load
```

`--load` needs the repository runtime. It loads the owner library in the `scenario` profile at `2026-11-18T09:00:00-08:00`, pages `forkyard.commits.list` (`ref: main`, `limit: 100`), lists pulls and releases for both repositories, then applies `examples/events/owner-library-2026-12/events.json` with `env.advance_time` and `env.apply_event`.

`tests/business.test.cjs` runs the same builder and checks these totals. The December events are staged scenario events. They are not seed history.

## Provenance

Every record is synthetic. `scripts/generate.cjs` writes the five seeds. People and repositories are fictional on purpose: the tasks name maintainers and include rejected contributions, so there is no real project to anchor. December 2026 is four hand-written events in `examples/events/owner-library-2026-12/events.json`, applied after the clock moves. Nothing here is an observed historical fact.

## Seeds

| Source | File sha256 | In-window dates (primary) | Excluded before 2025 | Range in window | Months |
| --- | --- | ---: | ---: | --- | ---: |
| `fixtures/minimal.json` (registry smoke seed, three repositories) | `a12fb4a52f246bebe064d9b333fb06dedf91683b5d1ea1da7ca52df98af6fa8a` | 15 (14) | 0 | 2026-09-02 to 2026-11-17 | 3 |
| `examples/task-data/rejected-pr/seed.json` | `ca0ed34d88f4320bbc90080a2771d3e23012ea1b869795c3088ad986b9943380` | 36 (36) | 47 | 2025-01-15 to 2026-02-06 | 14 |
| `examples/task-data/locked-project/seed.json` | `70aaf64f40d11f2a457a4c7934d39ae28c620c146ed42b3253e8df1a7c7ec72c` | 4 (3) | 0 | 2026-11-10 to 2026-11-16 | 1 |
| `examples/task-data/owner-library/seed.json` | `6e5c2283335fcd2dc0a9ccc78d3fad1cd2e9f3b4637a207c9d4e00210083c6a8` | 291 (290) | 28 | 2025-01-02 to 2026-11-16 | 23 |
| `examples/task-data/release-attribution/seed.json` | `caea0a49ac026270540cce95666a7144c3c1cf6abce18252aba459ba0dbbec3c` | 6 (5) | 0 | 2026-10-31 to 2026-11-23 | 2 |
| December 2026 staged events | `examples/events/owner-library-2026-12/events.json` | 4 | 0 | 2026-12-03, 2026-12-08, 2026-12-10, 2026-12-18 | 1 |
| All seeds, deduplicated | | 321 (319) | 75 | 2025-01-02 to 2026-11-23 | 23 |
| All seeds plus December | | 325 | | 2025-01-02 to 2026-12-18 | 24 |

The parenthetical number is distinct dates that come from a primary field. The first number counts every dated record in the window. Rejected-pr still contains February 2024 through December 2024 (47 records). Those dates stay in the seed and stay out of the window. The owner library excludes 28 records: 27 on `tomasreyes/notebook` (2024-03 through 2024-12) and the fieldbook root commit on 2024-12-16.

The default fixture is the registry smoke seed. It is three repositories (`tidewater/tidewater`, `tomasreyes/tidewater`, `ingrid/fieldnotes`), 30 dated records, and three months in late 2026. The evaluation dataset is the owner library.

The owner library is the full-window evaluation dataset: 456 dated records, 293 commits, 33 pull requests (30 merged), 37 reviews, 9 published releases and 1 draft, 13 tags, 40 checks. `tomasreyes/notebook` keeps 81 commits, 6 tags, 3 releases and bot pull request 10. `tomasreyes/fieldbook` adds 212 commits, 30 merged pull requests, 37 reviews, 7 published releases, 7 tags and 30 checks.

December adds four events, all committed by `--load`: two `commits.pushed_by_other` on fieldbook main (2026-12-03 and 2026-12-10), one `pull.review_submitted` on notebook#8 (2026-12-08), and one `tag.created_by_other` `v1.7.1` (2026-12-18). The first push parent is `e000212`, the fieldbook main tip in the seed.

## Owner library by month

Combined notebook and fieldbook. Months before 2025 are excluded.

| Month | Primary | Other | Dates |
| --- | ---: | ---: | ---: |
| 2024-03 | 3 | 0 | 3 |
| 2024-04 | 2 | 0 | 2 |
| 2024-05 | 3 | 0 | 3 |
| 2024-06 | 3 | 1 | 3 |
| 2024-07 | 2 | 0 | 2 |
| 2024-08 | 3 | 0 | 3 |
| 2024-09 | 2 | 0 | 2 |
| 2024-10 | 3 | 0 | 3 |
| 2024-11 | 2 | 0 | 2 |
| 2024-12 | 4 | 0 | 4 |
| 2025-01 | 13 | 1 | 10 |
| 2025-02 | 21 | 3 | 14 |
| 2025-03 | 16 | 2 | 14 |
| 2025-04 | 20 | 2 | 14 |
| 2025-05 | 14 | 1 | 12 |
| 2025-06 | 16 | 4 | 14 |
| 2025-07 | 16 | 1 | 13 |
| 2025-08 | 16 | 1 | 13 |
| 2025-09 | 19 | 3 | 15 |
| 2025-10 | 15 | 1 | 12 |
| 2025-11 | 19 | 2 | 14 |
| 2025-12 | 17 | 2 | 14 |
| 2026-01 | 13 | 1 | 11 |
| 2026-02 | 15 | 3 | 12 |
| 2026-03 | 19 | 3 | 14 |
| 2026-04 | 16 | 1 | 13 |
| 2026-05 | 16 | 1 | 12 |
| 2026-06 | 19 | 4 | 14 |
| 2026-07 | 13 | 3 | 11 |
| 2026-08 | 14 | 4 | 11 |
| 2026-09 | 16 | 4 | 12 |
| 2026-10 | 23 | 5 | 15 |
| 2026-11 | 9 | 1 | 7 |

`tomasreyes/notebook` in the window: 56 dates (55 primary), 2025-01-10 to 2026-10-15, 27 records excluded. It has no dated record in 2026-11. `tomasreyes/fieldbook` in the window: 254 dates (254 primary), 2025-01-02 to 2026-11-16, 1 record excluded (the 2024-12-16 root commit). Fieldbook month dates from the same run: 2025-01 9, 02 13, 03 12, 04 13, 05 10, 06 10, 07 12, 08 10, 09 14, 10 10, 11 13, 12 12; 2026-01 9, 02 10, 03 13, 04 11, 05 11, 06 12, 07 9, 08 9, 09 11, 10 14, 11 7.

## Global dates by month

Deduplicated dates across all five seeds. December 2026 is empty until the staged events are included. With those events the month has 4 dates and the window is 24 of 24 months.

| Month | Dates | With December |
| --- | ---: | ---: |
| 2025-01 | 12 | 12 |
| 2025-02 | 16 | 16 |
| 2025-03 | 15 | 15 |
| 2025-04 | 16 | 16 |
| 2025-05 | 14 | 14 |
| 2025-06 | 17 | 17 |
| 2025-07 | 14 | 14 |
| 2025-08 | 15 | 15 |
| 2025-09 | 16 | 16 |
| 2025-10 | 13 | 13 |
| 2025-11 | 14 | 14 |
| 2025-12 | 14 | 14 |
| 2026-01 | 12 | 12 |
| 2026-02 | 15 | 15 |
| 2026-03 | 14 | 14 |
| 2026-04 | 13 | 13 |
| 2026-05 | 12 | 12 |
| 2026-06 | 14 | 14 |
| 2026-07 | 11 | 11 |
| 2026-08 | 11 | 11 |
| 2026-09 | 14 | 14 |
| 2026-10 | 16 | 16 |
| 2026-11 | 13 | 13 |
| 2026-12 | 0 | 4 |

Primary dates across the seeds are 319. With the December events, primary dates are 322. The 2026-12-18 tag is counted with the other dated records, so it adds a date to the 325 and stays outside the primary 322. All five seeds plus the December events come to 325 distinct dates.

Loading the owner library and then applying the December events reaches 295 distinct dates. That figure is the owner-library seed plus those four events. The 325 figure also includes the smoke seed, rejected-pr, locked-project and release-attribution.

## Remaining gaps

The evaluation set does not have a record on every calendar day. 325 distinct dates across 24 months is the delivered depth. The smoke seed, the locked-project seed and the release-attribution seed are short on purpose and do not stand in for the owner library. Rejected-pr covers 14 months inside the window and keeps its 2024 history outside the count. The owner-library seed itself ends on 2026-11-16, so December 2026 exists only as the four staged events.

## Representative records

Fieldbook commit `f000002`, 2025-01-02T19:00:00-08:00, author `fy-tomasreyes`, message `Parse the 3.4 mile line for Matt Davis`. Weekday commits are evening times. Weekend commits use a morning hour.

Merged pull request `tomasreyes/fieldbook` #1, `Matt Davis notes 1`, opened 2025-01-11T10:00:00-08:00 and merged 2025-01-13T18:40:00-08:00. The body is `Adds entry 1 for Matt Davis from Stinson Beach: 3.4 miles and 800 feet of gain. The note says the second switchback was dry.` Review `rv-fb-1` on 2025-01-12T20:15:00-08:00 is `approved` and says the diff matches that pull request. Pull request 4 asks for `Rodeo Lagoon` in the title, then approves the same head as written. Each merge has a `ci/test` check.

Release `rel-fb-1`, tag `v1.1.0`, title `Fieldbook v1.1.0`, published 2025-03-28T21:45:00-07:00. The notes say `Fieldbook v1.1.0 gathers the trail logs through late March 2025. Elevation in the notes stays in feet.` Published releases run from `v1.1.0` through `v1.7.0`.

## Load and query

```json
{
  "load": "ready",
  "tomasreyes/notebook": {
    "commits_on_main": 77,
    "pulls": 3,
    "pull_states": {"open": 3},
    "releases": 3
  },
  "tomasreyes/fieldbook": {
    "commits_on_main": 212,
    "pulls": 30,
    "pull_states": {"merged": 30},
    "releases": 7
  },
  "december": [
    {"event_id": "fb-dec-push-1", "operation": "commits.pushed_by_other", "status": "committed"},
    {"event_id": "fb-dec-review-1", "operation": "pull.review_submitted", "status": "committed"},
    {"event_id": "fb-dec-push-2", "operation": "commits.pushed_by_other", "status": "committed"},
    {"event_id": "fb-dec-tag-1", "operation": "tag.created_by_other", "status": "committed"}
  ]
}
```

Notebook has 81 commits in the seed and 77 reachable from `main`, because `main` is parked behind the open pull-request branches. Fieldbook's 212 commits are all reachable from `main`.
