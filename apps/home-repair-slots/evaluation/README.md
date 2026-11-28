# Home Repair Slots evaluation history, v2

Three separately bound fictional households each have nine past service bookings, with uneven activity periods, varied providers, times, prices and lead times, and a mixture of retained, rescheduled and cancelled outcomes. The combined synthetic history is **68 actions on 44 distinct Asia/Shanghai dates across all 24 months**, from 2025-01-01 through 2026-12-31. There are no real records and no external source or real-data anchor: this is fictional private booking activity. No individual household fills every month. The default smoke seed and fixtures are unchanged.

| Household | Profile: data, binding and virtual clock | Matching dataset metadata |
| --- | --- | --- |
| Willow | [seed.json](seed.json) | [dataset.json](dataset.json) |
| Cedar | [cedar.seed.json](cedar.seed.json) | [cedar.dataset.json](cedar.dataset.json) |
| Fern | [fern.seed.json](fern.seed.json) | [fern.dataset.json](fern.dataset.json) |

[coverage.json](coverage.json) gives the authoritative `history[].at` date field, file hashes, per-source and deduplicated date counts, endpoints, monthly breakdown and gaps. Scheduled service slots are not counted as activity, nor are account configuration or the scenario clock. The catalog's expected count is a Core record total, not a coverage measure.

From the App directory:

```sh
node evaluation/recount.cjs                  # verify exact bytes and print count
node evaluation/recount.cjs --generate       # explicitly regenerate
node tests/evaluation.cjs                    # independently load/read/reset all three
```

Use one household per isolated run. Start Infra, take `env.snapshot`, and issue `env.load_seed` with the selected profile’s `data`, `binding`, and `virtual_now`, the current version, a fresh request ID, and the snapshot’s bundle with the matching dataset metadata substituted. Load at the documented clock; do not expose this full snapshot to tasks before its history. Use a separate bound Agent session for reads: `list_slots` enumerates local booking IDs; `get_booking` returns the booking, slot and its recorded confirmation/reschedule/cancellation events. It does not expose other households or Infra metadata. Historical appointment windows do not become live offers. The Core test checks all three complete loaded states, event timelines, cross-household access, a new booking, and exact reset.
