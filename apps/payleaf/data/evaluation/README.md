# Payleaf evaluation data, 2025 to 2026

This folder holds the evaluation dataset of Payleaf. It is two years of history of one salaried employee, Kai Moreno (`payleaf-kai`), at the fictional employer Cobalt Ridge Supply Co. It covers 1 January 2025 to 31 December 2026.

**Every record is synthetic.** Payleaf is a fictional product, so there is no real source to collect and no real data to anchor. No record is an observed fact. The employer, the people, the bank accounts and the benefit plans are made up.

**No real-data anchor.** Section 3 of `docs/submission-evidence.md` asks for real source data from around November 2026 as an anchor when a website's earlier data cannot be retrieved. That rule does not fit here. The employer and the portal are fictional, and real pay records are private personal data, so there is no real source to collect. Every record is synthetic, and the coverage report counts 0 real and 0 mixed rows.

The small fixtures stay as they are: `fixtures/minimal.json` and `examples/task-data/seed.json` are smoke and example fixtures. They are not this dataset.

## Files

| File | What it is |
| --- | --- |
| `seed.json` | The seed. It has the App's own seed schema, and `env.load_seed` loads it as it is. |
| `clock.json` | The time to load it with: `2026-12-31T23:00:00-05:00`. |
| `dataset.json` | Provenance in the `pale.dataset.v1` format: one source, `evaluation-generator`, of kind `synthetic`, named in `record_source_ids`, so every record comes from it. `contribution/dataset.json` declares the same source ID. Pass it in the `bundle` of `env.load_seed`. |
| `manifest.json` | The generator version, the PRNG seed, the step counts, and the size and SHA-256 of `seed.json`, `clock.json` and `dataset.json`. |
| `coverage.json`, `coverage.md` | The date coverage report, made from `seed.json` by `dev/coverage.cjs`. |

## How it is made

`dev/generate-evaluation-data.cjs` writes the first four files. It replays a scripted history of 171 steps (72 writes of the employee and 99 events of payroll, the manager and the benefits team) through the App's own hooks, in time order. So the App accepted every step, and the App computed every deduction, net pay, deposit split and leave accrual. A small PRNG (mulberry32, seed `20250101`) picks the sick days and the mileage lines. A rerun gives the same bytes. `--check` fails when a committed file differs from a fresh run.

The history, in short:

- 52 pay runs, every second Friday. Payroll published the pay calendar of 2025 and 2026 before the history starts, so its 52 entries are in the starting seed. The four pay dates of early 2027 are added in October 2026 by four `calendar.changed` events, because the plan's event adds one entry each time. Two pay dates move for a bank holiday (3 July 2025 and 18 June 2026). Raises in April 2025 and April 2026, and a bonus each March.
- Deposit changes in both years. In May 2026 a deposit goes to a closed account, comes back, and is sent again.
- W-4 changes (freelance income in 2025, extra withholding in 2026) and retirement changes, one of them cancelled.
- 9 pay inquiries: missing mileage and travel lines that come back on a later statement, questions with no change, and two that are withdrawn.
- 27 leave requests over both years: approved, denied, cancelled, lapsed and taken leave, sick days, and the year-end forfeit on 1 January 2026.
- Two enrollment windows (November 2025 for 2026, November 2026 for 2027). The set in force for 2025 was chosen in November 2024, before the window, so it is seed history.

## The clock and late 2026

The seed is read at `2026-12-31T23:00:00-05:00`, the last hour of the window. So every record of 2025 and 2026 is in the past at the clock, including those of December 2026. If the clock were in November 2026, the December records would be future history, and a task would see records that have not happened yet.

At this clock, some rows are still scheduled: the four pay dates of early 2027 are `planned`, 8 percent for retirement is `locked` for the pay of 4 January 2027, a new W-4 is `waiting` for the pay of 15 January 2027, and a vacation request for 25 and 26 January 2027 is `pending`.

