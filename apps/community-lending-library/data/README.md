# Synthetic evaluation dataset, version 1.2.0

[Evaluation rows](evaluation-v1.json) · [matching evaluation binding](evaluation-binding-v1.json) · [source/provenance metadata](dataset-v1.json) · [monthly coverage and SHA-256](coverage-v1.json). The separate default fixture is a December 2026 smoke scenario; it does not count toward this distribution.

The source is original fictional data, released under the App's MIT licence. No actual members, catalog rows, media or myTurn backend data were copied. No real-data anchor is needed for this fictional lending workspace, as the implementation review confirms. The public myTurn documentation is a workflow reference only.

The generator replays the App's actual rules for holds, desk checkout and return, renewal, rejection and FIFO promotions. The fixed history has quiet weeks and summer/holiday pickup bursts, varied morning/afternoon visits and handover delays, and four members borrowing seven of eight item types. All ten serviceable copies circulate; the remaining distinct item (the knit guide) has only a maintenance copy. Loans are returned after 1 to 12 full days, including nine late returns. Some holds are cancelled or never collected. Of six waitlist promotions, four are collected and two expire. One open loan and one open hold continue across the load point, with deadlines in the future. There is no live access or inference; the only pseudorandom choice source is the generator's checked-in seed. Terminal queue member IDs are Infra-only.

The report covers 24 of 24 months from January 2025 through December 2026, 101 distinct represented days (Asia/Shanghai), 61 holds, 43 loans and 89 desk attempts. Monthly activity and the distribution of lending outcomes are independently recounted. Undated inventory/member definitions, derived due dates and scheduled expiration dates do not count as activity. These are fictional dates and events.

```sh
# From apps/community-lending-library:
node data/generate.cjs --check
node data/generate.cjs --binding | diff - data/evaluation-binding-v1.json
node data/generate.cjs --until 2026-06-15 --profile > /tmp/lending-june-profile.json
node data/generate.cjs --until 2026-11-20T14:30:00+08:00 --profile > /tmp/lending-november-profile.json
node data/coverage.cjs | diff - data/coverage-v1.json
PALE_RUNTIME_ROOT=/absolute/path/to/runtime node tests/history-core.cjs
```

Use `--until YYYY-MM-DD` for midnight in Asia/Shanghai, or give an explicit offset timestamp. A cutoff must fall in local 2025–2026. The generator executes every scheduled event through the cutoff (inclusive), reconciles crossed expirations/promotions at their historical boundaries, and does not invent future actions. Later deadlines remain visible for already-active holds and loans; future receipts, returns and renewals do not appear early. `--until` by itself emits just the rows; `--profile` emits matching `data`, `binding` and `virtual_now` fields for `env.load_seed`. Supply an observed `expected_version`, a new `request_id`, and the environment’s bundle with `dataset` from [dataset-v1.json](dataset-v1.json). Adjusting the fixture clock alone is not a substitute: Core rejects a load earlier than the data’s `materialized_at` rather than returning `ready`.

The Core proof covers the full history at 2026-12-31 15:51 local, rejects a deliberately mismatched earlier clock without a state change, and loads and queries exact prefixes for 2025-01-01, 2025-09-10, 2026-06-15 and 2026-11-20. It also checks the pre-2025 floor, archived queue, member scope and run isolation, as well as reset and exact authored binding. Use the generated binding, not the smaller smoke binding.
