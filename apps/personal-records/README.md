# Personal Records (`@pale/app-personal-records`)

**Personal Records** is a document intelligence and management environment for the Personal Agents' Last Exam (PALE) benchmark. It enables personal agents to store, search, organize, and reason over personal administration records (payslips, tax filings, employment contracts, insurance policies, and household receipts) with byte-verified passage citations and strict confirmation boundaries.

## Features

- **Zero External Dependencies:** Built natively on Node.js 18+ using built-in `node:sqlite`. Runs out of the box with `node --test` / `npm test` without requiring native compilation or `npm install`.
- **Full-Text Content Search:** SQLite FTS5 index across document metadata, tags, and extracted text.
- **Immutable Version History:** Content-addressed blob storage partitioned by `account_id` enforcing the 10 MB per-file budget limit.
- **Reproducible Passage Citations:** Factual claims are bound to exact character spans `[start_offset, end_offset]` anchored to a stable triple: `(document_id, version_number, extraction_revision)`.
- **Arbitrary Relationship Graph:** Directed document links with configurable semantic types (e.g., `supersedes`, `tax_supporting_document`, `receipt_for`).
- **Trusted Confirmation Security Boundary:** Strict caller separation between Agent proposals (`records.propose_update`, status `PENDING`) and human User approvals (`records.confirm_update`, status `USER_CONFIRMED`). Agents attempting to approve their own mutations are rejected with `PERMISSION_DENIED`.
- **Platform Lifecycle Compliance:** Fully adheres to `runtime/core/runtime.cjs:119–126` for deterministic `platform.seed`, baseline `platform.reset`, evaluation `snapshot` dumps, and `idempotency_key` deduplication.
- **App Lookups & CloudEvent Alerts:** Pinned read adapters for `mail.get`, `mail.attachment.get`, and `files.read`, plus outbound notifications adhering to `urn:pale:email-message:2`.

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
├── fixtures/
│   └── truth.json                 # Baseline scenario seed and pre-extracted fallback text
└── tests/
    ├── document-service.test.cjs  # Ingestion, deduplication, optimistic locks, and FTS5
    ├── evidence-service.test.cjs  # Link graphs, citation offsets, and confirmation boundary
    ├── platform.test.cjs          # Seed, mutate, snapshot, reset, and idempotency tests
    ├── events-and-adapters.test.cjs # Expiries, discrepancies, CloudEvents, and Mail/Files reads
    └── integration.test.cjs       # Full end-to-end tool router integration test
```

---

## Exposed MCP Tools (`tools.json`)

| Tool | Mode | Caller | Description |
| :--- | :--- | :--- | :--- |
| `records.upload_document` | Write | Agent / User | Ingests document bytes. Enforces SHA-256 deduplication and initiates version 1. |
| `records.import_from_source` | Write | Agent / User | Imports from `mail` or `files` via their public read contracts without mutating source apps. |
| `records.create_version` | Write | Agent / User | Appends a new document version with optimistic locking (`expected_parent_version`). |
| `records.get_document` | Read | Agent / User | Retrieves metadata, specific version details, extracted text, and citations. |
| `records.search` | Read | Agent / User | Full-text FTS5 keyword and metadata search (`category`, `verification_state`, `valid_until`). |
| `records.link_documents` | Write | Agent / User | Creates directed links (`source_id`, `target_id`, `relationship_type`). |
| `records.create_evidence_claim` | Write | Agent / User | Binds a claim to verified passage offsets `[start, end]` matching `cited_text`. |
| `records.propose_update` | Write | Agent | Stages a proposed mutation as `PENDING` without altering underlying business state. |
| `records.confirm_update` | Write | User only | Approves or rejects a proposal. Rejects agent callers with `PERMISSION_DENIED`. |

---

## Verification & Testing

Tests run using Node's built-in test runner without needing any third-party test libraries:

```bash
# Run all test suites
npm test

# Run a specific suite
node --test tests/integration.test.cjs
```

All 5 test suites pass with zero warnings:
1. `document-service.test.cjs`: Validates SHA-256 deduplication, version increments, stale version errors, and FTS5 search queries.
2. `evidence-service.test.cjs`: Validates passage slice verification, missing link targets, and the agent/user confirmation boundary.
3. `platform.test.cjs`: Validates deterministic fixture seeding, snapshot capture, full reset back to baseline hash, and idempotency key replays.
4. `events-and-adapters.test.cjs`: Validates virtual-time expiry thresholds, duplicate suppression, numerical payslip discrepancy detection, CloudEvent formatting, and peer app read adapters.
5. `integration.test.cjs`: Validates full end-to-end multi-step agent interaction through `PersonalRecordsApp.callTool`.
```