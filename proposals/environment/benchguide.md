# BenchGuide multimodal lab-testing and product-recommendation guide

**Proposed PR title** — `[Environment Proposal] [News & information + Shopping & groceries] BenchGuide multimodal lab-testing and product-recommendation guide`

## 1. App and domains

- **Authors / GitHub handles (required):** @shangliy
- **Reference app or website / URL (required):** BenchGuide is an independently branded synthetic product-testing publication and personalized buying-guide recommender. [RTINGS](https://www.rtings.com/) and [Wirecutter](https://www.nytimes.com/wirecutter/) are public references for structured lab measurements, measurement charts, multi-attribute weighted ranking, side-by-side comparison matrices, and dated pick revisions.
- **Primary domain (required):** News & information
- **Secondary domains (optional):** Shopping & groceries

## 2. What you plan to build

**✍️ Your answer (required):** BenchGuide lets a personal agent search independent lab-tested consumer products, inspect both structured measurements and synthetic lab-test PNG charts delivered as MCP resources (`pale://<run>/benchguide/assets/<asset_id>`, showing noise-vs-mode curves, battery decay curves, and thermal plots), re-rank candidates under a user's personal constraints and attribute weights, and track dated editorial revisions when a former "Top Pick" is downgraded for reliability or safety defects. Marketing blurbs and legacy headline scores often disagree with what a specific household needs — or with a freshly measured test curve — so the agent must combine structured spec search, MCP image inspection, user-owned shortlist state, and revision provenance rather than picking the highest headline score.

### Three example requests

| User request | What the user and agent encounter | What a reviewer can check |
| --- | --- | --- |
| **Constraint-aware shortlist recommendation & matched visual-only check.** “Pick the best air purifier from my saved shortlist for our bedroom — keep my weight profile and check whether it’s actually quiet on high.” | The user's saved shortlist has multiple air purifiers. The #1 overall pick (`purifier-clearair-x9`) calls itself “quiet” in its summary and holds the highest headline score (`9.2`), but its attached lab noise-curve chart (read via MCP `resources/read`) shows a `71 dB` spike on high mode, exceeding the user's `<= 58 dB` bedroom ceiling. In addition, BenchGuide includes a **matched visual-only pair** (`purifier-calmair-m5` vs `purifier-quietmist-m6`) whose text summaries, features, price, and structured metrics are completely identical (with `measured_noise_db_high: null` / `"see lab acoustic curve"`), differing **only** in their attached PNG noise curves (`57 dB` vs `59 dB` on high mode against the `58 dB` cap). | For the headline shortlist case, the agent rejects the louder `71 dB` Top Pick (`purifier-clearair-x9`) in favor of `purifier-pureleaf-s1` (`52 dB`). For the matched visual-only pair (`57 dB` vs `59 dB`), an **image-on** multimodal trace (actual PNG bytes passed to the model + Core `state.audit`) picks the `57 dB` unit, while an **image-off control** confirms text and structured fields alone cannot reveal the answer. |
| **Revision & downgrade reconciliation.** “I saved your Top Pick cordless vacuum last spring and want to buy it tonight — is it still the best choice for pet hair and hardwood?” | A prewritten `benchguide.review.revise` event downgraded last spring's Top Pick (`vac-aeroglide-s4`) from `top_pick` to `downgraded` (`rev_2`) due to a 28% battery-controller failure rate found in 6-month durability testing, while a runner-up with HEPA sealing remains recommended. The user's old shortlist note still calls `vac-aeroglide-s4` “Top Pick.” | The agent inspects the product's immutable `revisions[]` log, warns the user with the exact downgrade date and reason, compares it against current picks via `benchguide.compare.matrix`, and updates/removes the stale shortlist entry rather than endorsing the downgraded unit. |
| **Side-by-side comparison & dismissal feedback.** “Compare my top two travel headphones for a 12-hour flight and drop anything without multi-point Bluetooth.” | One candidate lacks `multipoint_bluetooth`; another has an attached battery-curve PNG chart showing `14 h` ANC runtime under cabin noise. The agent dismisses the non-compliant item (`benchguide.shortlist.dismiss` with explicit reason) and keeps the surviving comparison matrix in account state. | The comparison excludes the dismissed SKU, preserves the dismissal reason in account state, automatically removes the dismissed item from shortlist if present, and cites the verified ANC runtime from the MCP chart resource. |

**Related work.** Cornerpost ([PR #66](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/66)) models crowd-sourced local business reviews; PriceWatch ([PR #221](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/221)) monitors checkout price quotes on a known SKU; RecallWatch ([PR #143](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/143)) tracks regulatory recall bulletins; Dayline ([PR #213](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/213)) groups general news editions. BenchGuide's unit is a **structured lab-tested product review with multimodal measurement charts, user-weighted multi-attribute ranking, personal shortlists/dismissals, and versioned editorial pick revisions**. It contains no checkout/cart flow and no live price scraping, and runs independently of all four proposals.

## 3. Potential app connections

- **Internal personal apps (required):** None required for v1. BenchGuide runs completely standalone in v1 (keeping comparison export self-contained; optional outbound Mail attachment delivery via `channel.email.attachments` is deferred post-v1 unless requested by reviewers).
- **Other apps and websites (required):** None at runtime. All product IDs, spec tables, revision logs, and measurement charts resolve to self-contained local synthetic fixtures.

### Integration details

- **Operations and access (required):** All Agent-facing MCP tools carry the `benchguide.` prefix (`runtime 1.6.0` / `core_api_version 1.2.0`):
  1. `benchguide.catalog.search` (read-only) — filter products by `category`, `query`, `pick_status`, `max_price_usd`, `max_noise_db_high`, `require_feature`, `exclude_dismissed`, and `sort_by` (`"overall"` | `"weighted"` | `"price_asc"`).
  2. `benchguide.review.get` (read-only) — returns full structured specs, lab metrics, immutable `revisions[]` history, `weighted_score`, `asset_ids`, and resolved MCP resource URIs (`pale://<run>/benchguide/assets/<asset_id>`).
  3. **Image delivery via MCP resources:** Lab measurement PNG charts reach the Agent via standard PALE MCP resources (`resources/list` and `resources/read` on `pale://<run>/benchguide/assets/<asset_id>`, audited in Core by `runtime/core/mcp.cjs`). `benchguide.asset.read` (read-only) is additionally exposed for deterministic JSON/SHA-256 verification via `ctx.assets.read`, while multimodal visual inspection by Agents uses MCP `resources/read`.
  4. `benchguide.compare.matrix` (read-only) — side-by-side spec, metric, feature, and `weighted_score` matrix for 2–4 products plus deterministic `winner_id`.
  5. `benchguide.profile.get_weights` (read-only) & `benchguide.profile.set_weights` (write) — read/update normalized attribute weights (`noise_score`, `performance_score`, `reliability_score`, `value_score`; non-negative, positive sum; normalized to sum to 1.0) and hard constraints (`max_noise_db_high`, `max_price_usd`, `required_features`).
  6. `benchguide.shortlist.list` (read-only), `benchguide.shortlist.save` (write), `benchguide.shortlist.remove` (write), `benchguide.shortlist.dismiss` (write) — manage saved candidates and dismissal reasons (`dismiss` removes the SKU from shortlist if present).
  - **Deterministic weighted scoring & tie-break:** `weighted_score = round2((m.noise_score * w.noise_score + m.performance_score * w.performance_score + m.reliability_score * w.reliability_score + m.value_score * w.value_score) / sum(w))`, computed strictly from structured metrics (never hidden chart-only visual cues). Ties break by lexicographical ascending `product_id`.
  - **Privileged Infra operations:** standard Core `runtime 1.6.0` administrative tools only — `env.load_seed`, `env.reset`, `env.apply_event`, `env.snapshot`, `env.event_status`, `env.validate_bundle`, and host clock `env.advance_time`.

- **State, account binding, and lifecycle (required):**
  - **Bound user & seeds:** The Agent acts for the bound user whose `person_id` is `owner_person_id` on the single `benchguide` account in `binding.json`. Different household weight profiles are supplied as separate seed fixtures (one account per run loaded via `env.load_seed`).
  - **Concurrency, evaluation-data coverage & reset:** All writes are guarded by Core `request_id` idempotency and optimistic `expected_version` (`epoch`/`revision`) checks; saving an already-shortlisted product is idempotent (updating its note); negative/zero-sum weight vectors or unknown `product_id`s reject atomically without mutating state. `env.reset` restores baseline catalog, chart assets, revisions, profile/shortlist/dismissed state, and virtual clock. Relative temporal queries ("last spring", "tonight") resolve against `ctx.virtual_now`.
  - **Environment evaluation-data coverage plan (`docs/submission-evidence.md` §3):**
    - **Coverage window & time zone:** Delivered evaluation data (`fixtures/eval-2025-2026.json`) covers **`2025-01-01` through `2026-12-31`, inclusive** (24 calendar months), counted in IANA time zone **`America/Los_Angeles`**. The compact `fixtures/minimal.json` remains as the smoke-test fixture for fast `app:verify` checks.
    - **Authoritative date fields:** `products[].published_at`, `products[].updated_at`, `products[].revisions[].published_at`, `shortlist[].saved_at`, and `dismissed[].dismissed_at` (represented occurrence/publication dates normalized to `America/Los_Angeles`; file modification/generation dates are never counted).
    - **Provenance & synthesis:** 100% synthetic (authored seasonal review batches, 6-month durability retests, pick revisions, and Matplotlib PNG curves across all 24 months; zero real-data access gaps; MIT License).
    - **Reproducible delivery check:** At v1 delivery, a reproducible script computes total record count, per-source distinct-date counts, global deduplicated distinct-date count, earliest/latest dates, and a 24-month (`2025-01`..`2026-12`) breakdown over the delivered dataset, paired with a real `env.load_seed` + `benchguide.catalog.search` / `benchguide.review.get` load-and-query verification.

- **Events and notifications (required):** Infra applies two scripted events via `env.apply_event`:
  1. `benchguide.review.revise` — appends an immutable dated revision to an existing product, updating `pick_status`, `updated_at`, optional `metric_updates`, and optional updated chart asset via `env.apply_event` (`bundle`), keeping `resources/list` and `benchguide.review.get` `asset_ids`/`resource_uris` in sync. Rejects unknown `product_id`, duplicate `revision_id`, unknown metric key, or backwards timestamp atomically as `invalid_event`.
  2. `benchguide.catalog.publish` — adds a newly tested product review; rejects duplicate `id` atomically as `invalid_event`.
  - Replaying an identical `event_id` is deduplicated by Core; reusing an `event_id` with modified payload rejects with `idempotency_conflict`. BenchGuide sends and receives no cross-app notifications in v1.

```json
{
  "event_id": "rev-vac-2026-10-18",
  "at": "2026-11-18T09:10:00-08:00",
  "operation": "benchguide.review.revise",
  "payload": {
    "product_id": "vac-aeroglide-s4",
    "revision_id": "rev_2",
    "published_at": "2026-11-18T09:05:00-08:00",
    "new_pick_status": "downgraded",
    "summary": "Long-term 6-month durability test found 28% battery-controller failure rate; removed Top Pick badge.",
    "metric_updates": { "reliability_score": 4.8, "overall_score": 7.1 }
  }
}
```

- **Shared data and dependencies (required):** Node.js 18+ and the public Core runtime (`runtime 1.6.0`, `core_api_version 1.2.0`). Fixtures ship as UTF-8 JSON plus 20–24 synthetic PNG lab-measurement charts (~126–450 KiB total decoded bytes, well within the per-App `64-asset / 1 MiB` budget) generated offline with Python/Matplotlib and verified by SHA-256 catalog. The App runs standalone (`ui: "none"`) with only the shared Core runtime and zero external dependencies.

## 4. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| --- | --- | --- | ---: |
| App & MCP tool construction | Implement all `benchguide.*` MCP handlers (`catalog.search`, `review.get`, `asset.read`, `compare.matrix`, `profile.*`, `shortlist.*`) and deterministic weighted-ranking engine (`ui: "none"`, no GUI host needed in v1). | Verify constraint search, custom weight normalization & re-ranking, revision downgrade detection, idempotent shortlist saves, MCP `resources/list` + `resources/read` delivery, and read-only purity. | 3–4 |
| Data and image collection | N/A — all products, brands, test metrics, and charts are 100% synthetic with zero scraped or copyrighted third-party data. | Fixture manifest certifies zero external copyrighted assets. | 0 |
| Synthetic data and assets | Author 20–28 fictional products across 4 household categories (air purifiers, cordless vacuums, ANC headphones, coffee grinders), including the compact smoke-test fixture (`fixtures/minimal.json`) plus a 24-month evaluation dataset (`fixtures/eval-2025-2026.json`) spanning `2025-01-01` through `2026-12-31` (`America/Los_Angeles`), 20–24 synthetic Matplotlib PNG measurement charts (`<= 500 KiB` total, including the matched `57 dB` vs `59 dB` visual-only pair), and an evaluation-only cue manifest manually checked against rendered PNGs. | Validate JSON schema, SHA-256 asset catalog, `<= 64 assets / <= 1 MiB` budget compliance, zero duplicate assets, legibility of every generated PNG chart, and a reproducible 24-month coverage report + load/query check. | 2–3 |
| App integrations | All v1 workflows run standalone on Core `runtime 1.6.0` (Mail export is explicitly deferred post-v1; zero cross-app dependencies in v1). | Run standalone `npm run app:verify` with only BenchGuide and Core enabled. | 0 |
| Acceptance: Weighted re-rank, visual-only control & revision downgrade | Verify weighted search re-ranks bedroom air purifiers `<= 58 dB` (`purifier-pureleaf-s1` above louder Top Pick `purifier-clearair-x9`), `benchguide.review.revise` downgrades `vac-aeroglide-s4` while preserving immutable `rev_1` + `rev_2`, zero-sum weights / cross-product asset reads reject atomically, and the matched visual-only pair (`purifier-calmair-m5` `57 dB` vs `purifier-quietmist-m6` `59 dB` against `58 dB` cap) includes both an **image-on multimodal trace** (actual image bytes input + Core `state.audit`) and an **image-off control** confirming text/structured fields alone cannot distinguish them. | Automated assertions in `tests/business.test.cjs` + `examples/run.cjs` (zero state mutation on rejected calls) plus matched image-on vs image-off trace evidence and reproducible `2025-01-01`..`2026-12-31` monthly coverage + load/query report at delivery. | 1 |
| Validation and reset | Run App-local business unit tests plus `npm run app:verify` covering `env.load_seed`, `env.apply_event` (`benchguide.review.revise`, `benchguide.catalog.publish`), idempotent replay, conflict rejection, `env.advance_time`, MCP `resources/read`, and `env.reset`. | Publish exact runtime/App versions (`runtime 1.6.0`), CLI commands (`npm run app:verify`), and `.artifacts/` JSON verification report in the PR. | 1.5 |

- **Milestones, owners and dependencies (required):** Owner: @shangliy. Proposal & implementation order across my open Environment Track proposals: **1st `#234` (QuestShelf) → 2nd `#233` (BenchGuide) → 3rd `#235` (LoopVault)** — requesting one `/approve-plan` at a time so 14-calendar-day implementation windows never overlap. Sequence for BenchGuide after `/approve-plan`: (1) schemas, weighted-ranking logic & `benchguide.*` handlers (days 1–4); (2) synthetic catalog + matplotlib lab charts + asset catalog (days 5–7); (3) business/runtime tests, MCP resource checks & `app:verify` (days 8–10). No blocking PR dependencies.
- **Resources and total effort (required):** 7–9 person-days total. Local Node.js 18+ and Python/Matplotlib for offline synthetic chart generation; zero API or paid data costs; `< 1 MiB` fixture footprint.
- **Scope boundary and open questions (required):** v1 covers structured lab reviews, synthetic measurement charts via MCP resources, user weight profiles, constraint filtering, side-by-side comparison, shortlists/dismissals, and immutable versioned revisions (`ui: "none"`). Out of scope: live e-commerce pricing, shopping carts/checkout, crowd-sourced user reviews, OCR/PDF parsing, GUI views, and cross-app Mail export (deferred post-v1).
- **License and external dependencies (required):** MIT License for all code, synthetic fixtures, and generated PNG charts. RTINGS and Wirecutter are design references only; zero external runtime services, credentials, or licensed media required.
