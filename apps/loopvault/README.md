# LoopVault (PALE Environment Track App)

Multimodal personal automation and AI skill self-improvement studio with append-only version lineage, deterministic dev-vs-holdout anti-Goodhart gates, permission/budget policies, and atomic ancestor rollback built for PALE Core `1.2.0` (`runtime 1.6.0`, `ui: "none"`, zero external dependencies, MIT License).

## Package Highlights

- **6 personal automation skills (21 immutable versions)** in `fixtures/minimal.json` + **2nd policy profile seed** (`fixtures/seed-relaxed.json`), all historical timestamps `>= 2026-01-01`.
- **18 verified synthetic PNG diagnostic telemetry charts** (`assets/`, `305.0 KiB` total decoded bytes, SHA-256 cataloged in `contribution/assets.catalog.json`, strictly within the `64-asset / 1 MiB` budget) covering dev-vs-holdout curves, monthly cost/latency cliffs, and critical alert recall trends.
- **Evaluation-only visual cue sheet** (`fixtures/visual-cues.eval.json`) recording anomalies and visual traps — never exposed to Agent-facing tools.
- **15 MCP tools** (8 read-only, 7 versioned writes) + **2 Infra events** (`loopvault.run.regression_alert`, `loopvault.policy.update`).
- **MCP Resources image delivery:** Agents list and inspect diagnostic PNG charts via `resources/list` and `resources/read` on `pale://<run>/loopvault/assets/<asset_id>` (backed by `runtime/registrations/loopvault.json` mapping `skill -> loopvault.skills.get`). `loopvault.skills.get` returns both `asset_ids` and resolved `resource_uris`. `loopvault.asset.read` is also exposed for deterministic SHA-256 verification via `ctx.assets.read`.

## Key Behavioral Guarantees

1. **Anti-Goodhart & Policy Hard-Gate (`loopvault.policy.check`, `loopvault.deploy.promote`):** Evaluates `budget_exceeded`, `unauthorized_write_scope`, `holdout_below_threshold`, and `goodhart_overfit` strictly from structured fields (exact boundary `==` passes; never reads visual cues). `deploy.promote` hard-rejects violations atomically (`policy_violation`, zero state change); escalations use separate `deploy.request_approval` or `deploy.mark_rejected`.
2. **Immutable Append-Only Lineage & Ancestor Rollback (`loopvault.skills.lineage`, `loopvault.deploy.rollback`):** Existing versions are never mutated in place. `deploy.rollback` validates strict ancestor lineage along `parent_id` (rolling back `v5 -> v3` past broken `v4` while preserving immutable `v4` and `v5`).
3. **Deterministic Event Matching & Non-Silent Policy Tightening:** `loopvault.run.regression_alert` attaches to current `production_version_id` when `version_id` is omitted. `loopvault.policy.update` never silently rolls back active production versions; instead, subsequent reads derive `compliance_status: "non_compliant"`.

## Local Setup & Verification

Requires Node.js 18+ (no `npm install` needed).

```bash
# Standalone App-only checks (inside apps/loopvault)
cd apps/loopvault
npm test
npm run example

# Full PALE public runtime verification (from repo root)
npm run app:verify -- --app apps/loopvault --output .artifacts/loopvault.json
```

## Workflow-to-Test Mapping

| Proposal workflow / acceptance check | Covered in |
| --- | --- |
| Example 1: Goodhart gate (`skill-inbox-triage` `v4` dev `0.96` vs holdout `0.64`, `$36/mo`) hard-rejects promote & marks rejected | `tests/business.test.cjs` test 1 |
| Example 2: Permission & budget enforcement (`skill-expense-categorizer` `v2` `bank.transfer`, `$48/mo`) + `request_approval` | `tests/business.test.cjs` test 2 |
| Example 3: `regression_alert` (explicit & omitted `version_id`) + multi-hop lineage rollback `v5 -> v3` preserving `v4`/`v5` + `alerts.ack` | `tests/business.test.cjs` test 3, `examples/run.cjs` |
| Compliant promotion, idempotent re-promote, exact boundary equality (`==`), `create_candidate` + `evals.run` | `tests/business.test.cjs` test 4 |
| `policy.update` non-silent `non_compliant` derivation & atomic invalid-event rejection | `tests/business.test.cjs` test 5 |
| `asset.read` verified PNG magic header & cross-skill access rejection; non-ancestor rollback rejection | `tests/business.test.cjs` tests 6 & 7 |
| 2nd policy seed (`seed-relaxed.json`) & evaluation visual-cues manifest (`visual-cues.eval.json`) | `tests/business.test.cjs` tests 8 & 9 |
| Full Core MCP `resources/list` + `resources/read` + `state.audit`, `env.load_seed`, `env.apply_event`, `env.reset` | `npm run app:verify` + MCP audit check |
