# Delivered dataset coverage

The delivered evaluation library contains **96 independent, loadable synthetic scenarios**, four in each month from January 2025 through December 2026. Each run retains the approved boundary: one fictional property, one fixed two-night reservation and exactly two current guests, selected from a pool of three synthetic people. The same hotel and owner recur because those are deliberate scope constraints; service history, companion assignments, dates, lead times and times of day vary.

The contribution declares both datasets explicitly. [contribution/dataset.json](../contribution/dataset.json) retains `expected_counts.records: 20` for the small runtime baseline, as required by the public bundle validator. Its `authored-scenario-library` source links the separate, schema-valid [full evaluation declaration](../datasets/declaration.json), which declares **3,264 synthetic records** and references [manifest.json](../datasets/manifest.json). The manifest indexes the actual 96 seed files, their hashes, counts, account binding and initial virtual times. The small baseline does not stand in for the delivered library.

## Variation and prior history

This is a library of independent hotel-service situations, not a claim of continuous two-year activity by one traveler or an empirical booking distribution. Sampling is intentionally four scenarios per month. Within that sampling:

- Check-in dates occupy **19 different days of the month**. Each of the four patterns changes its day of month across the period; none is permanently assigned the 2nd, 10th or 18th.
- Check-in and checkout times each have **10 distinct UTC serializations**, with local check-in hours from 14:00 to 17:30 and checkout hours from 09:00 to 12:30. UTC offsets vary correctly with the property's `Europe/London` zone.
- Source observations have **195 distinct UTC times of day**. Request submissions have **78 distinct rounded lead-hour values**, from **44 to 269 hours before check-in**. Observation, submission, acknowledgment and response times are separate dated events, not a single repeated timestamp.
- `person-2` and `person-3` each appear as the current companion in **48 scenarios**. Replacement cases rotate both directions; partial breakfast and unavailable-route cases also vary their target traveler. Six service-level meal requests rotate across people.
- Every seed contains **2–4 actual request histories**: 32 seeds have two requests, 32 have three, and 32 have four. All **288 requests** received an acknowledgment. Final states comprise **192 confirmed**, **32 declined**, **32 needs clarification** and **32 withdrawn** requests, with **960 operation/event history records**.

The generator builds those histories by executing `request.preview`, `request.submit`, `request.withdraw`, `need.save` and `people.replace`, plus the public plugin's hotel-reply/source-update/unavailability event handler. It does not append invented final responses or bypass business validation. Each confirmed service has a commitment linked to its actual request, final terms and confirmation time. Acknowledgment alone never creates a promise. The generation tests reproduce all 96 exported seeds through those calls and compare the full business state.

Sources are visible before their corresponding request; replies follow submission; provider decisions and history records precede the scenario's `initial_time`. A clarification remains unresolved until a later authorized event. Former-companion promises survive a replacement. Future service dates describe obligations, not completed stays or historical observations. No Task answer labels are inserted into the loaded business records.

| Pattern | Initial business situation and retained causal evidence |
| --- | --- |
| `arrival-mismatch` | A confirmed arrival request is followed by a changed arrival source and explicit need update. The existing entrance window remains earlier than the new arrival, including after-midnight cases. |
| `route-unavailable` | A traveler-specific access request was acknowledged and confirmed. A later notice makes that exact named route unavailable; the notice does not rewrite the original promise. |
| `breakfast-partial` | Two mornings were requested and acknowledged, but the hotel confirmed only one of them. Both the requested dates and narrower confirmed terms remain visible. |
| `guest-replaced` | The previous companion's breakfast was requested, acknowledged and confirmed before a same-headcount substitution. The former service stays active until explicit hotel-confirmed cancellation. |

The additional histories represent provider refusal, unanswered clarification and withdrawal. They are service attempts with observable consequences, not duplicate log records inserted solely to increase date counts.

## Synthetic provenance

All **3,264** App records are authored synthetic data, including future-dated prospective scenarios. Real guest records and mixed guest records are both **zero**. The review explicitly accepts synthetic data for this fictional environment; **no real-data anchor is claimed or required**. Public product references in [reference/sources.json](reference/sources.json) serve only as GUI/workflow comparisons and are excluded from guest-data and date totals.

The manifest records the generator version and hash, the original baseline hash, and all generation dependencies: trusted binding, plugin entry point, business modules, tool schemas and the four business schemas. A change to any hashed input requires intentional regeneration. Record identity across independent runs is `(scenario_id, record_type, id)`; ordinary App IDs are intentionally reused across isolated seeds. The checker rejects duplicate identities, altered bytes and inconsistent declared counts. Human review of realism remains a separate acceptance step.

## Counts and date semantics

[coverage.json](../datasets/coverage.json) is calculated from the actual delivered JSON using **Europe/London** as the IANA counting zone. Stored timestamps remain UTC; timestamps are converted to the property zone before taking a calendar date. Date-only breakfast values are dates in that zone.

The global union is **383 represented dates**, from **2025-01-01 through 2026-12-31**, inclusive. **167 dates** contain source observations, submissions, replies, confirmations or recorded events; **286 dates** describe stay/service timing. These sets overlap on **70 dates**, so they must not be added. This is Environment coverage, not a claim of 383 days of pre-session personal history.

