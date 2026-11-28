# Personal Records (`@pale/app-personal-records`)

**Personal Records** is a document intelligence and management environment for the Personal Agents' Last Exam (PALE) benchmark. It enables personal agents to store, search, organize, and reason over personal administration records (payslips, tax filings, employment contracts, insurance policies, and household receipts) with byte-verified passage citations and strict confirmation boundaries.

## Supported Runtime Matrix & Behavior Split

| Mode | Entrypoint | Node.js | Behaviors Supplied |
| :--- | :--- | :--- | :--- |
| **PALE Public Runtime** (`app:verify`, `app:serve`, `runtime/web`) | `plugin.cjs`, `service.cjs` | **Node.js 18+** (built-ins only) | Core JSON state, upload/versioning/SHA-256 dedup, token/metadata search, directed links, passage claims, proposal/confirmation (`propose_update`, `confirm_update`, `confirm_decision`), virtual-time expiry & discrepancy checks |
| **Standalone SQLite Engine** (local FTS5 & CLI) | `src/index.cjs`, `scripts/run-gui.cjs` | **Node.js 22.5+** (`node:sqlite` + optional `pdf-parse`) | SQLite FTS5 full-text index, filesystem `BlobStore`, binary PDF extraction, simulated peer-app adapter tests |

## Confirmation Boundary & UI Surfaces

- **Trusted User Confirmation Path:**
  - `personal-records.propose_update` (allowed in `scenario` policy) validates a nonempty, target-specific set of editable fields (`document_metadata` or `claim`) and records a `PENDING` proposal bound to `expected_target_version`, `target_state_hash`, and `proposal_hash` without mutating base records.
  - `personal-records.confirm_update` is **denied** in `scenario` policy (`permission_denied` for Agent-only runs). Independent user decisions are delivered exclusively via `env.apply_event` (`personal-records.confirm_decision`), binding `proposal_id`, `expected_proposal_hash`, `expected_target_version`, and `expected_target_state_hash`. Stale versions/state (`stale_proposal_version`), hash mismatches (`proposal_mismatch`), and replayed decisions (`invalid_state`) are rejected.
- **UI Surfaces:**
  - **Reviewer Renderer (`contribution/gui.json`):** `pale.gui.v1` declaration (`audience: ["reviewer"]`).
  - **Interactive Web Host UI (`gui/host.html`, `gui/src/app.js`):** Served by `runtime/web/server.cjs` via `/shared/client.js`. Uses `sandbox` policy for local interactive preview only (not as proof of independent user authority).
  - **Standalone Preview UI (`gui/index.html`, `gui/app.js`):** Local developer preview for `scripts/run-gui.cjs`.

## Connected Apps: Delivered vs. Deferred

- **Delivered in v1:** `personal-records.import_from_source` ingests caller-supplied `source_payload` bytes and metadata.
- **Mock-Only / Deferred in v1:** `app.json` declares `dependencies: []` and `real_delivery: false`.
  - **Live Mail (`mail.get`, `mail.attachment.get`), Files (`files.read`), Calendar (`1.3.0`), & Contacts (`1.0.0`) reads:** Simulated only in standalone tests (`fixtures/peer-apps.json`, `src/adapters.cjs`); **deferred** from the Node 18 PALE v1 runtime.
  - **Outbound Mail (`urn:pale:email-message:2`):** **Deferred** (`messaging.publishes: []`); expiry and discrepancy alerts persist CloudEvent-shaped records in `data.notifications` without live router delivery.

## Verification & Dataset Commands

```bash
# Public PALE runtime verification (Node 18+)
node runtime/cli.cjs verify --app apps/personal-records

# Load & query the full 165-document 2025-2026 corpus through PALE Core (Node 18+)
node apps/personal-records/scripts/export-pale-seed.cjs --verify-load

# Launch Web Host UI using package-local registry (Node 18+)
npm run web -- --app personal-records --registry apps/personal-records/registry.json

# App-only business tests & event example (Node 18+)
cd apps/personal-records
node --test tests/business.test.cjs
node examples/run.cjs

# Full standalone SQLite & dataset test suite (Node 22.5+)
node --test tests/*.test.cjs
```
