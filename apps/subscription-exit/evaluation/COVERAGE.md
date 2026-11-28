# Subscription Exit evaluation history (v3)

Origin: **100% original synthetic, MIT**. No external account data or media; explanation derived from public product documentation only. Synthetic December 2026 records are simulated, not observed. A November real-data anchor does not apply to these fictional private accounts (see #20 delivery review).

- Source: `accounts-v1.json`, SHA-256 `9d0a14d37ad4d4ec91559d0c64c3a705b7597e753cf0d9356eb35f5afb382cbb`. Six independently bound, overlapping subscriber histories with distinct billing anniversaries, load clocks, saved-entry times and varied cancel/withdrawal patterns. The default partitions have three active paid accounts, one scheduled cancellation, and two ended accounts. Coverage counts the final dated inventory, not the defaults twice; smoke data is excluded.
- Occurrence fields: `history.at`, `saved.saved_at`, `action_receipts.confirmed_at` (UTC); 131 dated records; 122 distinct recorded occurrences after coalescing a confirmation receipt with its paired history entry; 114 global distinct days; 2025-01-01–2026-12-31. Distinct dates by record source: history 88, saved 31, action_receipts 9.
- 24/24 months. No missing months, malformed or out-of-window counted dates. Preview creation is an intermediate action and excluded; scenario clocks, future period/renewal boundaries and receipt effective dates do not count again.
- Runtime cutoff: run `node evaluation/build.cjs --until 2026-11-20T12:00:00Z --account listener-cohort-4 --snapshot /tmp/infra-snapshot.json` where the input JSON is the public `env.snapshot` result. Pass stdout directly as `env.load_seed` arguments; the bundle and record count match without hand edits. Add a unique `--request-id` when loading repeatedly into the same run. Earlier cutoffs expose only records at or before the clock. Before the authored subscription start, the account is free with no ended subscription and no paid action.
- Recount actual delivered bytes: `node evaluation/build.cjs --check`. Deterministically rebuild the dataset and report: `node evaluation/build.cjs`.

| Month | Subscription history | Saved entries | Confirmation receipts | Distinct dates (dedup) |
| --- | ---: | ---: | ---: | ---: |
| 2025-01 | 1 | 1 | 0 | 2 |
| 2025-02 | 1 | 1 | 0 | 2 |
| 2025-03 | 1 | 1 | 0 | 2 |
| 2025-04 | 3 | 1 | 0 | 4 |
| 2025-05 | 3 | 1 | 0 | 4 |
| 2025-06 | 3 | 1 | 0 | 3 |
| 2025-07 | 3 | 1 | 0 | 4 |
| 2025-08 | 3 | 0 | 0 | 3 |
| 2025-09 | 3 | 0 | 0 | 2 |
| 2025-10 | 4 | 0 | 2 | 4 |
| 2025-11 | 4 | 2 | 0 | 5 |
| 2025-12 | 5 | 3 | 1 | 8 |
| 2026-01 | 7 | 2 | 1 | 9 |
| 2026-02 | 3 | 2 | 0 | 5 |
| 2026-03 | 3 | 1 | 0 | 4 |
| 2026-04 | 5 | 2 | 2 | 7 |
| 2026-05 | 5 | 1 | 0 | 6 |
| 2026-06 | 3 | 1 | 0 | 4 |
| 2026-07 | 4 | 1 | 0 | 4 |
| 2026-08 | 5 | 2 | 0 | 7 |
| 2026-09 | 5 | 2 | 0 | 6 |
| 2026-10 | 8 | 1 | 2 | 7 |
| 2026-11 | 5 | 2 | 1 | 7 |
| 2026-12 | 4 | 2 | 0 | 5 |