| Record source | Records | Authoritative dates counted |
| --- | ---: | --- |
| `stayready.property` | 96 | None. Static metadata and route definitions are excluded from activity dates. |
| `stayready.stay` | 96 | `check_in`, `check_out`, as represented service dates. |
| `stayready.person` | 288 | None. Identities are excluded from dated activity. |
| `stayready.source` | 672 | `observed_at`, as occurrence/receipt dates. Embedded arrival facts are not additional observations. |
| `stayready.need` | 672 | `conditions.arrival_at`, access `window.start/end`, and breakfast `morning_dates`, as service dates. |
| `stayready.request` | 288 | `submitted_at` and every reply's `at`, as occurrence dates. |
| `stayready.commitment` | 192 | `confirmed_at` and notice `recorded_at`, as occurrences; actual terms and notice `effective_at`, as service dates. |
| `stayready.history` | 960 | `at`, as operation/event occurrence dates. Shared event dates are deduplicated globally. |

The **384 static property/person records** remain in the record count but contribute no date. Generation dates, file modification times, provenance-version strings, the scenario clock and reference-page collection dates are excluded. The checker also validates every request/reply-to-history link, per-seed chronology, schema/business invariants and hash. It reports **zero invalid dates**, **zero out-of-window dates** and **347 calendar dates without represented records**; the full gap list is included.

| Month | Scenarios | Synthetic records | Occurrence dates | Service dates | Global dates in month |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2025-01 | 4 | 132 | 4 | 12 | 15 |
| 2025-02 | 4 | 136 | 6 | 11 | 14 |
| 2025-03 | 4 | 140 | 11 | 12 | 16 |
| 2025-04 | 4 | 132 | 8 | 12 | 17 |
| 2025-05 | 4 | 136 | 5 | 12 | 15 |
| 2025-06 | 4 | 140 | 5 | 12 | 16 |
| 2025-07 | 4 | 132 | 9 | 12 | 19 |
| 2025-08 | 4 | 136 | 9 | 12 | 16 |
| 2025-09 | 4 | 140 | 8 | 12 | 17 |
| 2025-10 | 4 | 132 | 5 | 12 | 15 |
| 2025-11 | 4 | 136 | 9 | 12 | 20 |
| 2025-12 | 4 | 140 | 8 | 12 | 18 |
| 2026-01 | 4 | 132 | 7 | 12 | 16 |
| 2026-02 | 4 | 136 | 7 | 11 | 15 |
| 2026-03 | 4 | 140 | 11 | 12 | 17 |
| 2026-04 | 4 | 132 | 7 | 12 | 16 |
| 2026-05 | 4 | 136 | 8 | 12 | 18 |
| 2026-06 | 4 | 140 | 5 | 12 | 16 |
| 2026-07 | 4 | 132 | 4 | 12 | 15 |
| 2026-08 | 4 | 136 | 7 | 12 | 13 |
| 2026-09 | 4 | 140 | 9 | 12 | 15 |
| 2026-10 | 4 | 132 | 4 | 12 | 13 |
| 2026-11 | 4 | 136 | 6 | 12 | 16 |
| 2026-12 | 4 | 140 | 5 | 12 | 15 |

Monthly record counts are grouped by the scenario's check-in month. Date distribution is grouped by each record's actual represented local date, so a request lead time can contribute an occurrence in the previous month. Every month has substantive scenarios and 13–20 represented dates. Real/mixed guest-record counts remain zero in every month. Tasks must select relevant scenarios and enforce their own first-session cutoff; the full library is not automatically personal history for any one Task.

## Reproduce and query

From the repository root (Node **22.23.5** used for this revision):

```sh
node apps/stayready/scripts/generate-dataset.cjs
node apps/stayready/scripts/check-dataset.cjs --write
node apps/stayready/scripts/check-dataset.cjs
node --test apps/stayready/tests/dataset.test.cjs
STAYREADY_REPORT_DIR=.artifacts/stayready-dataset node apps/stayready/tests/dataset-mcp.cjs
```

The first two commands intentionally regenerate data and its coverage after an authored change. Normal checking verifies the existing report instead of silently replacing it. The dedicated tests reproduce every seed through plugin operations, check all four business patterns and verify contribution → full declaration → manifest links and counts.

The MCP driver uses the real public `prepare`/`Client` runtime (`PALE_RUNTIME_ROOT` can select an external pinned runtime). Infra calls `env.load_seed` for **every one of the 96 seeds**, with the trusted binding and manifest time; a separate Agent process calls `stayready.inspect`. The driver checks complete request/reply and history equality against each seed, request-to-confirmed-promise links, account/owner, terms, pattern-specific results, hidden private background and absence of read-side mutation. This proves loading and retrieval of the counted histories through the actual public interface.

Each report row retains seed/binding hashes, initial clock, actual load result/version, request correlation ID, retrieved request/reply summaries and history/state hashes. Full seed bodies remain available at their recorded paths and hashes. `STAYREADY_REPORT_DIR` controls the destination; the default is `apps/stayready/.artifacts/dataset`. The final checked evidence index links the submission run.

**Revision validation:** dedicated dataset tests **3/3 passed** and real Infra/Agent MCP loading/retrieval **96/96 passed** on Node v22.23.5 with public runtime 1.6.0. The loaded history totals are **288 requests** and **960 history records**. Both coverage boundaries were retrieved; private source background was absent and inspection did not alter persisted state. Final package hashes are recorded with the submission evidence after the remaining package edits are frozen.
