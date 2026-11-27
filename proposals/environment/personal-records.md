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
All source app connections pin Mail/Calendar v1.3.0 and Files/Contacts v1.0.0 at `main 61b637164e4abddf81536bb48935cdb688a69ff1`. Infrastructure provides authorized caller bindings; entity extraction and matching remain internal to Personal Records.

- **Internal personal apps (required):**
  - **Mail (Optional package dependency):** Records imports attachments via `mail.get({ id })` and `mail.attachment.get({ id, asset_id })`. Records stores original bytes, MIME type, and SHA-256 hash. Missing or denied messages return `SOURCE_UNAVAILABLE`; Mail's business state remains unchanged.
  - **Files (Optional package dependency):** Records ingests files via `files.read({ id, number? })` (where `number` is the optional file revision number). Records captures bytes, assigned `version_id`, and hash. Absent files return `SOURCE_NOT_FOUND`; Files state remains untouched.
  - **Calendar (Optional package dependency):** Records reads contract milestones and tax dates via `calendar.list({ start?, end?, include_cancelled? })` to correlate expiry alerts. Read failures degrade gracefully without blocking ingestion.
  - **Contacts (Optional package dependency):** Records correlates issuer names to stable entities via `contacts.list({ query?, include_inactive? })`. If contacts are absent or match is ambiguous, extracted counterparty strings are retained as raw text.
  - **Outbound Mail Alerts (Receiver integration):** Outbound alerts are routed via Messaging's trusted `env.apply_event` targeting Mail using `urn:pale:email-message:2` with payload `urn:pale:email-payload:1`. Not an Agent-callable tool.

- **Other apps and websites (required):**
  - **Cloud storage, investment platforms, & e-sign platforms:** Simulated locally via static, deterministic synthetic intake fixtures and controlled local folder adapters. No live third-party network access.

### Integration details

#### Operations and access (required)

The environment enforces caller authorization at the handler level:

| Operation | Mode | Caller | Access | Description / Outcome |
| :--- | :--- | :--- | :--- | :--- |
| `records.upload_document` | MCP / Web UI | Agent / User | Write | Ingests bytes, creates intake record. Returns `{ document_id, version: 1, hash }`. Duplicate hash returns existing ID (`DUPLICATE_DOCUMENT`). |
| `records.import_from_source` | MCP / Web UI | Agent / User | Write | Calls `mail.attachment.get` or `files.read`. Ingests bytes without mutating source. Missing source returns `SOURCE_UNAVAILABLE`. |
| `records.create_version` | MCP / Web UI | Agent / User | Write | Replaces or appends a document version. Success yields `version_number + 1`; invalid parent returns `NOT_FOUND`. |
| `records.get_document` | MCP / Web UI | Agent / User | Read | Retrieves document metadata, versions, and extracted text/passages. Non-mutating. |
| `records.search` | MCP / Web UI | Agent / User | Read | SQLite FTS5 full-text and metadata search. Non-mutating. |
| `records.link_documents` | MCP / Web UI | Agent / User | Write | Creates directed link (`source_id`, `target_id`, `relationship_type`). Nonexistent target yields `LINK_TARGET_NOT_FOUND` (no state change). |
| `records.create_evidence_claim` | MCP / Web UI | Agent / User | Write | Links a factual assertion to stable passage spans. Invalid span yields `INVALID_PASSAGE_REFERENCE`. |
| `records.propose_update` | MCP | Agent | Write | Submits pending mutation. Returns `{ proposal_id, status: "PENDING" }`. Leaves base document unmutated. |
| `records.confirm_update` | Trusted Session | User only | Write | Approves/rejects `proposal_id`. Caller must be authenticated user session token; Agent calls return `PERMISSION_DENIED`. |
| `platform.seed_fixtures` | Platform API | Platform | Write | Loads initial scenario documents, extraction revisions, and ground truth. Blocked from Agent. |
| `platform.reset` | Platform API | Platform | Write | Resets database, blobs, and FTS indexes to baseline. Blocked from Agent. |
| `platform.inject_event` | Platform API | Platform | Write | Injects a timestamped document intake or expiry check. Blocked from Agent. |

- **Trusted Confirmation Path:** To prevent agents from approving their own proposals via the Web UI/MCP, `records.confirm_update` requires a trusted user session token issued by the test harness. Agent MCP processes are restricted to `records.propose_update`. Rejected or cancelled proposals mark the proposal record as `REJECTED`/`CANCELLED` and leave all underlying documents and claims completely unchanged. Stale confirmations (where the document version incremented while the proposal was pending) fail with `STALE_PROPOSAL_VERSION`.

