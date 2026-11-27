# Personal Records (`@pale/app-personal-records`)

**Personal Records** is a document intelligence and management environment for the Personal Agents' Last Exam (PALE) benchmark. It enables personal agents to store, search, organize, and reason over personal administration records (payslips, tax filings, employment contracts, insurance policies, and household receipts) with byte-verified passage citations and strict confirmation boundaries.

## Supported Runtime Matrix

| Mode | Entrypoint | Node.js Requirement | Dependencies |
| :--- | :--- | :--- | :--- |
| **PALE Public Runtime** (`app:verify`, `app:serve`, `runtime/web`) | `plugin.cjs`, `service.cjs` | **Node.js 18+** | Zero external dependencies (Node built-ins only) |
| **Standalone SQLite Engine** (local FTS5 & CLI) | `src/index.cjs`, `scripts/run-gui.cjs` | **Node.js 22.5+** (`node:sqlite`) | Optional `pdf-parse` for local binary PDF extraction |

## Features & Security Boundaries

- **Discoverable PALE Package (`app.json`):** Integrates with `runtime/ci/select-apps.cjs`, `runtime/cli.cjs verify`, `runtime/cli.cjs serve`, and `runtime/web/server.cjs` via `plugin.cjs` and `tools.json`.
- **Full-Text & Metadata Search (`personal-records.search`):** Searches document titles, categories, tags, and extracted text without mutating state.
- **Immutable Version History & Deduplication (`personal-records.upload_document`, `personal-records.create_version`):** Content-addressed SHA-256 deduplication and optimistic parent-version locking.
- **Reproducible Passage Citations (`personal-records.create_evidence_claim`):** Factual claims bound to exact character spans `[start_offset, end_offset]` anchored to `(document_id, version_number, extraction_revision)`.
- **Arbitrary Relationship Graph (`personal-records.link_documents`, `personal-records.list_links`):** Directed document links with configurable semantic types (`supersedes`, `tax_supporting_document`, `receipt_for`).
- **Trusted User Confirmation Boundary:**
  - `personal-records.propose_update` is permitted in the `scenario` agent policy and records a `PENDING` proposal without mutating base documents or claims.
  - `personal-records.confirm_update` is **blocked** in `scenario` policy (`permission_denied` for agents) and permitted only in `sandbox` / trusted user confirmation sessions.
- **Virtual Time Expiry & Discrepancy Checks (`personal-records.check_expiries`, `personal-records.check_discrepancies`):** Evaluates `valid_until <= ctx.virtual_now + threshold_days` with 7-day duplicate alert suppression and detects unconfirmed numerical deltas across linked payslips.
- **Web Host UI (`gui/host.html`, `gui/src/app.js`):** Served by PALE's Business Web Host (`runtime/web/server.cjs`) via `/shared/client.js`. Standalone preview UI remains in `gui/index.html` + `gui/app.js`.

## Connected Apps & Simulated Adapters

- **Pinned Public Contracts:** `mail@1.3.0` (`mail.get`, `mail.attachment.get`), `calendar@1.3.0` (`calendar.list`), `files@1.0.0` (`files.read`), `contacts@1.0.0` (`contacts.list`).
- **Simulated Adapters (Standalone Test Doubles):** `fixtures/peer-apps.json` and the mock client adapters in `src/adapters.cjs` / `tests/adapters.test.cjs` simulate these contracts locally when running without `--with` sibling App packages.
- **Live / Cross-App Mode:** In PALE runtime runs, `personal-records.import_from_source` accepts structured payloads sourced via authorized Mail/Files read contracts without mutating source apps.

## Verification Commands

```bash
# Public PALE runtime verification (Node 18+)
node runtime/cli.cjs verify --app apps/personal-records

# App-only business tests & event example (Node 18+)
cd apps/personal-records
node --test tests/business.test.cjs
node examples/run.cjs

# Full standalone SQLite & dataset test suite (Node 22.5+)
node --test tests/*.test.cjs
```
