# Delivered dataset coverage

The delivered evaluation library contains **96 independent, loadable synthetic scenarios**, four in each month from January 2025 through December 2026. Each run has one fictional property, a fixed two-night reservation and exactly two current guests. Three people exist in the identity binding so the companion can be replaced; this never adds a third registered guest.

This is a library of independent hotel-service situations, not a continuous two-year history of one traveler. Every guest, personal fact, hotel policy, commitment and represented event date in the library is synthetic. The monthly sampling is intentionally even for reproducible evaluation; it is not an estimated empirical booking distribution. The four monthly situations have distinct operational consequences:

| Pattern | Meaningful difference from an unchanged baseline |
| --- | --- |
| `arrival-mismatch` | Current arrival is later than a previously confirmed window. Monthly variants change the later time and access method; the old commitment is retained. |
| `route-unavailable` | The named step-free route carries an already-effective notice, with corridor closure and lift failure variants. A label alone cannot establish usability. |
| `breakfast-partial` | Both mornings are requested but only the first is confirmed. Six meal request values rotate across people and scenarios; the second morning remains unresolved. |
| `guest-replaced` | The companion has changed. The former guest's breakfast commitment remains active, while current-person need flags identify the new companion. |

The seeds describe an initial state with existing commitments. They do not invent completed message exchanges: `request_id: null` explicitly represents an imported initial commitment and request/history arrays are empty. Subsequent requests and hotel replies are exercised through App tools and authorized events. Known source observations and existing confirmations precede each scenario's `initial_time`; future service dates are visible obligations, not completed stays.

## Provenance and the November 2026 anchor

[manifest.json](../datasets/manifest.json) records every seed path, SHA-256, byte size, record counts, clock, generation method and the exact baseline/generator hashes. Records use the identity tuple `(scenario_id, record_type, id)` across the library; ordinary App IDs are reused only inside separate reset runs. The same fixture binding maps `stayready-alex` to its owner and three synthetic people. No private data or real transaction was copied.

Three real public-document observations, collected **2026-11-26**, are kept separately in [reference/sources.json](reference/sources.json), with actual public-page screenshots and hashes. They concern Booking.com request/arrival guidance and Premier Inn access/breakfast workflows. They supply a factual workflow anchor, **not real hotel guest records**. They are not blended into the seed count or assigned fictitious 2025 publication dates. Public reference coverage is one observation date in November 2026; historical and later public-page versions were not collected.

**Maintainer review remains pending** on whether these official public workflow facts are an acceptable real reference anchor and public-page alternative for the original synthetic StayReady environment under the November 26 evidence policy. No approval or exemption is claimed. There are no real or mixed guest records; all 1,992 delivered App records are synthetic, including those dated after collection.

## Counts and date semantics

[coverage.json](../datasets/coverage.json) is computed from the delivered JSON, with **UTC** as the IANA counting zone. It reports 1,992 business records, of which 480 static property/person records have no occurrence date. The global union is **384 represented calendar dates**, from **2025-01-01 through 2026-12-31**. Of these, **96 dates** hold synthetic source observations or confirmations, and **288 dates** describe stay/service timing. These are disjoint in this library. The 384-date union is **not** 384 days of pre-session personal history.

| Record source | Records | Authoritative dates used |
| --- | ---: | --- |
| `stayready.property` | 96 | None; static metadata and route availability windows are excluded from history counts. |
| `stayready.stay` | 96 | `check_in`, `check_out` as represented service dates. |
| `stayready.person` | 288 | None; identity records are excluded from date counts. |
| `stayready.source` | 672 | `observed_at` as occurrence/receipt dates. Embedded future arrival facts are not a second observation. |
| `stayready.need` | 672 | `conditions.arrival_at`, access `window.start/end`, breakfast `morning_dates` as represented service dates. |
| `stayready.commitment` | 168 | `confirmed_at` and notice `recorded_at` as occurrences; actual terms and notice `effective_at` as service dates. |
| Requests/history | 0 | The checker supports `submitted_at`, reply `at` and history `at` if these records are introduced. |
| Official public references | 3, reported separately | Actual observation date `2026-11-26`; none are loaded guest records. |

Date-only breakfast dates mean midnight-to-midnight in UTC. The checker rejects invalid or out-of-window dates, verifies schema/business invariants and hashes, and deduplicates dates globally across fields, records and scenarios. Generation timestamps, file modification times, provenance-version strings and the scenario clock are never counted as guest activity. Static identities still count as records but not dated activity.

