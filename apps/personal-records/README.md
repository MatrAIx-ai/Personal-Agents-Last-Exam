# Personal Records (`@pale/app-personal-records`)

**Personal Records** is a document intelligence and management environment for the Personal Agents' Last Exam (PALE) benchmark. It enables personal agents to store, search, organize, and reason over personal administration records (payslips, tax filings, employment contracts, insurance policies, and household receipts) with byte-verified passage citations and strict confirmation boundaries.

## Features

- **Zero External Dependencies:** Built natively on Node.js 22.5+ using built-in `node:sqlite`. Runs out of the box with `node --test` / `npm test` without requiring native compilation or `npm install`.
- **Full-Text Content Search:** SQLite FTS5 index across document metadata, tags, and extracted text.
- **Immutable Version History:** Content-addressed blob storage partitioned by `account_id` enforcing the 10 MB per-file budget limit.
- **Reproducible Passage Citations:** Factual claims are bound to exact character spans `[start_offset, end_offset]` anchored to a stable triple: `(document_id, version_number, extraction_revision)`.
- **Arbitrary Relationship Graph:** Directed document links with configurable semantic types (e.g., `supersedes`, `tax_supporting_document`, `receipt_for`).
- **Trusted Confirmation Security Boundary:** Strict caller separation between Agent proposals (`records.propose_update`, status `PENDING`) and human User approvals (`records.confirm_update`, status `USER_CONFIRMED`). Agents attempting to approve their own mutations are rejected with `PERMISSION_DENIED`.
- **Platform Lifecycle Compliance:** Fully adheres to `runtime/core/runtime.cjs:119–126` for deterministic `platform.seed`, baseline `platform.reset`, evaluation `snapshot` dumps, and `idempotency_key` deduplication.
- **App Lookups & CloudEvent Alerts:** Pinned read adapters for `mail.get`, `mail.attachment.get`, `files.read`, `contacts.list`, and `calendar.list`, plus outbound notifications adhering to `urn:pale:email-message:2`.
- **Web Host UI (`gui/`):** Responsive vanilla HTML5/CSS3/JS views served by PALE's Business Web Host (`runtime/web/`).

---

## Directory Structure

```text
apps/personal-records/
├── package.json                   # Zero external dependencies; runs via native node --test
├── tools.json                     # Canonical MCP tool contracts and parameter schemas
├── README.md                      # Package documentation
├── src/
│   ├── index.cjs                  # Universal MCP tool router and app entry point
│   ├── db.cjs                     # Relational schema (tables, FTS5 virtual table, foreign keys)
│   ├── blob-store.cjs             # Account-partitioned filesystem blob storage
│   ├── extraction.cjs             # Digital text extraction and deterministic truth fallback
│   ├── document-service.cjs       # Core transactions, versioning, deduplication, and FTS5 search
│   ├── evidence-service.cjs       # Directed link graph, passage citations, and proposals
│   ├── platform.cjs               # Seed fixtures, deterministic reset, and idempotency
│   ├── events.cjs                 # Expiry checks, payslip discrepancy detection, and CloudEvents
│   └── adapters.cjs               # Read-only adapters for Mail, Files, Contacts, and Calendar
├── gui/
│   ├── index.html                 # Web Host dashboard (Library, Viewer, Graph, Proposals)
│   ├── style.css                  # Responsive stylesheet with passage highlight styles
│   └── app.js                     # Frontend controller with user/agent session gating
├── fixtures/
│   ├── generator.cjs              # Deterministic synthetic dataset generator
│   ├── truth.json                 # Scenario reference slice (20 active documents <= 1 MiB)
│   ├── corpus.json                # Full synthetic archive (165 documents across 8 domains)
│   └── peer-apps.json             # Mock fixtures for Mail, Files, Contacts, and Calendar
└── tests/
    ├── document-service.test.cjs  # Ingestion, deduplication, optimistic locks, and FTS5
    ├── evidence-service.test.cjs  # Link graphs, citation offsets, and confirmation boundary
    ├── platform.test.cjs          # Seed, mutate, snapshot, reset, and idempotency tests
    ├── events-and-adapters.test.cjs # Expiries, discrepancies, CloudEvents, and Mail/Files reads
    ├── adapters.test.cjs          # Peer app contracts, immutability, and entity matching
    ├── gui.test.cjs               # Web Host GUI DOM completeness and tool bindings
    ├── dataset.test.cjs           # Corpus scale (165 docs), payload limits, and span checks
    ├── integration.test.cjs       # Full end-to-end tool router integration test
    └── task-validation.test.cjs   # Benchmark task simulation (Task #102 & Task #106)
```

---

## Verification & Testing

Tests run using Node's built-in test runner without needing third-party libraries:

```bash
# Run all 9 test suites
npm test

# Run task integration validation (Task #102 & Task #106)
npm run test:tasks

# Regenerate synthetic fixture archives
npm run generate:fixtures
```
```

---

### Verification

Run the task validation suite:

```bash
# 1. Run Milestone 5 task validation
node --test tests/task-validation.test.cjs

# 2. Run the complete test suite across all 5 milestones
npm test
```