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
1. **Document intake & ingestion:** Upload digital documents directly (`personal-records.upload_document`) or ingest caller-supplied payloads (`personal-records.import_from_source`). Supports PDFs, text, and common image formats in v1. *(Live cross-App reads from `Mail` / `Files` are deferred from the Node 18 v1 package; see §3.)*
2. **Organization & search:** Categorize documents by category, tags, and verification state. The Node 18 PALE package (`plugin.cjs`) provides deterministic token/metadata search over Core JSON state; the standalone Node 22.5+ engine (`src/index.cjs`) additionally provides SQLite FTS5 indexing.
3. **Information extraction & passage citation:** Extract structured fields (dates, amounts, policy numbers) alongside stable passage anchors (character offset spans). Digital PDFs and text are extracted deterministically without heavy runtime OCR dependencies.
4. **Arbitrary document relationships:** Model relationships as an open, directed graph (`supersedes`, `tax_supporting_document`, `receipt_for`, `amends`, `parent_contract`).
5. **Change & expiry tracking:** Track document validity and renewal dates evaluated strictly against `ctx.virtual_now`, and flag material numerical discrepancies across linked records.
6. **Evidence tracking, verification & trusted decisions:** Allow agents to cite exact document passages (`INFERRED` vs. `USER_CONFIRMED`) and draft proposals (`personal-records.propose_update`) for `document_metadata` or `claim` targets. Independent user decisions in v1 are applied strictly via the trusted Infra event `env.apply_event` (`personal-records.confirm_decision`), while `personal-records.confirm_update` is blocked in `scenario` (Agent-only) policy and exposed only in `sandbox` preview.

The environment evaluates personal agents on retrieval precision, multi-document temporal reasoning, source attribution, uncertainty handling, and adherence to user confirmation boundaries.

## 3. Potential app connections

### Connected workflows (v1 scope vs. deferred)
The Node 18 PALE v1 package (`app.json`) declares `dependencies: []` and `real_delivery: false`. Simulated peer-app tests in the standalone Node 22.5+ engine pin `Mail`/`Calendar` v1.3.0 and `Files`/`Contacts` v1.0.0 contracts, while live cross-App transport in the PALE runtime is **deferred** in v1:

- **Mail / Files import (`personal-records.import_from_source`):**
  - **Delivered in v1:** Accepts a caller-supplied `source_payload` (raw bytes, MIME type, filename, and source reference) and ingests it with SHA-256 deduplication.
  - **Deferred in v1:** Live authorized retrieval from `Mail` (`mail.get`, `mail.attachment.get`) and `Files` (`files.read`) is simulated only in standalone adapter tests (`src/adapters.cjs` + `fixtures/peer-apps.json`) and deferred from the Node 18 PALE package until sibling `--with` integration is enabled.
- **Calendar (`calendar.list`) & Contacts (`contacts.list`):**
  - **Deferred in v1:** Simulated only in standalone Node 22.5+ adapter tests (`src/adapters.cjs`); not called by the Node 18 PALE package.
- **Outbound Mail Alerts (`urn:pale:email-message:2`):**
  - **Deferred in v1:** `contribution.json` declares `messaging.publishes: []` and `outbox_atomic_with_business_state: "unsupported"`. Expiry and discrepancy alerts persist CloudEvent-shaped notification records locally in `data.notifications` without live router delivery.
- **Other apps and websites:**
  - Simulated locally via static synthetic intake fixtures; no live third-party network access.

### Integration details

#### Operations and access (v1 PALE contract)

The PALE Core runtime enforces caller authorization and optimistic concurrency (`expected_version`, `request_id`):

