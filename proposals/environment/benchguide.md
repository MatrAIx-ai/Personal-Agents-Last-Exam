# BenchGuide multimodal lab-testing and product-recommendation guide

**Proposed PR title** — `[Environment Proposal] [News & information + Shopping & groceries] BenchGuide multimodal lab-testing and product-recommendation guide`

## 1. App and domains

- **Authors / GitHub handles (required):** @shangliy
- **Reference app or website / URL (required):** BenchGuide is an independently branded synthetic product-testing publication and personalized buying-guide recommender. [RTINGS](https://www.rtings.com/) and [Wirecutter](https://www.nytimes.com/wirecutter/) are public references for structured lab measurements, measurement charts, multi-attribute weighted ranking, side-by-side comparison matrices, and dated pick revisions.
- **Primary domain (required):** News & information
- **Secondary domains (optional):** Shopping & groceries

## 2. What you plan to build

**✍️ Your answer (required):** BenchGuide lets a personal agent search independent lab-tested consumer products, inspect both structured measurements and synthetic lab-test charts (`ctx.assets` PNGs such as noise-vs-mode curves, battery decay curves, and thermal plots), re-rank candidates under a user's personal constraints and attribute weights, and track dated editorial revisions when a former "Top Pick" is downgraded for reliability or safety defects. Marketing blurbs and legacy overall scores often disagree with what a specific household needs — or with a freshly measured test curve — so the agent must combine structured spec search, visual chart inspection, user-owned shortlist state, and revision provenance rather than picking the highest headline score.

### Three example requests

| User request | What the user and agent encounter | What a reviewer can check |
| --- | --- | --- |
| **Constraint-aware shortlist recommendation.** “Pick the best air purifier from my saved shortlist for our bedroom — keep my weight profile and check whether it’s actually quiet on high.” | The user's saved shortlist has four purifiers. The #1 overall pick's marketing summary calls it “quiet,” and its headline score is highest, but its attached lab noise-curve chart (`ctx.assets` PNG) shows a `71 dB` spike on high mode, exceeding the user's `<= 58 dB` bedroom preference. The #2 overall pick wins under the user's custom weights (`noise: 0.45, filtration: 0.35, filter_cost: 0.20`) and stays at `52 dB` on high. | The agent inspects the shortlist, applies the user's stored weight profile, reads the attached measurement chart, rejects the #1 overall model with the chart-verified dB evidence, and records the selected recommendation in the user's shortlist without modifying editorial lab scores. |
| **Revision & downgrade reconciliation.** “I saved your Top Pick cordless vacuum last spring and want to buy it tonight — is it still the best choice for pet hair and hardwood?” | A seeded `review.revise` event downgraded last spring's Top Pick from `recommended` to `downgraded` due to a battery-controller failure rate reported in October 2026, while promoting a newer runner-up with a HEPA seal and lower weight. The user's old saved note still labels the old unit “Top Pick.” | The agent checks the product's revision log (`rev_2`), warns the user that the saved Top Pick was downgraded with exact date and reason, compares it against the current pet-hair pick, and updates the user's saved shortlist tag rather than endorsing the stale pick. |
| **Side-by-side comparison & dismissal feedback.** “Compare my top two travel headphones for a 12-hour flight, drop anything without multi-point Bluetooth, and email me the comparison card.” | One candidate lacks multi-point Bluetooth; another has a battery-curve chart showing `14 h` with ANC on at `75 dB` ambient cabin noise. The agent dismisses the non-compliant item (`not_interested` with reason), keeps the surviving comparison matrix, and optionally sends a structured summary artifact if Mail attachment delivery is enabled. | The comparison table excludes the dismissed SKU, preserves the user's dismissal reason in account state, cites the ANC runtime from the measurement asset, and (when optional Mail 1.3.0 is enabled) verifies receiver-side inbox record and receipt. |

**Related work.** Cornerpost ([PR #66](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/66)) models crowd-sourced local business reviews; PriceWatch ([PR #221](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/221)) monitors checkout price quotes on a known SKU; RecallWatch ([PR #143](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/143)) tracks regulatory recall bulletins; Dayline ([PR #213](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/213)) groups general news editions. BenchGuide's unit is a **structured lab-tested product review with multimodal measurement charts, user-weighted multi-attribute ranking, personal shortlists/dismissals, and versioned editorial pick revisions**. It contains no checkout/cart flow and no live price scraping, and runs independently of all four proposals.

## 3. Potential app connections

- **Internal personal apps (required):** None required for v1 core workflows. **Optional:** `mail` (`examples/apps/mail`, v1.3.0) via `channel.email.attachments` (`org.pale.mail.attachments.v1`, payload `urn:pale:email-attachments-payload:1`) to email an exported Markdown/JSON comparison brief when a task explicitly enables Mail delivery and grants the attachment channel. If Mail is absent or ungranted, BenchGuide still completes comparison and shortlist export locally without error.
- **Other apps and websites (required):** None at runtime. All product IDs, spec tables, revision logs, and measurement charts resolve to self-contained local synthetic fixtures.

### Integration details

- **Operations and access (required):** Agent-facing MCP tools expose: (1) `catalog.search` (filter by category, hard spec bounds, editorial status, keyword, and sort by default score or user weight profile); (2) `review.get` (structured specs, pros/cons, revision history, and `asset_ids` for lab charts); (3) `asset.read` (reads attached measurement PNGs through Core's `ctx.assets.read` under parent permissions); (4) `compare.matrix` (side-by-side spec & weighted-score table for 2–4 products); (5) `profile.get_weights` / `profile.set_weights` (manage normalized attribute weights and hard constraints such as max noise dB or allergy filter); (6) `shortlist.list` / `shortlist.save` / `shortlist.remove` / `shortlist.dismiss` (manage saved candidates and negative-feedback reasons). Read tools never mutate business state. Privileged Infra management uses `env.setup`, `env.reset`, and `env.apply_event`.
- **State and lifecycle (required):** Public editorial catalog state (products, lab metrics, revision records, chart assets) is isolated per run fixture; private user state (shortlists, weight profiles, dismissed items with reasons, comparison exports) is isolated per bound account instance. Writes check request IDs and state versions via Core; saving an already-shortlisted product is idempotent; invalid weight vectors (negative or zero-sum) or unknown product IDs are rejected with no state mutation. Reset restores baseline fixtures, chart assets (`ctx.assets`), revisions, account state, and virtual clock. Infra can snapshot state and `state.audit` for evaluation.
- **Events and notifications (required):** Infra applies two scripted events via `env.apply_event`: `review.revise` (appends a dated editorial revision, e.g., downgrading a Top Pick or updating a lab metric and optional chart asset) and `catalog.publish` (adds a newly tested product review). Unknown `product_id` or malformed revision payloads abort atomically; replaying an identical `event_id` is idempotent. Optional outbound notification uses CloudEvents 1.0 on `channel.email.attachments` when configured; BenchGuide receives no cross-app notifications.

```json
{
  "event_id": "rev-vac-2026-10-18",
  "at": "2026-10-18T09:00:00-07:00",
  "operation": "review.revise",
  "payload": {
    "product_id": "vac-aeroglide-s4",
    "revision_id": "rev_2",
    "published_at": "2026-10-18T08:30:00-07:00",
    "new_pick_status": "downgraded",
    "previous_pick_status": "top_pick",
    "summary": "Long-term 6-month durability test found 28% battery-controller failure rate; removed Top Pick badge.",
    "metric_updates": { "reliability_score": 4.8, "overall_score": 7.1 }
  }
}
```

- **Shared data and dependencies (required):** Node.js 18+ and the public Core runtime (`runtime 1.5.0` with `ctx.assets`). Fixtures ship as UTF-8 JSON plus ~20–24 synthetic PNG lab-measurement charts (~450 KiB total decoded bytes, well within the per-App `64-asset / 1 MiB` budget) generated offline with Python/Matplotlib and verified by SHA-256 manifest. The App package runs standalone with only the shared Core runtime; optional Mail 1.3.0 integration is tested separately via `app:verify --with examples/apps/mail`.

## 4. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| --- | --- | --- | ---: |
| Web / app construction | Implement MCP tool handlers (`catalog.search`, `review.get`, `asset.read`, `compare.matrix`, `profile.*`, `shortlist.*`), deterministic weighted-ranking engine, revision history view, and lightweight local GUI preview. | Verify constraint search, custom weight re-ranking, revision downgrade detection, idempotent shortlist saves, and strict read-only purity across two isolated accounts. | 3–4 |
| Data and image collection | N/A — all products, brands, test metrics, and charts are 100% synthetic with zero scraped or copyrighted third-party data. | Fixture manifest certifies zero external copyrighted assets. | 0 |
| Synthetic data and assets | Author 24–28 fictional products across 4 household categories (air purifiers, cordless vacuums, ANC headphones, espresso/coffee grinders) with 10+ lab metrics each, revision histories, and 20–24 synthetic matplotlib PNG measurement charts (`<= 500 KiB` total) where key trade-offs (e.g., noise spikes, runtime curves) are visually encoded in charts. | Validate schema conformance, SHA-256 asset integrity, `<= 64 assets / <= 1 MiB` budget compliance, zero duplicate assets, and legibility of every generated PNG chart. | 2–3 |
| App integrations | Core workflows run standalone on Core 1.5.0; add optional `messaging.publishes` declaration for `channel.email.attachments` (`org.pale.mail.attachments.v1`) to send comparison briefs to Mail 1.3.0. | Run standalone check plus optional `app:verify --with examples/apps/mail` verifying receiver-side inbox record, attachment SHA-256 bytes, and clean denial when ungranted. | 1 |
| Validation and reset | Build App-local business unit tests plus public-runtime verification covering `env.apply_event` (`review.revise`, `catalog.publish`), idempotent replay, invalid weight/ID rejection, `ctx.assets` read permissions, rollback, and full reset. | Publish exact runtime/App versions, CLI commands (`npm run app:verify`), and `.artifacts/` JSON verification reports in the PR. | 1.5–2 |

- **Milestones, owners and dependencies (required):** Owner: @shangliy. Sequence: (1) schemas, weighted-ranking logic & MCP handlers (days 1–4); (2) synthetic catalog + matplotlib lab charts + `ctx.assets` manifest (days 5–7); (3) optional Mail attachment publisher + business/runtime tests + `app:verify` (days 8–10). Fits comfortably within the 14-calendar-day v1 delivery window after `/approve-plan`. No blocking PR dependencies.
- **Resources and total effort (required):** 7.5–10 person-days total. Local Node.js 18+ and Python/Matplotlib for offline synthetic chart generation; zero API or paid data costs; `< 1 MiB` fixture footprint.
- **Scope boundary and open questions (required):** v1 covers structured lab reviews, synthetic measurement charts (`ctx.assets`), user weight profiles, constraint filtering, side-by-side comparison, shortlists/dismissals, and versioned revisions. Out of scope: live e-commerce pricing, shopping carts/checkout, crowd-sourced user reviews, and OCR/PDF parsing. Open question for reviewers: whether optional `channel.email.attachments` export to Mail 1.3.0 should remain optional in v1 or be deferred to v1.1.
- **License and external dependencies (required):** MIT License for all code, synthetic fixtures, and generated PNG charts. RTINGS and Wirecutter are design references only; zero external runtime services, credentials, or licensed media required.