A task that starts earlier should not load this seed. It should use a seed "as of" its start time:

```sh
node apps/payleaf/dev/select-evaluation-seed.cjs --as-of 2026-11-19T12:00:00-05:00 --out /tmp/payleaf-as-of.json
```

The script replays only the steps at or before that time. So the seed holds no later record, and each record is in its state at that time. The script also checks every timestamp at any depth (history rows, notifications and their stored messages included) and refuses the seed if one is after that time. The only timestamps that may be later are the due times of a schedule: `cutoff_at` of a planned pay date and `opens_at` and `closes_at` of a window. For example, as of 19 November 2026 the pay date of 20 November is still `planned`. Load it with the same time as `virtual_now`. The time must be inside the window of the dataset.

## Actual records and scheduled rows

The coverage report keeps two groups apart. Only the first one counts.

1. **Actual dated records**: pay statements (`posted_at`), deposit returns and reissues, setting changes and their cancellations, inquiries with their answers and withdrawals, leave requests with their decisions and cancellations, leave entries, saved benefit choices, election sets, notifications and activity rows. Each kind has one date field, listed in `coverage.md`.
2. **Scheduled or future rows**: pay calendar entries and cut-offs, enrollment windows, the days of leave requests, and company holidays. This group also has every row dated after the clock, such as the 2027 pay dates. They are listed but never counted.

## Counts

- 165 App records: 56 pay calendar entries (26 in 2025, 26 in 2026, 4 in 2027), 52 pay statements, 16 setting changes, 9 pay inquiries, 27 leave requests, 2 enrollment windows and 3 election sets. Also 161 leave entries, 104 deposits, 99 notifications and 491 activity rows.
- 905 actual rows are counted, on **138 distinct dates**, from 1 January 2025 to 29 December 2026. Every month has at least two pay statements and several other records. One row is excluded: the 2025 election set, submitted on 12 November 2024.
- Real: 0. Mixed: 0. Synthetic: all.

138 dates is fewer than the 300 the guide suggests. That is natural for this App: it is one person's pay portal. A pay run comes every two weeks, and the person acts only a few times a month (a leave request, a question to payroll, a setting change). Most weeks have no other record. More dates would need filler that a real account does not have. The longest quiet span is 14 days, and 134 of the 500 working days have a record.

## Commands

From the repository root:

```sh
node apps/payleaf/dev/generate-evaluation-data.cjs --check
node apps/payleaf/dev/coverage.cjs --check
node apps/payleaf/dev/check-fixture.cjs apps/payleaf/data/evaluation/seed.json 2026-12-31T23:00:00-05:00
node apps/payleaf/tests/evaluation.integration.cjs --runtime runtime --report .artifacts/payleaf-evaluation.json
```

Without `--check`, the first two commands write the files again. `dev/check-fixture.cjs` checks the cross-record rules: every statement follows from its lines and settings, every change points at the right pay run, every leave balance matches its entries and requests, and every election set fits its window.

`tests/evaluation.integration.cjs` starts a real App instance with the public runtime. It loads the seed with `env.load_seed`, then reads it with the Agent's MCP read tools and compares the counts with `coverage.json`. It does the same for a seed as of 19 November 2026. Without the runtime it prints `SKIP` and exits 77. The load call is:

```json
{"expected_version": "<current>", "request_id": "evaluation-seed", "data": "<seed.json>", "binding": "<fixtures/binding.json>",
 "policies": "<fixtures/policies.json>", "bundle": {"dataset": "<dataset.json>", "catalog": "<contribution/assets.catalog.json>", "blobs": {}},
 "virtual_now": "2026-12-31T23:00:00-05:00"}
```

Then, for example, `payleaf.pay_statements.list` with `{"start": "2025-01-01", "end": "2026-12-31"}` returns the 52 statements, and `payleaf.calendar.list` with `{"start": "2027-01-01"}` returns the four planned pay dates of 2027.