| Operation | Mode | Caller | Access | Description / Outcome |
| :--- | :--- | :--- | :--- | :--- |
| `personal-records.upload_document` | MCP / Web Host | Agent / Preview | Write | Ingests base64 bytes, creates v1. Duplicate SHA-256 returns `duplicate_document`. |
| `personal-records.import_from_source` | MCP / Web Host | Agent / Preview | Write | Ingests caller-supplied `source_payload` bytes. Missing payload returns `source_unavailable`. *(Live Mail/Files retrieval deferred.)* |
| `personal-records.create_version` | MCP / Web Host | Agent / Preview | Write | Appends `version_number + 1`; stale parent returns `stale_version`, missing doc returns `not_found`. |
| `personal-records.get_document` | MCP / Web Host | Agent / Preview | Read | Retrieves metadata, versions, extracted text, claims, and links. Non-mutating. |
| `personal-records.search` | MCP / Web Host | Agent / Preview | Read | Searches titles, tags, categories, and extracted text. Non-mutating. |
| `personal-records.list_proposals` | MCP / Web Host | Agent / Preview | Read | Lists proposals and their statuses. Non-mutating. |
| `personal-records.list_links` | MCP / Web Host | Agent / Preview | Read | Lists directed document links. Non-mutating. |
| `personal-records.link_documents` | MCP / Web Host | Agent / Preview | Write | Creates directed link (`source_id`, `target_id`, `relationship_type`). Missing target returns `link_target_not_found`. |
| `personal-records.create_evidence_claim` | MCP / Web Host | Agent / Preview | Write | Binds assertion to exact `[start_offset, end_offset]` span. Invalid span returns `invalid_passage_reference`. |
| `personal-records.propose_update` | MCP / Web Host | Agent / Preview | Write | Submits pending mutation for `document_metadata` or `claim` bound to `expected_target_version` and SHA-256 `proposal_hash`. Leaves target unmutated. |
| `personal-records.confirm_update` | Sandbox Preview | Preview only | Write | **Denied** (`permission_denied`) in `scenario` (Agent-only) policy; enabled in `sandbox` for local Web Host preview only. |
| `personal-records.check_expiries` | MCP / Web Host | Agent / Preview | Write | Evaluates `valid_until <= ctx.virtual_now + threshold_days` with 7-day suppression; stores local `EXPIRY_ALERT` in `data.notifications`. |
| `personal-records.check_discrepancies` | MCP / Web Host | Agent / Preview | Write | Compares numerical extracted fields between two documents and stores local `DISCREPANCY_FLAG` if unconfirmed. |
| `env.apply_event` (`personal-records.confirm_decision`) | Infra MCP | Infra / Harness | Admin | **Independent trusted decision path in v1.** Requires `proposal_id`, `expected_proposal_hash`, `expected_target_version`, and `decision`. |
| `env.load_seed` / `env.reset` / `env.snapshot` | Infra MCP | Infra only | Admin | Standard PALE Core lifecycle operations; blocked from Agent MCP (`permission_denied`). |

- **Trusted Confirmation Path & UI Boundaries:**
  - **Agent-only boundary (`scenario` policy):** `personal-records.propose_update` is permitted and creates a `PENDING` proposal with a deterministic `proposal_hash` (SHA-256 of `{ target_type, target_id, expected_version, proposed_changes }`). Calls to `personal-records.confirm_update` by an Agent in `scenario` policy are rejected with `permission_denied`.
  - **Independent User Decision:** Confirmed decisions are applied via `env.apply_event` (`operation: "personal-records.confirm_decision"`) or a separate trusted user session, bound to `proposal_id`, `expected_proposal_hash`, and `expected_target_version`. Stale edits return `stale_proposal_version`, hash mismatches return `proposal_mismatch`, and replayed confirmations on already-resolved proposals return `invalid_state`.
  - **UI Distinction:** `app.json` declares `capabilities.ui: "reviewer renderer"` (`contribution/gui.json`, `audience: ["reviewer"]`). The interactive Web Host UI (`gui/host.html` + `gui/src/app.js` on `runtime/web/server.cjs`) uses `sandbox` policy for local interactive preview only (not as proof of independent user authority); `gui/index.html` + `scripts/run-gui.cjs` is a standalone local preview for the SQLite engine.

- **v1 Delivery Scope vs. Mock-Only / Deferred Integrations:**
  - **Delivered in Node 18 PALE package (`plugin.cjs`):** Document upload/versioning/SHA-256 deduplication, metadata & text search, directed document links, passage-anchored evidence claims, proposal/confirmation state machine (`propose_update`, `confirm_update`, `confirm_decision`), and virtual-time expiry/discrepancy checks.
  - **Delivered in Standalone SQLite engine (`src/index.cjs`, Node 22.5+):** SQLite FTS5 index, filesystem `BlobStore`, optional `pdf-parse` extraction, and simulated peer adapters (`src/adapters.cjs` + `fixtures/peer-apps.json`).
  - **Mock-only / Deferred in v1:** `app.json` declares `dependencies: []` and `real_delivery: false`. Calendar (`1.3.0`) and Contacts (`1.0.0`) lookups are simulated only in standalone tests and **deferred** from the Node 18 PALE runtime. Outbound Mail (`urn:pale:email-message:2`) is **deferred** (`messaging.publishes: []`; alerts are persisted locally in `data.notifications` as CloudEvent payloads without live router delivery). `personal-records.import_from_source` ingests caller-supplied `source_payload` in standalone runs and is verified against real `mail`/`files` packages when supplied via `--with`.

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
- **Outbound Notification Wire Format (Local Record in v1; Live Delivery Deferred):**
  Expiry and discrepancy alerts generate CloudEvent-shaped payloads (`type: "urn:pale:email-message:2"`) persisted locally in `data.notifications`. Live Messaging router dispatch to `Mail` is **deferred** in v1 (`real_delivery: false`, `messaging.publishes: []`).
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
  - `apps/personal-records/fixtures/corpus.json`: 165 deterministically generated synthetic documents across 8 personal administration domains (employment payslips, tax W-2/1040 filings, insurance policies, property leases, utility bills, healthcare EOBs, banking statements, legal notices).
  - `apps/personal-records/fixtures/truth.json`: 20-document scenario slice ($\le 1\text{ MiB}$, $\le 64$ assets) with verified passage spans, directed link graphs, and discrepancy ground truth.
  - `apps/personal-records/fixtures/minimal.json`: 3-document baseline seed (`doc_payslip_nov2026`, `doc_payslip_dec2026`, `doc_auto_policy_2026`) with versioned history, `supersedes` link, passage claim, pending proposal, and `valid_until` expiry date.
