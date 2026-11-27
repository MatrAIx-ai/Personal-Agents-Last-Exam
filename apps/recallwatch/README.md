# RecallWatch (`apps/recallwatch`)

RecallWatch is a standalone, resettable synthetic PALE Environment package for product-safety recall advisories, household lot-level exposure matching, alert watchlists, and remedy-claim lifecycles.

## Quick start & verification

Requires Node.js >= 18 and zero external runtime services or paid APIs.

```bash
# 1. Standalone App unit tests (no runtime sibling required)
cd apps/recallwatch
npm test
npm run example

# 2. Official PALE runtime verification (from repo root)
cd ../..
npm run app:verify -- --app apps/recallwatch

# 3. End-to-end Mail integration test via real Messaging Router + examples/apps/mail
node apps/recallwatch/examples/mail-integration.cjs

# 4. Launch Web GUI via PALE web host
npm run web
```

## Implementation notes (addressing PR #143 design review suggestions)

1. **Core envelope & Mail acceptance evidence:**
   - All write operations use Core's native `{ status: "committed", app_id: "recallwatch", version: { epoch, revision } }` envelope and Core's optimistic concurrency error (`stale_version`). Claim submissions additionally return an App-owned `claim_receipt_id`.
   - Mail acceptance tests (`examples/mail-integration.cjs`) verify delivered messages via `mail.get` (asserting real subject/body text) and correlate `source_object` to `message_id` / `event_id` in the sender-side `correlation` record returned by `src/publisher.cjs`, without expecting a new field on Mail's message record.
2. **Explicit post-commit notification execution & virtual-time semantics:**
   - Advancing virtual time or committing a local claim never dispatches Mail automatically. Outbound `channel.email` notifications are invoked explicitly after local commit via `src/publisher.cjs` (`publishClaimNotification`), producing deterministic CloudEvents 1.0 envelopes (`org.pale.mail.notification.v1`, `urn:pale:email-payload:1`, `id: recallwatch-claim-<claim_id>-<status>`).
   - Unknown router acknowledgements return `{ stage: "unknown_outcome", stop_run: true }` (matching Messaging's stop-and-inspect behavior); rejected deliveries leave the local claim committed and Mail unchanged.
   - Remedy deadlines use inclusive comparison (`virtual_now <= remedy_deadline_at` is eligible; strictly `>` fails with `remedy_window_expired`). Watchlist `pause_until` resumes deterministically at read time (`virtual_now >= pause_until`); `delivery_mode` (`immediate` | `digest`) is stored as declarative rule metadata without a background scheduler.
3. **Claim proof reference boundary & amendment contract (supporting Task #156):**
   - **Proof validation boundary (v1):** `proof_ref` is a structured reference `{ kind: "file_ref" | "asset_ref" | "receipt_ref", id, version? }` checked by `src/common.cjs` (`validateProofRef` / `evaluateClaimEligibility`) on `claim.preview`, `claim.create_draft`, `claim.update_draft`, `claim.amend`, and `claim.submit` (returning `PROOF_REQUIRED` when omitted on a proof-required recall, or `PROOF_REFERENCE_INVALID` on malformed syntax). **v1 validates reference syntax and presence only** — RecallWatch does not read Files, verify that an external document exists, or verify purchase facts/OCR. Optional `apps/files` integration is not bundled and is not mandatory for standalone v1 operation.
   - `recallwatch.claim.update_draft` edits `draft` claims (including `remedy_type`); `recallwatch.claim.amend` edits both `draft` and `submitted` claims (`shipping_address`, `recipient_name`, `recipient_person_ref`, `payout_method`, `proof_ref`, `notes`) while rejecting terminal states (`approved_*`, `rejected`, `withdrawn`). Active duplicate claims for the same `(recall_id, item_id)` are rejected with `duplicate_active_claim`.

## Delivery evidence & full-window evaluation dataset

- **GUI comparison, Chromium workflow sequence, and proof-required claim receipt:** see [evidence/README.md](evidence/README.md) (reproducible via `node apps/recallwatch/examples/browser-evidence.cjs`).
- **Full-window 2025-01-01 through 2026-12-31 dataset & reproducible coverage report:** `fixtures/full-window.json` (loaded via `env.load_seed`) and `node apps/recallwatch/examples/coverage-report.cjs`.
