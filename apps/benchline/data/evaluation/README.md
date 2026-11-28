# Benchline evaluation data, 2025 to 2026

This folder holds the delivery dataset of the approved plan: two years of the synthetic history of one fictional lab (Prof. Okafor's EEG decoding lab on the Halden research cluster), seen from the researcher account `benchline-nadia`. It covers 2025-01-01 to 2026-12-31 and is read at `2026-12-31T23:00:00-05:00` (`clock.json`). Every record is synthetic. Benchline models no real cluster or website, so there is no real source to collect or to anchor (open question 5 of the plan). The lab, its people, the cluster, the datasets, the configs and the results are fictional.

| File | What it is |
| --- | --- |
| `seed.json` | The App state at the clock, for `env.load_seed`. Compact JSON. |
| `clock.json` | The `virtual_now` to load it with. |
| `dataset.json` | The dataset declaration for the bundle of `env.load_seed`. Every record comes from the source `evaluation-generator`, of kind `synthetic`. |
| `manifest.json` | Every story with its template and the IDs of the records it made, the counts and the file hashes. |
| `coverage.md`, `coverage.json` | The reproducible date coverage report. |

## How it is made

`dev/generate-dataset.cjs` builds stories from the templates of `dev/evaluation-scenarios.cjs` with a seeded PRNG (mulberry32, seed `20250101`), then replays every step in time order through the App's own hooks. So the App made every job of Nadia, every hold, sign-off, table, manifest and notification. A story fixes all its parts together:

- A campaign: one person runs a config on the seeds of the current signed version of a protocol line that have no usable run under the same evaluation (the same dataset release, split and metrics, under any version of the line). A config never changes, so a run that gave a usable result under a protocol is not repeated under the same evaluation: when a new version only adds seeds, the campaign runs only the new seeds. A script sweep has no protocol, so its results cannot enter a table: when Nadia wants such a config in a table, she runs its seeds again under the signed version (32 of the 45 script results are run again this way, and 29 of these reruns are cited in tables). It takes a config that still misses seeds, or it registers a new config: the next step of that person's hyperparameter sweep (another learning rate, number of epochs, warm-up or, for an ablation, what is ablated). A labmate's jobs arrive as `job.recorded`. Nadia's jobs go through the App: a run plan for each seed, then `jobs.submit`. When a job does not fit the hours that are left, it is submitted held, released the next morning when it fits, and cancelled when it still does not.
- A rerun: a seed that failed or timed out is run again on a later working day, with a longer time limit after a timeout. The manifest records the reason (`failed` or `timed_out`) with the config and the seed. A rerun keeps the protocol version of its campaign, so it can run under a version that a newer one superseded the same day. When Nadia's job limit is full on that day, she tries again on the next working day, up to four days.
- An allocation crunch before the Autumn conference 2026: the lab head cuts the allocation below what is already used while three of Nadia's planned jobs wait in the queue. The cut holds them. The next day one more submission does not fit: it is submitted held and cancelled the next morning. Three days later the department returns hours, Nadia releases two held jobs and cancels the third.
- A protocol change: the proposal with a rationale that names what it changes (the new dataset release, the new seed count, the split or the metrics), and the answers of the signers (signed, declined, expired, withdrawn, or still open at the clock). A decline note fits the kind of change. The version that is withdrawn for a typo carries the typo, and the version proposed again fixes it.
- An allocation change by the lab head, with a reason of its kind (a cut or a raise).
- A paper table before each fictional deadline, and a progress table for the lab meeting every other month, when there are complete rows for it: Nadia's complete campaigns under a signed version, frozen before the deadline.
- A correction: a labmate invalidates a result that a frozen table cites, because the run went wrong (a cached split, labels before a fix, a corrupt checkpoint). The config is unchanged, so Nadia reruns that seed, revises the table and freezes the new version. Nadia never excludes a result that a table cites.
- A script sweep of the Birch ablations at 22:00 (`job.script_submitted`): each sweep registers one new ablation config and runs three or four seeds of it. One sweep ran no job: on 16 September 2026, during the allocation crunch, all four submissions of sweep `st-0548` were refused with `over_allocation` (a seed selected as of 17 September 2026 holds the four `job.submission_rejected` notices), so its config `cfg-birch-abl-v22` never ran. A node failure interrupts a running job, and an interrupted job of Nadia is submitted again the next morning.
- A new quarter. The plan has no event that starts a period, so a new quarter is history that a task loads: the generator writes it into the data one second before the quarter starts.

Campaigns crowd into the three weeks before a deadline. Nobody submits by hand on weekends, on US federal holidays or during the winter break of the lab.

The seed keeps the notifications and the activity rows of its current allocation period, so it stays below the request size of `env.load_seed`. Every record keeps its own history.

## Counts

1,534 jobs (371 of Nadia, 45 of them from her script; 1,163 recorded for labmates), 387 configs in 8 families, 22 protocol versions on 6 lines (in all six states), 36 table versions, 307 run plans and 12 allocation changes. That is 2,298 records. The data also has 9 allocation periods (8 quarters of the window and Q4 2024), which are setup, not records. `manifest.json` has the exact counts, and a business test (`T23`) checks that this paragraph states them.

Every step of the replay commits, or it is skipped on purpose with its reason: a story whose act does not happen at that time (no running job for a node failure, no complete rows for a table, Nadia's job limit full on a rerun day). `manifest.json` counts every skip in `skipped_counts` and lists each one in `skipped`, except the conditional follow-ups (a release or cancel of a job that was not held, and a rerun attempt after one that ran), which are only counted. The generator stops on any other refusal.

## Differences from the plan

The plan's data section gives approximate counts. The dataset differs in these, and the reason is the plan's own rule that a config never changes. This change is open to the reviewer.

| What | The plan says | The dataset has | Why |
| --- | --- | --- | --- |
| Configs | about 40 configs in 8 families | 387 configs in 8 families: 42 base configs (one per family and dataset release, and 10 for the other splits) and 345 steps of hyperparameter sweeps | A config never changes, and a protocol version covers one dataset release, split and seed list. The 42 base configs allow at most about 200 distinct runs under the 22 versions. About 1,800 jobs on about 40 configs would repeat each run about nine times, which is duplicated filler. So a campaign takes a config that still misses seeds, or registers the next step of its owner's sweep. |
| Jobs | about 1,800 jobs, about 500 of the researcher | 1,534 jobs, 371 of the researcher | Every job is a distinct run or a rerun with a reason. No job was added to reach the planned count. |
| Table versions | about 25 | 36 | A paper table for each of 7 deadlines (up to three each), a progress table every other month when there are complete rows, and the corrections. |
| Protocol versions | about 20 in every state | 22 in all six states | Within the plan. |
| Notifications and activity rows | (not stated) | only those of the current period (Q4 2026): notifications from 2026-10-01 on | The whole history would pass the request size of `env.load_seed`. Every record keeps its own history, and the selector keeps the current period of the time it selects. |

## Checks

- `node dev/generate-dataset.cjs --check` regenerates the files byte for byte, runs the story rules, and checks the size of the `env.load_seed` request. It also prints the time of the replay.
- `node dev/check-evaluation.cjs` runs the 16 committed story rules (for example: the same config and seed under the same evaluation run again only after a run that failed, timed out, was interrupted or cancelled, or was invalidated; the results of one config under one version are within 0.02 of their mean; a rationale names what the version changes, and a decline note fits that change; a version withdrawn for a typo carries the typo; an interruption names a node of the job's partition).
- `node dev/select-evaluation-seed.cjs --as-of TIME [--out FILE]` writes a seed as of a time: only the steps before it, the period that contains it, and each record in its state at that time. It refuses a seed with any later timestamp, except a planned time (a `respond_by`, the planned run of a job that has not ended or that was interrupted or cancelled, the planned release of a `job.ended` notice, the end of the current period). It accepts times from 2025-01-01 to the clock, `2026-12-31T23:00:00-05:00`, so no seed exists for the last hour of 2026 or for 2027.
- `node dev/check-fixture.cjs --evaluation` runs the consistency script on the delivered seed and on the 24 month-start seeds, and the story rules on the delivered seed.
- `node dev/coverage.cjs --check` reproduces the coverage report. It counts only acts that happened, each on the date it happened. Its last section, "Sample records", shows a fixed sample of jobs, a protocol version, a table version, an allocation change and a config in plain words.
- `node tests/evaluation.integration.cjs --runtime runtime` (from the repository root: `node apps/benchline/tests/evaluation.integration.cjs --runtime runtime`) loads the seed with `env.load_seed` on the public host and reads it back with the Agent's MCP tools.