- **Represented Document Dates vs. Simulated Ingestion (Provenance & Precision):**
  - `scripts/export-pale-seed.cjs` separates **represented document dates** (`source_reference.represented_date = { value, precision, provenance }`) from **simulated ingestion timestamps** (`source_reference.ingested_at = "2026-11-18T09:00:00-08:00"`, `source_reference.ingestion_provenance`).
  - Across the 165-document corpus in `America/Los_Angeles`: **124** documents have in-window `2025-01`–`2026-12` represented dates (spanning all 24 months), **16** are pre-window (`2024-01`, `2024-03`), and **25** have `precision: "unresolved"` (`value: null`, `provenance: "none_in_source_text"`).
  - Month-only labels (`YYYY-MM`) are preserved at `precision: "month"` without fabricating a day-of-month, and unresolved dates retain `value: null` rather than pretending to be `2026-01-15`.
  - **Which dated fields Tasks may use for strict pre-session history:**
    - Use `created_at` / `versions[].created_at` / `history[].at` for **ingestion/version ordering** relative to `ctx.virtual_now`.
    - Use `source_reference.represented_date.value` (only where `precision` is `"day"` or `"month"`) for **document-content dates**. Do not use `unresolved` records for strict pre-session document-date assertions.
    - Use `valid_until` for **expiry/renewal evaluation** against `ctx.virtual_now`.
- **Actual Load & Query Verification:**
  - `fixtures/minimal.json` provides the 3-document baseline smoke seed for `app:verify`.
  - `node apps/personal-records/scripts/export-pale-seed.cjs --verify-load` converts `fixtures/corpus.json` (or `fixtures/truth.json` via `--truth`) into a `schemas/seed.schema.json`-valid bundle, loads it into PALE Core via `env.load_seed` (`loaded_objects: 165`), queries it via `personal-records.search` (`query_payslip_total: 24`), and reports in-window, pre-window, and unresolved date counts separately in `America/Los_Angeles`.

## 4. Construction plan and effort

### Work breakdown (required)

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | ---: |
| Node 18 PALE Package & Core MCP | `plugin.cjs`, `service.cjs`, `tools.json`, `schemas/`, `env.apply_event` (`confirm_decision`) with hash/version binding. | `npm run app:verify -- --app apps/personal-records` + `tests/pale-runtime.test.cjs` (Agent/Infra MCP boundary). | 5–7 |
| Standalone SQLite Engine (Node 22.5+) | `src/index.cjs` SQLite FTS5, filesystem `BlobStore`, `pdf-parse`, and simulated peer-app adapter tests. | `node --test tests/*.test.cjs` passing CRUD, FTS5 search, idempotency, and task trajectories. | 3–4 |
| Web UI (Web Host & Reviewer Renderer) | `contribution/gui.json` (`reviewer renderer`), `gui/host.html` + `gui/src/app.js` on `runtime/web` (`sandbox` preview), standalone `gui/index.html`. | `runtime/web/host.test.cjs` boundary checks + interactive Web Host preview. | 4–6 |
| Synthetic Dataset & Ground Truth | 165-doc `corpus.json`, 20-doc `truth.json`, and `scripts/export-pale-seed.cjs` Core seed converter. | `export-pale-seed.cjs --verify-load` loading 165 docs into Core with separated date provenance. | 4–6 |
| Cross-App & Live Outbound Mail (Deferred in v1) | Live `Mail`/`Files`/`Calendar`/`Contacts` reads and Messaging `urn:pale:email-message:2` router delivery. | Deferred beyond v1 (`dependencies: []`, `real_delivery: false`); simulated in standalone tests only. | — |

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