There are **346 calendar dates without represented records**. The explicit date list, per-source date lists and monthly breakdown appear in the generated report. Every month has substantive scenarios; no month is missing. There is no claim of daily activity or a mandatory 300-day history. Task authors must select a scenario, enforce their own first-session cutoff, and distinguish known confirmations from future service obligations; they must not expose a later scenario as earlier personal history.

| Month | Scenarios | Synthetic records | Occurrence dates | Service dates | Global dates in month |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2025-01 | 4 | 83 | 4 | 12 | 16 |
| 2025-02 | 4 | 83 | 4 | 12 | 16 |
| 2025-03 | 4 | 83 | 4 | 12 | 16 |
| 2025-04 | 4 | 83 | 4 | 12 | 16 |
| 2025-05 | 4 | 83 | 4 | 12 | 16 |
| 2025-06 | 4 | 83 | 4 | 12 | 16 |
| 2025-07 | 4 | 83 | 4 | 12 | 16 |
| 2025-08 | 4 | 83 | 4 | 12 | 16 |
| 2025-09 | 4 | 83 | 4 | 12 | 16 |
| 2025-10 | 4 | 83 | 4 | 12 | 16 |
| 2025-11 | 4 | 83 | 4 | 12 | 16 |
| 2025-12 | 4 | 83 | 4 | 12 | 16 |
| 2026-01 | 4 | 83 | 4 | 12 | 16 |
| 2026-02 | 4 | 83 | 4 | 12 | 16 |
| 2026-03 | 4 | 83 | 4 | 12 | 16 |
| 2026-04 | 4 | 83 | 4 | 12 | 16 |
| 2026-05 | 4 | 83 | 4 | 12 | 16 |
| 2026-06 | 4 | 83 | 4 | 12 | 16 |
| 2026-07 | 4 | 83 | 4 | 12 | 16 |
| 2026-08 | 4 | 83 | 4 | 12 | 16 |
| 2026-09 | 4 | 83 | 4 | 12 | 16 |
| 2026-10 | 4 | 83 | 4 | 12 | 16 |
| 2026-11 | 4 | 83 | 4 | 12 | 16 |
| 2026-12 | 4 | 83 | 4 | 12 | 16 |

Real/mixed guest-record counts are zero in every month. The complete report also contains each source's deduplicated date count, hash inputs, gaps and exclusions. Requests and commitments created during a demonstration are runtime results and do not silently increase these delivered-seed totals.

## Reproduce and query

From the repository root with Node 18+ (verified using Node 22):

```sh
node apps/stayready/scripts/generate-dataset.cjs
node apps/stayready/scripts/check-dataset.cjs --write
node apps/stayready/scripts/check-dataset.cjs
node apps/stayready/tests/dataset-mcp.cjs
```

Generation is deterministic. The first two commands intentionally regenerate data/report after an authored change. The third is the normal verification command: it checks the existing report rather than silently replacing it. Dataset checking uses the actual App seed validator and fails if a baseline or generator hash changes without regeneration.

The MCP driver uses the repository's real public `prepare`/`Client` runtime, with `PALE_RUNTIME_ROOT` supported for an external runtime checkout. It loads **every one of the 96 seeds** via Infra `env.load_seed`, explicitly supplies the fixture binding and the manifest's `initial_time`, then queries Agent `stayready.inspect`. It verifies account/owner, visible boundary dates, all record counts, pattern-specific business states, absence of private background in the Agent view and read-only state preservation. This exercises the same interfaces used by a Task; direct JSON counting alone is not the loading proof.

The driver writes `.artifacts/stayready/dataset-mcp.json` with per-seed input SHA-256, initial clock, correlation/request ID, exact load result/version, query counts/terms and persisted-state/query hashes. Seed bodies and binding are reproducible from the recorded file/hash references. The main evidence index retains the run result alongside other interface evidence.

**Loading result:** **passed, 96/96 seeds and all 24 months**, through the real Infra/Agent MCP processes on 2026-11-26 (Node v22.23.5, runtime 1.6.0). Both coverage boundaries were retrieved through Agent inspect. No private source background was returned and queries did not mutate persisted business state. The schema and App business validator also passed all 96 seeds.
