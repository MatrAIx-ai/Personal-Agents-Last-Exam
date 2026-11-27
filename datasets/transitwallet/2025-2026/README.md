# transitwallet: 2025–2026 evaluation history, version 1.0.0

Additive data/evidence delivery against `docs/submission-evidence.md` at main `6933c430942c64f94874083815829e4a4b20920a` (#260). The approved MCP-only App scope and proposal are unchanged. No GUI, live-provider integration or cross-App dependency is added. Maintainer review of this additional data milestone remains separate from the original on-time v1 delivery.

## Delivered records and realistic scope

24 selected assisted travel episodes across three account profiles, with 48 completed physical trip legs. Twelve cases cancel a paid early return; twelve let the unused unpaid hold lapse. Fare and cancellation-fee variations remain in the locked offers and append-only ledger.

`data.json` contains the actual loadable business states, not date-only placeholders. Each partition is an independently loadable, source-bound workspace episode with stable qualified object IDs, an App account and a per-state SHA256. Partitions are not one shared live account timeline; loading another partition replaces that run's baseline. Select a partition for a Task or explicitly construct a compatible combined seed; do not pretend that loading the last one merges the earlier ones. History counting deduplicates calendar dates globally across all partitions. Qualify record IDs by partition when comparing accounts/episodes.

The window is **2025-01-01 through 2026-12-31 inclusive**, counted in **Etc/UTC**. All **24 months** have substantive records; all actual record timestamps are in the window. Dataset load time is 2027-01-01, so future scheduled deadlines do not become historical occurrences. 48 distinct dates are represented, with 682 inactive dates listed in `coverage.json`; there is no claim of daily activity or 300-date coverage. Density follows selected research releases, trips or infrequent service incidents. Adding filler merely to reach 300 would not improve these examples.

## Provenance, source versions and exclusions

All delivered identities, narratives, review decisions, prices, serials and histories are **original synthetic data**, created for this fictional MCP workspace. None are observed personal/provider records. Generation date is 2026-11-26; represented dates, including December 2026, are synthetic rather than facts collected on that date. No real website history was retrieved, transformed or redistributed. The November 2026 real-website anchor clause is not used to claim an observed anchor for this approved fictional App; any request to add a live-site corpus is an additional scope decision.

The deterministic generator calls the App's actual domain entrypoints for business writes/events and validates resulting states; it does not manufacture replacement Core behavior. Generation is an App-only synthesis run, **not** a model rollout or an MCP transaction transcript. `mcp-readback.json` and `base-mcp-readback.json` separately record actual public-Core loads and Agent reads of those business facts. The original App business/MCP evidence remains in `docs/validation/transitwallet-v0.1.0.md`.

`data.json` pins App revision `073cdddc6c681536d8e565435fd9369a887971c6`, package SHA256 `344cb4fe76d839422996b15dfa43a46e69b1d94347da4bd91fdb01b059432263`, generator/common source hashes, and all original fixture hashes. `manifest.json` independently pins every delivered evidence file and both runtime trees after verification. To regenerate it after the two checks, set `PALE_BASE_RUNTIME_ROOT` to the exact pristine runtime used and run `node datasets/transitwallet/2025-2026/manifest.cjs`. The App package, runtime, schemas and approved proposal bytes are unchanged by this supplement. Code and invented data use the repository/App license; no third-party assets are included. Attribution: Hanson Tang (@hansontang).

## Reproduce generation, count and actual loading

From the repository root with Node.js 18+ (built-ins only):

```sh
node datasets/transitwallet/2025-2026/generate.cjs
node datasets/transitwallet/2025-2026/coverage.cjs --check
node datasets/transitwallet/2025-2026/verify.cjs
```

For an independent, maintainer-selected pristine runtime, set `PALE_RUNTIME_ROOT` to that checkout's `runtime` directory, then run:

```sh
node datasets/transitwallet/2025-2026/verify.cjs datasets/transitwallet/2025-2026/base-mcp-readback.json
```

`PALE_APP_ROOT` can point at an independently obtained exact App package. Both reports identify its hash. The verifier uses real separate Agent and Infra stdio MCP processes. For **every partition**, it loads exact data through `env.load_seed`, reads the bound account and public business tools, compares the entire persisted state and real receipt/proof/ledger fields, verifies read-only behavior, and resets to that loaded data/time baseline. It also rejects corrupted business history atomically. These tools use disposable runtime directories, not production accounts or credentials.

To reuse a partition directly, read its `data`, `load_at` and account binding, use the App's pinned `fixtures/binding.json`, and submit them on the Infra connection to `env.load_seed` with the currently observed `expected_version`. The Agent connection can then use `transitwallet.records.list` / `.records.get` and the App's business read tools. The Agent cannot load or reset its own seed. `verify.cjs` is the executable load/query example; observations contain actual run versions, readback hashes, representative content and business receipt IDs.

## Counting contract and evidence index

- `coverage.cjs --check` recalculates the committed report over **actual delivered data**. It normalizes occurrence timestamps to UTC before counting. Date-only input would be interpreted in the same declared UTC zone; this dataset uses explicit timestamps.
- `date_fields` in `data.json` names the authoritative field in each source. A nested actor reply is a separately dated reply fact. Ordered business-history entries remain a separately labelled source. Counts of dated facts are not counts of unique business objects, and multiple facts/sources on one date contribute only one date to the global count.
- Venue deadlines, service windows, offers' due dates and slot schedules are **not** counted as occurred activity. Structural objects without an occurrence date are explicitly excluded. Any missing/invalid occurrence dates are errors; outside-window dates are visible exclusions. Generation/export dates and filesystem modification times are never activity dates.
- `coverage.json`: 1152 object/history rows; 1212 dated fact rows; 48 global distinct dates; monthly/source and complete date breakdowns, real/synthetic classification, inactivity gaps and exclusions. Missing months and unresolved date errors are both zero.
- `mcp-readback.json`: current-public-runtime load/query/reset observations and relevant negative controls.
- `base-mcp-readback.json`: identical checks against the independently prepared pristine runtime; compatibility evidence is separate from maintainer acceptance.
- `manifest.json`: exact SHA256 of data, scripts, report files and runtime source trees. Verify the file hashes before reusing evidence.

These data demonstrate historical coverage and loadability. They do not establish Task difficulty, model performance, production deployment or final contribution acceptance. A Task reports only its selected history before its first-session cutoff; it cannot count future scenario events or this whole corpus automatically.