#### State and lifecycle (required)
- **Account and run isolation:** User libraries, document files, and metadata are partitioned strictly by `account_id` and benchmark run.
- **Document state machine:**
  - Processing lifecycle: `PENDING_INGEST` $\rightarrow$ `PARSING` $\rightarrow$ `READY` (or `EXTRACTION_FAILED`).
  - Verification lifecycle: `INFERRED` (machine-extracted) $\rightarrow$ `USER_CONFIRMED` (verified by human/user) $\rightarrow$ `SUPERSEDED` (replaced by newer document version).
- **Seeded History & Evidence References:**
  Every citation is immutably anchored to a triple: `(document_id, version_number, extraction_revision)`. When a document is re-extracted or a new version is uploaded, historical citations continue to point to the historical extraction revision.
  ```json
  {
    "claim_id": "clm_tax_2026_income",
    "document_id": "doc_payslip_dec2026",
    "version_number": 1,
    "extraction_revision": "ext_rev_01",
    "span": { "start_offset": 450, "end_offset": 512 },
    "cited_text": "Net Taxable Pay: $4,250.00",
    "verification_state": "USER_CONFIRMED"
  }
  ```
  App state joins to the benchmark trace via `(run_id, account_id, request_id)`. Before any `platform.reset`, the harness preserves a full snapshot of the committed state for evaluation.
- **Core write/replay and reset contract:**
  - Follows `runtime/core/runtime.cjs:119–126`. Read operations produce zero business mutations. Write operations accept idempotency keys.
  - Reset (`platform.reset`) clears all App-local tables and temporary blobs, restoring the SQLite database and FTS5 indexes to the baseline scenario seed.

#### Events and notifications (required)
- **Virtual time, expiry, and discrepancies:**
  - Evaluated strictly against `ctx.virtual_now`. Advancing time executes no ambient polling.
  - **Expiry Rule:** When an expiry evaluation event is triggered at `event.at`, Records queries documents where `valid_until <= ctx.virtual_now + alert_threshold_days` (default 30 days). Duplicate alerts are suppressed if an alert was dispatched within 7 virtual days.
  - **Discrepancy Rule:** When successive documents of the same class (e.g., successive payslips from the same employer) are linked via `supersedes` or chronologically ordered, a discrepancy is flagged if numerical fields (e.g., net pay, tax withholdings) change by $>0\%$ without an associated user confirmation.
