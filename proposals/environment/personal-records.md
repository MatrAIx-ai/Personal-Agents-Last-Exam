# [Environment Proposal] [Work & business + Money & insurance] Personal Records

## 1. App and domains

- **Authors / GitHub handles (required):** Nassim (@nassimberrada)
- **Reference app or website / URL (required):** [Paperless-ngx](https://docs.paperless-ngx.com/) — open-source document management system. The proposed environment extends this model with arbitrary document relationships, passage-level information extraction, evidence tracking, and agent-assisted review workflows.
- **Primary domain (required):** Work & business
- **Secondary domains (optional):** Money & insurance; Public service & law; Home & utilities; Health & care

### Added value and relationship to existing work
- **Relationship to `Files` (`docs/personal-apps.md`):** The merged `Files` App provides basic folder hierarchies and immutable byte storage. `Personal Records` acts as an intelligence and reasoning layer on top of document storage: it provides full-text content search (SQLite FTS5), passage-level citation for factual claims, arbitrary cross-document relationship graphs (e.g., tax-packet evidence, successive payslips), and explicit verification states (`INFERRED` vs. `USER_CONFIRMED`).
- **Relationship to Research Library (PR #4):** While PR #4 specializes in academic literature and bibliographic citations, Personal Records is dedicated to personal administration (employment contracts, payslips, tax filings, insurance policies, and household receipts) with personal timeline and audit semantics.

## 2. What you plan to build

Build a personal document management and intelligence environment where users and agents store, organize, search, and manage important personal records with verifiable evidence attribution.

Core workflows include:
1. **Document intake & import:** Upload digital documents directly or import them from connected apps (`Mail`, `Files`). Supports PDFs, text, and common image formats in v1.
2. **Organization & full-text search:** Categorize documents by person, organization, date, topic, and tags. Support SQLite FTS5 full-text and metadata search.
3. **Information extraction & passage citation:** Extract structured fields (dates, amounts, counterparty names, policy numbers, terms) alongside stable passage anchors (line/character offset spans). Digital PDFs and text are extracted via lightweight local parsers (`pypdf` / `pdf-parse`), paired with deterministic pre-extracted fallback text in fixtures to eliminate heavy, nondeterministic runtime OCR dependencies.
4. **Arbitrary document relationships:** Model relationships as an open, directed graph. Agents and users can connect any two documents with custom, configurable relationship strings (e.g., `supersedes`, `tax_supporting_document`, `receipt_for`, `amends`, `parent_contract`), directly supporting multi-document tasks like tax packets and evidentiary bundles.
5. **Change & expiry tracking:** Track document validity and renewal dates evaluated strictly against virtual time (`ctx.virtual_now`). Identify material discrepancies across linked records (e.g., net pay differences across successive payslips).
6. **Evidence tracking, verification & agent proposals:** Allow agents to cite exact document passages to support factual claims with explicit provenance (`INFERRED` vs. `USER_CONFIRMED`). Agents can draft proposed metadata, relationship links, or status updates, but high-consequence mutations (modifying confirmed records or deleting files) require explicit user approval via the Web UI.

The environment evaluates personal agents on retrieval precision, multi-document temporal reasoning, source attribution, uncertainty handling, and adherence to user confirmation boundaries.

## 3. Potential app connections

### Connected workflows using public contracts
- **Internal personal apps (required):**
  - **Mail (`examples/apps/mail/tools.json:1954`):** Read-only integration. Personal Records calls `mail.get_message` and `mail.get_attachment` using message `id` and `asset_id` to fetch original attachment bytes, MIME types, and SHA-256 hashes. Reading Mail leaves Mail's business state unchanged.
  - **Files (`apps/files/tools.json:914`):** Read-only integration. Personal Records provides an import adapter calling `files.read_file_bytes(file_id, version_id)` to ingest documents deposited by users or agents into the `Files` app.
  - **Calendar (`examples/apps/calendar/tools.json:3,237`):** Read-only integration. Personal Records calls `calendar.list_events` with range filters to correlate contract renewals and tax deadlines. No Messaging receiver is required for Calendar reads.
  - **Contacts (`apps/contacts/tools.json:184`):** Read-only integration. Personal Records calls `contacts.list_contacts` to map extracted organization names and employer/issuer strings to stable `person_id` or contact entities.
  - *Outbound notifications via Mail (`examples/apps/mail/schemas/router-message.schema.json`):* Retained outbound alerts optionally send a notification to the user inbox using `mail.receive_notification` with payload `urn:pale:email-payload:1`.

- **Other apps and websites (required):**
  - **Cloud storage, investment platforms, & e-sign platforms:** To guarantee 100% local reproducibility without live internet dependencies, external services are simulated via static, deterministic synthetic intake fixtures and controlled local folder adapters in v1. Live third-party API access is out of scope.

### Integration details

#### Operations and access (required)

The environment strictly separates Agent/User business tools from Platform administrative operations:

| Operation | Mode | Caller | Access | Description |
| :--- | :--- | :--- | :--- | :--- |
| `records.upload_document` | MCP / Web UI | Agent / User | Write | Uploads original bytes and creates an intake record. |
| `records.import_from_source` | MCP / Web UI | Agent / User | Write | Ingests from `mail` or `files` via their public read contracts. |
| `records.get_document` | MCP / Web UI | Agent / User | Read | Retrieves document metadata, versions, and extracted text/passages. Non-mutating. |
| `records.search` | MCP / Web UI | Agent / User | Read | Full-text (FTS5) and structured field search. Non-mutating. |
| `records.link_documents` | MCP / Web UI | Agent / User | Write | Creates a directed link (`source_id`, `target_id`, `relationship_type`, `metadata`). `relationship_type` is an open/arbitrary string. |
| `records.create_evidence_claim` | MCP / Web UI | Agent / User | Write | Links a factual claim to specific passage citations. |
| `records.propose_update` | MCP | Agent | Write | Submits a proposed metadata or relationship change pending confirmation. |
| `records.confirm_update` | Web UI | User only | Write | Approves or rejects a pending agent update. |
| `platform.seed_fixtures` | Platform API | Platform | Write | Loads initial scenario documents and ground truth. Blocked from Agent. |
| `platform.reset` | Platform API | Platform | Write | Resets database, blobs, and indexes to baseline. Blocked from Agent. |
| `platform.inject_event` | Platform API | Platform | Write | Injects a timestamped document or expiry event. Blocked from Agent. |

- **Browser audience and Web UI:** The browser interface runs on PALE's standard **Business Web Host** (`runtime/web/README.md`) over the same authenticated MCP state. It serves human users inspecting records, approving proposals, or verifying claims, and supports CUA-based evaluation agents.

#### State and lifecycle (required)
- **Account and run isolation:** User libraries, document files, and metadata are partitioned strictly by `account_id` and benchmark run.
- **Document state machine:**
  - Processing lifecycle: `PENDING_INGEST` $\rightarrow$ `PARSING` $\rightarrow$ `READY` (or `EXTRACTION_FAILED`).
  - Verification lifecycle: `INFERRED` (machine-extracted) $\rightarrow$ `USER_CONFIRMED` (verified by human/user) $\rightarrow$ `SUPERSEDED` (replaced by newer document version).
- **Transitions and error outcomes:**
  - `DUPLICATE_DOCUMENT`: Ingest rejected when SHA-256 hash matches an existing document in the same account (returns existing `document_id`).
  - `UNSUPPORTED_FORMAT`: Returns explicit error receipt if uploaded MIME type is outside v1 scope.
  - `STALE_VERSION`: Writes specifying an `expected_version` fail if the record was mutated concurrently.
  - `CONFIRMATION_REQUIRED`: Agent attempts to alter `USER_CONFIRMED` data or delete records produce a pending change receipt rather than mutating state.
  - `EVIDENCE_INVALIDATION`: Superseding a document version marks existing claims referencing it as `REVIEW_REQUIRED` without destroying historical claim records.
- **Fixture ground truth:** Synthetic datasets provide paired `truth.json` manifests specifying ground-truth fields, passage coordinates, and expected relationship graphs for deterministic grading.
- **Core write/replay and reset contract:**
  - Follows `runtime/core/runtime.cjs:119–126`. Read operations produce zero business mutations. Write operations accept idempotency keys.
  - Reset (`platform.reset`) clears all App-local tables (documents, extractions, links, claims, in-app notifications) and resets SQLite FTS5 indexes and temporary blob storage back to the scenario's initial baseline.
  - App-owned business history (visible to users and agents) is kept distinct from PALE Core execution audit logs.

#### Events and notifications (required)
- **Virtual time and scheduling:** All temporal calculations (e.g., document expiry, policy renewal notices) evaluate against `ctx.virtual_now`. Advancing time via `env.advance_time` executes no ambient polling or timers. Event handlers evaluate conditions when invoked at `event.at`.
- **Structured event injection:** Scenarios inject events via standard envelopes:
  ```json
  {
    "event_id": "evt_payslip_2026_11",
    "at": "2026-11-20T09:00:00Z",
    "operation": "records.inject_document",
    "payload": {
      "source": "mail_attachment",
      "source_account": "user@example.com",
      "message_id": "msg_nov_payslip",
      "asset_id": "ast_payslip_pdf"
    }
  }
  ```
- **Notification semantics:**
  - In-app alerts are written directly to the internal `records_notifications` table.
  - External notifications: Retained email notifications use `mail.receive_notification` adhering to `urn:pale:email-payload:1`. Mobile push notifications are deferred.

#### Shared data and dependencies (required)
- **Format scope (v1):** Supported formats are strictly **PDF, PNG, JPEG, and TXT**. Complex office formats (DOCX, XLSX) and raw email containers (EML) are excluded from v1 parsing and handled only as raw unparsed attachments.
- **Resource and storage budgets:**
  - Per-file maximum size: 10 MB.
  - Total synthetic fixture bundle: 150–250 documents $\le$ 250 MB total storage.
  - Compute & OCR: Built with SQLite (with FTS5) and lightweight local text extraction (`pypdf` / `pdf-parse`). Synthetic document fixtures bundle pre-extracted text fallback fields in `truth.json` to guarantee fast (<2s), 100% deterministic CI runs without GPU or external OCR engine requirements.
- **Stable identifiers:** Documents are referenced by immutable `document_id`. Citations reference `passage_id` or line/character offset spans `{start_offset, end_offset}` to ensure precise source attribution.

## 4. Construction plan and effort

### Work breakdown (required)

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | ---: |
| Storage & Core MCP Backend | Implement SQLite schema, FTS5 search index, file blob store, and agent MCP endpoints (`upload`, `get`, `search`, `link`, `create_evidence_claim`). | Working MCP server passing local CRUD, FTS5 search, idempotency, and version conflict tests. | 5–7 |
| Web UI (Web Host) | Implement 6–8 responsive business views (document library, file preview, passage viewer, link inspector, review/confirmation modal) on `runtime/web`. | Verified UI rendering, passage highlighting, and confirmation flows across major browsers via Playwright. | 4–6 |
| App Integrations (Mail, Files, Contacts, Calendar) | Implement read-only adapters for Mail attachments, Files original bytes, Contacts entity matching, and Calendar date linking. | Integration tests verifying source byte/hash preservation and ensuring zero mutations on source apps. | 3–4 |
| Synthetic Dataset & Ground Truth | Synthesize 150–250 realistic documents across 8 categories (tax, employment, insurance, property, utilities, healthcare, banking, legal) with ground-truth `truth.json` manifests. | Coherent persona histories. Check duplicate detection, extraction consistency, and passage ground-truth alignment. | 4–6 |
| Platform Lifecycle & Reset Harness | Implement `platform.seed`, `platform.reset`, event injection handlers, and Core replay compliance. | Reproducible reset tests verifying clean table/FTS restoration, baseline re-seeding, and deterministic state. | 3–5 |

### Milestones, owners, and dependencies (required)

- **14-day First Runnable Slice (Approval Milestone):**
  - Deliver runnable core SQLite engine, blob storage, core MCP operations (`records.upload`, `records.get`, `records.search`, `records.link`), baseline fixture seeder, and `platform.reset`.
  - Pass reproducible unit and integration tests under `npm test` / `pytest`.
- **Subsequent Milestones:**
  - Milestone 2: Mail and Files import adapters; Contacts/Calendar read linking.
  - Milestone 3: Web Host interface and confirmation workflows.
  - Milestone 4: Full synthetic dataset scale-up (150–250 documents) and paired `truth.json` manifests.
  - Milestone 5: End-to-end task integration validation (supporting Task proposals #102 and #106).

Owners: Nassim (@nassimberrada). Calendar duration: 3–4 weeks.

### Resources and total effort (required)
- **Estimated total effort:** 19–28 person-days.
- **Compute & storage:** Modest local development environment (SQLite, Python / Node runtime, $\le$ 250 MB disk). No external paid APIs or cloud dependencies.

### Scope boundary and open questions (required)
- **Included in v1:** Digital PDF/image/text parsing, SQLite FTS5 full-text search, arbitrary directed document relationships, immutable version history, passage-level evidence linking, and user confirmation boundaries.
- **Excluded / deferred:**
  - Parsing of DOCX, XLSX, and EML formats is deferred (stored as raw blobs only in v1).
  - Heavy ML OCR models are excluded; v1 uses digital PDF text extraction with deterministic pre-extracted fallback in fixture truth.
  - Live third-party cloud/finance API connections are excluded (simulated via static local fixtures).
  - Device push notifications are deferred; local in-app alerts and simulated email inbox notifications are supported.
  - No automated legal or financial advice features.

### License and external dependencies (required)
- Application code will be licensed under **MIT**.
- Synthetic assets and document templates will be released under **CC-BY-4.0** or dedicated public-domain marks (CC0).
- Runtime dependencies: SQLite3 (with FTS5), lightweight PDF/text parsing (`pypdf` or `pdf-parse`). All runtime code executes locally and deterministically.