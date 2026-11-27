# BenchGuide (PALE Environment Track App)

Multimodal lab-testing publication, constraint-aware weighted product recommender, and revision-tracking buying guide built for PALE Core `1.2.0` (`runtime 1.6.0`, `ui: "none"`, zero external dependencies, MIT License).

## Package Highlights

- **20 synthetic lab-tested consumer products** across 4 categories (`air_purifier`, `cordless_vacuum`, `anc_headphones`, `coffee_grinder`) in `fixtures/minimal.json` + **2nd household weight-profile seed** (`fixtures/seed-value.json`), all historical timestamps `>= 2026-01-01`.
- **20 verified synthetic Matplotlib PNG measurement charts** (`assets/`, SHA-256 cataloged in `contribution/assets.catalog.json`, strictly within the `64-asset / 1 MiB` budget) covering noise-vs-mode curves, cordless battery decay curves, ANC cabin-noise endurance plots, and grinder retention bars.
- **Evaluation-only visual cue sheet** (`fixtures/visual-cues.eval.json`) recording chart types, measured curve values, threshold compliance, and visual traps — never exposed to Agent-facing tools.
- **10 MCP tools** (6 read-only, 4 versioned writes) + **2 Infra events** (`benchguide.review.revise`, `benchguide.catalog.publish`).
- **MCP Resources image delivery:** Agents list and inspect lab PNG charts via `resources/list` and `resources/read` on `pale://<run>/benchguide/assets/<asset_id>` (backed by `runtime/registrations/benchguide.json`). `benchguide.review.get` returns both `asset_ids` and resolved `resource_uris`. `benchguide.asset.read` is additionally exposed for deterministic JSON/SHA-256 verification via `ctx.assets.read`.

## Key Behavioral Guarantees

1. **Deterministic weighted scoring (`benchguide.catalog.search`, `benchguide.compare.matrix`):** Computes `weighted_score = round2((m.noise_score * w.noise_score + m.performance_score * w.performance_score + m.reliability_score * w.reliability_score + m.value_score * w.value_score) / sum(w))` strictly from structured metrics (never hidden visual cues), breaking ties by lexicographical ascending `product_id`.
2. **Immutable versioned revisions (`benchguide.review.revise`):** Appends dated revisions while preserving prior `revisions[]` entries, updates `pick_status`, `updated_at`, optional `metric_updates`, and optional `add_asset_id` (keeping `review.get` `asset_ids`/`resource_uris` and `plugin.assetReferences` in sync), and rejects unknown `product_id`, duplicate `revision_id`, unknown metric fields, or backwards timestamps atomically as `invalid_event`.
3. **Atomic user-state writes & idempotency:** `profile.set_weights` normalizes positive weight vectors and rejects zero-sum vectors with zero state mutation; `shortlist.save` is idempotent on `product_id`; `shortlist.dismiss` removes the SKU from `shortlist` if present and records the dismissal reason.

## Local Setup & Verification

Requires Node.js 18+ (no `npm install` needed).

```bash
# Standalone App-only checks (inside apps/benchguide)
cd apps/benchguide
npm test
npm run example

# Full PALE public runtime verification (from repo root)
npm run app:verify -- --app apps/benchguide --output .artifacts/benchguide.json

# Direct MCP stdio launch (Infra / Agent)
node apps/benchguide/service.cjs --role infra --run demo
node apps/benchguide/service.cjs --role agent --run demo
```

## Workflow-to-Test Mapping

| Proposal workflow / acceptance check | Covered in |
| --- | --- |
| Example 1: Bedroom air purifiers `<= 58 dB` weighted re-rank (`purifier-pureleaf-s1` above louder Top Pick `purifier-clearair-x9`) + MCP `resource_uris` | `tests/business.test.cjs` test 1 |
| `benchguide.asset.read` verified PNG magic header & cross-product access rejection | `tests/business.test.cjs` test 2 |
| `benchguide.compare.matrix` side-by-side comparison & weighted winner | `tests/business.test.cjs` test 3 |
| Example 2: `benchguide.review.revise` downgrades `vac-aeroglide-s4` preserving `rev_1` + `rev_2` + atomic invalid-event controls | `tests/business.test.cjs` test 4, `examples/run.cjs` |
| `benchguide.review.revise` `add_asset_id` URI/ref sync & `benchguide.catalog.publish` duplicate rejection | `tests/business.test.cjs` test 5 |
| Example 3: `multipoint_bluetooth` filter, idempotent `shortlist.save`, `shortlist.dismiss` removal & `exclude_dismissed` | `tests/business.test.cjs` test 6 |
| `profile.set_weights` normalization & zero-sum atomic rejection | `tests/business.test.cjs` test 7 |
| 2nd household weight-profile seed (`seed-value.json`) & evaluation visual-cues manifest (`visual-cues.eval.json`) | `tests/business.test.cjs` tests 8 & 9 |
| Core MCP `resources/list` + `resources/read`, `env.load_seed`, `env.apply_event`, `env.advance_time`, `env.reset`, idempotency | `npm run app:verify` |

## Scope & Limitations

- Synthetic lab-testing publication only; no checkout, live e-commerce prices, crowd reviews, or external network access.
- `ui: "none"` in v1; standalone on Core `runtime 1.6.0` (optional Mail export deferred post-v1).
- Local asset bundle budget: at most 64 assets / 1 MiB decoded bytes.
