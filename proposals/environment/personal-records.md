# [Environment Proposal] [Work & business + Money & insurance] Personal Records

## 1. App and domains

- **Authors / GitHub handles (required):** Nassim (@nassimberrada)
- **Reference app or website / URL (required):** [Paperless-ngx](https://docs.paperless-ngx.com/) — open-source document management system. The proposed environment extends this model with richer document relationships, extracted information, evidence tracking and agent-facing workflows.
- **Primary domain (required):** Work & business
- **Secondary domains (optional):** Money & insurance; Public service & law; Home & utilities; Health & care

## 2. What you plan to build

Build a personal document management and intelligence app where users can store, organise, search and manage important personal records. The app should go beyond basic file storage: it should extract useful information from documents, identify relationships between records, track changes and provide traceable evidence for decisions.

Core workflows include:
- **Document intake:** Upload documents or receive them from connected sources. Support PDFs, images, email attachments and common office formats.
- **Organisation and search:** Categorise documents by type, person, organisation, date, topic and custom tags. Support full-text and metadata search.
- **Information extraction:** Extract relevant fields such as dates, amounts, names, policy terms, account details and contract conditions. Retain links to the original document and relevant passages.
- **Document relationships:** Link related documents, such as successive payslips, employment contracts, bank statements, insurance policies and investment reports.
- **Change and expiry tracking:** Identify new versions, changed terms, missing records, upcoming expirations and relevant updates.
- **Evidence tracking:** Let users and agents link claims, facts and decisions to supporting documents. Track evidence quality, source, date and verification status.
- **Agent-assisted workflows:** Allow agents to search records, summarise documents, identify relevant evidence, flag inconsistencies and prepare proposed updates. Require user approval for consequential changes.

The environment is useful for evaluating agents because it tests document retrieval, cross-document reasoning, information extraction, source attribution, uncertainty handling, change detection and user control.

## 3. Potential app connections

- **Internal personal apps (required):**
  - Mail: Read permitted messages and attachments to identify relevant records and events. Support saving attachments into the document library.
  - Calendar: Read relevant dates, deadlines and upcoming events. Link them to documents where useful.
  - Contacts: Associate documents with people, employers, advisers and organisations.
  - These should initially use simulated accounts and data rather than live personal accounts.

- **Other apps and websites (required):**
  - Google Drive / Dropbox / OneDrive: Import and organise documents from external storage.
  - Gmail / Outlook: Import permitted email attachments and relevant messages.
  - Personal finance and investment platforms: Import synthetic statements, account summaries and transaction reports.
  - E-signature services: Import signed contracts and agreements.
  - These connections should be represented by controlled adapters or simulated services in the initial environment. Live third-party account access is out of scope.

### Integration details

- **Operations and access (required):**
  - Provide a browser-based interface for document upload, browsing, search, preview, tagging, editing metadata, linking records and managing permissions.
  - Provide agent-facing API or MCP operations for listing, searching, reading, uploading, categorising, linking and updating documents.
  - Expose structured metadata and extracted text alongside references to the original files and relevant text passages.
  - Support document version creation, evidence-link creation, annotation and audit-log retrieval.
  - Provide platform operations for creating accounts, loading fixtures, injecting new documents and events, capturing state and resetting an environment.
  - Destructive actions and changes to verified records should require explicit confirmation.

- **State and lifecycle (required):**
  - Keep user accounts and their document libraries isolated.
  - Store original files separately from extracted text, metadata, annotations and derived information.
  - Preserve document identity, source, upload time, creation date, version history and processing status.
  - Track the origin of extracted facts and distinguish user-confirmed information from machine-extracted or inferred information.
  - Support deterministic initial datasets, snapshots and full reset to a known state.
  - Make writes idempotent where possible. Return clear success or failure results and handle retries without creating duplicate records.
  - Use version checks to prevent concurrent updates from silently overwriting user changes.

- **Events and notifications (required):**
  - Accept events such as a new document upload, a replacement document, an email attachment arriving, a document expiry approaching or a connected source receiving an update.
  - Notify users about processing failures, missing information, potential duplicates, conflicting records and documents requiring review.
  - Support simulated event injection so task scenarios can introduce new evidence over time.
  - Example: a new payslip arrives; the system extracts its pay period and net income, links it to previous payslips and flags a material change for review.
  - Example: a revised insurance policy arrives; the system compares it with the prior version and highlights changed coverage terms.
  - Notifications should be available in the app. Email and push notifications can be simulated.

- **Shared data and dependencies (required):**
  - Core objects: users, accounts, documents, document versions, attachments, extracted fields, tags, entities, relationships, annotations, evidence claims, permissions, events and audit records.
  - Support PDF, PNG, JPEG, TXT, DOCX, XLSX and common email formats such as EML.
  - Store original files and extracted content with stable identifiers so agents can cite specific documents and passages.
  - Use OCR and document parsing for scanned and digital documents. Keep extraction results reproducible where possible.
  - Shared services include file storage, a relational database, full-text search and document-processing workers.
  - Use synthetic personal information and financial records throughout the environment.

## 4. Construction plan and effort

**Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | ---: |
| Web / app construction | Build a responsive document library, upload flow, document preview, search, filters, metadata editor, document detail page, version history, relationships and evidence view. Include approximately 8–10 main screens. | Working browser app. Verify upload, search, preview, metadata edits, linking, version history and permissions through end-to-end tests. | 8–12 |
| Data and image collection | Use no real personal records. Review Paperless-ngx and similar open-source systems for reusable interaction patterns. Create a small set of public-domain or openly licensed sample documents only if needed for format testing. | Record source and license for reused assets. Verify that no personal or restricted data is included. | 1–2 |
| Synthetic data and assets | Generate approximately 150–250 realistic documents across 8–10 categories, including financial, employment, insurance, property, tax, legal, health and household records. Include scans, digital PDFs, spreadsheets, email attachments, multiple versions, missing fields and conflicting information. | A coherent synthetic dataset with linked people, organisations, dates and accounts. Check extraction accuracy, consistency, realistic variation, duplicate handling and traceability to source documents. | 4–6 |
| App integrations | Build simulated adapters for Mail, Calendar and Contacts, plus import adapters for cloud storage and financial records. Support document and event injection through APIs. | Verify import, attachment handling, source attribution, permissions and state consistency across connected services. | 3–5 |
| Validation and reset | Test document upload, search, extraction, version comparison, evidence linking, permissions, concurrent updates, event handling and reset. Create repeatable fixtures and expected outcomes. | Reproducible local tests and platform validation evidence. Verify account isolation, permission enforcement, audit history and clean reset. | 3–5 |

- **Milestones, owners and dependencies (required):**
  1. Finalise data model, app scope and API design.
  2. Build document storage, upload, search and preview.
  3. Add extraction, metadata, document relationships and version history.
  4. Generate synthetic documents and connected-source fixtures.
  5. Add agent-facing operations, event injection and notifications.
  6. Run workflow tests, fix issues and prepare platform validation evidence.

  Owners: Nassim (@nassimberrada). Expected calendar duration: approximately 3–5 weeks, depending on team size and parallel work. Main dependencies are file storage, database, OCR/document parsing and the platform's environment integration interface.

- **Resources and total effort (required):**
  - Estimated total: 19–30 person-days.
  - Expected costs: Low. Use local or open-source OCR and document-processing tools where possible.
  - Storage and compute: A modest local development environment with file storage, a relational database and background processing.

- **Scope boundary and open questions (required):**
  - The initial environment focuses on personal document management and evidence tracking, not a full personal finance, email or cloud-storage replacement.
  - No live financial account access, transactions, payments, investment execution or legal/financial advice.
  - No real personal or sensitive records. Use synthetic data, including synthetic health and financial documents.
  - Agents may extract, compare and propose changes, but must not silently alter original documents or treat inferred facts as verified.
  - Users must be able to inspect the source behind extracted information and correct errors.
  - Initial integrations will be simulated. Which external services, if any, should be implemented as live integrations can be decided after the core environment is validated.
  - The exact OCR and document-parsing stack remains TBD and will be selected based on local deployment, supported formats and extraction quality.

- **License and external dependencies (required):**
  - New application code should use an open-source license compatible with the repository's contribution requirements; proposed license: MIT.
  - Reuse of Paperless-ngx or other external code is not assumed. Its documentation and interface patterns may be used as references. Any reused code or assets must have their licenses recorded and be compatible with the chosen license.
  - Synthetic documents and generated assets will be created for this environment and distributed with it where practical.
  - No external service should be required at runtime for the initial version. OCR and parsing should run locally or through controlled, replayable services.