- **Structured event injection:**
  ```json
  {
    "event_id": "evt_intake_2026_11_20",
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
- **Outbound Notification Wire Format:**
  Outbound alerts dispatched to Mail adhere to CloudEvent `urn:pale:email-message:2` with payload schema `urn:pale:email-payload:1`:
  ```json
  {
    "specversion": "1.0",
    "type": "urn:pale:email-message:2",
    "source": "/app/personal-records",
    "id": "evt_alert_expiry_20261120",
    "time": "2026-11-20T09:00:00Z",
    "datacontenttype": "application/json",
    "data": {
      "recipient": "user@example.com",
      "subject": "Document Expiry Notice: Auto Insurance Policy",
      "body_text": "Your policy (doc_ins_04) expires in 14 days. A renewal document is required.",
      "asset_ids": []
    }
  }
  ```
  Delivery denials or network retries log an integration receipt without rolling back committed Records business state.

#### Shared data and dependencies (required)
- **Format & Storage Scope Matrix:**

| Channel / Format | Ingestion Path | Byte Preservation | Text Extraction | Missing / Unsupported Outcome |
| :--- | :--- | :--- | :--- | :--- |
| **PDF (Digital)** | Direct / Mail / Files | Stored in local blob store | Extracted via `pypdf` | If unreadable, fallback to `truth.json` pre-extracted text. |
| **PDF (Scanned) / Images (PNG/JPEG)** | Direct / Mail / Files | Stored in local blob store | Deterministic fallback from `truth.json` | Missing fallback yields `EXTRACTION_FAILED`; bytes preserved. |
| **TXT** | Direct / Mail / Files | Stored in local blob store | Direct UTF-8 decode | Encoding error yields `EXTRACTION_FAILED`. |
| **Office (DOCX/XLSX) / EML** | Direct upload only | Stored as raw unparsed blob | None (Deferred) | Status set to `RAW_ATTACHMENT`; full-text search disabled. |

- **Resource Limits & Corpus Partitioning:**
  - **Full Corpus Repository:** 150–250 synthetic documents (~150 MB total fixture storage).
  - **Per-Scenario Run Budget:** Capped at 15–25 active documents per run, strictly respecting the reference host limit of $\le 64$ assets and $\le 1\text{ MiB}$ decoded payload per App bundle.
  - **Ground Truth vs. Runtime Text:** Synthetic fixtures cleanly separate runtime parser fallback text (`fallback_content`) from grading-only evaluation criteria in `truth.json` (such as expected key-value extraction assertions and link graphs).

### Environment Dataset Plan (#260)

- **Deliverable Versioned 2025–2026 History:**
  - `apps/personal-records/fixtures/corpus.json`: 165 deterministically generated synthetic documents spanning `2025-01-01` through `2026-12-31` across 8 personal administration domains (employment payslips, tax W-2/1040 filings, insurance policies, property leases, utility bills, healthcare EOBs, banking statements, legal notices).
  - `apps/personal-records/fixtures/truth.json`: 20-document scenario slice ($\le 1\text{ MiB}$, $\le 64$ assets) with verified passage spans, directed link graphs, and discrepancy ground truth.
  - `apps/personal-records/fixtures/minimal.json`: 3-document baseline seed (`doc_payslip_nov2026`, `doc_payslip_dec2026`, `doc_auto_policy_2026`) with versioned history, `supersedes` link, passage claim, pending proposal, and `valid_until` expiry date.
- **Dates & Provenance Reporting:**
  - All temporal fields (`created_at`, `updated_at`, `valid_until`, `dispatched_at`, `history[].at`) use ISO 8601 timestamps evaluated strictly against `ctx.virtual_now`.
  - Provenance is tracked per document and per version (`source_type`, `source_reference`, `sha256`, `extraction_revision`, `extraction_source`) and declared in `apps/personal-records/contribution/dataset.json` (`dataset_id: "personal-records-synthetic-2025-2026"`, `source_id: "synthetic-generator"`, `license: "CC-BY-4.0"`, deterministic `seed: 42`).
- **Actual Load & Query Verification:**
  - Verified end-to-end via `env.load_seed` $\rightarrow$ `env.snapshot` $\rightarrow$ `personal-records.search` $\rightarrow$ `personal-records.get_document` in `node runtime/cli.cjs verify --app apps/personal-records` and `node --test tests/dataset.test.cjs`.

## 4. Construction plan and effort

### Work breakdown (required)

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | ---: |
| Storage & Core MCP Backend | SQLite schema, FTS5 index, blob store, and MCP endpoints mapped to pinned tools; trusted user session gating. | MCP server passing local CRUD, FTS5 search, idempotency, and version conflict tests. | 5–7 |
| Web UI (Web Host) | 6–8 responsive business views on `runtime/web`; distinct user confirmation modal. | Verified UI rendering, passage highlighting, and confirmation flows across major browsers via Playwright. | 4–6 |
| App Integrations (Mail, Files, Contacts, Calendar) | Read adapters mapped to `mail.get`, `files.read`, `contacts.list`, `calendar.list`; CloudEvent outbound notification dispatch. | Integration tests verifying source byte/hash preservation and zero mutation on source apps. | 3–4 |
| Synthetic Dataset & Ground Truth | Synthesize 150–250 realistic documents partitioned into $\le 1\text{ MiB}$ scenario slices with dual fallback/grading `truth.json`. | Coherent persona histories. Check duplicate detection, extraction consistency, and passage alignment. | 4–6 |
| Platform Lifecycle & Reset Harness | `platform.seed`, `platform.reset`, event injection handlers, and Core replay compliance. | Reproducible reset tests verifying clean table/FTS restoration, baseline re-seeding, and deterministic state. | 3–5 |

### Milestones, owners, and dependencies (required)

- **14-day First Runnable Slice (Approval Milestone):**
  - Deliver runnable core SQLite engine, blob storage, core MCP operations (`records.upload_document`, `records.get_document`, `records.search`, `records.link_documents`), baseline fixture seeder, and `platform.reset`.
  - Pass reproducible unit and integration tests under `npm test` / `pytest`.
- **Subsequent Milestones:**
  - Milestone 2: Mail and Files import adapters; Contacts/Calendar read linking.
  - Milestone 3: Web Host interface and confirmation workflows.
  - Milestone 4: Full synthetic dataset scale-up (150–250 documents) and paired `truth.json` manifests.
  - Milestone 5: End-to-end task integration validation (supporting Task proposals #102 and #106).

Owners: Nassim (@nassimberrada). Calendar duration: 3–4 weeks.

### Resources and total effort (required)
- **Estimated total effort:** 19–28 person-days.
- **Compute & storage:** Modest local development environment (SQLite, Python / Node runtime, $\le 250\text{ MB}$ disk). No external paid APIs or cloud dependencies.

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