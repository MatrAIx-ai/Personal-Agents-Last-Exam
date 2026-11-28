# Environment Track proposal

**PR title format:** `[Environment Proposal] [<Domain>] <App or website name>`

Example: `[Environment Proposal] [Work & business] Google Calendar`

Copy this template to `proposals/environment/<slug>.md`. Keep the overview concise. The construction plan defines the scope, deliverables, quality checks and effort that reviewers will follow through implementation and merge in this same PR.

✍️ Replace each `[Fill in: …]` with your answer. Optional fields can be `None`. For unresolved details, use `TBD` and explain how they will be resolved.

After design approval, use the [App contribution guide](../../docs/app-contribution.md) and [public Core / Messaging runtime](../../runtime/README.md) to reproduce local integration checks. For connections to existing Apps, consult their [business and receive contracts](../../docs/app-integrations.md) before implementing the sender.

## 1. App and domains

- **Authors / GitHub handles (required):** [@DianJJ](https://github.com/DianJJ)
- **Reference app or website / URL (required):** Vouchfile, an independently branded synthetic academic dossier and confidential-letter service. Interaction reference only: Interfolio Dossier, https://www.interfolio.com/
- **Primary domain (required):** Learning & research
- **Secondary domains (optional):** Work & business

### Domain names

Use the exact names from the [homepage](../../README.md#environment-domains). Choose one primary domain and optional secondary domains; list the primary first in the PR title and join others with ` + `.

<table>
<tr><td>💳 <strong>Money &amp; insurance</strong></td><td>🛍️ <strong>Shopping &amp; groceries</strong></td><td>✈️ <strong>Travel &amp; commuting</strong></td></tr>
<tr><td>🩺 <strong>Health &amp; care</strong></td><td>🍽️ <strong>Food &amp; dining</strong></td><td>💬 <strong>Social &amp; communities</strong></td></tr>
<tr><td>🏠 <strong>Home &amp; utilities</strong></td><td>🏛️ <strong>Public service &amp; law</strong></td><td>🎬 <strong>Media &amp; entertainment</strong></td></tr>
<tr><td>📚 <strong>Learning &amp; research</strong></td><td>💼 <strong>Work &amp; business</strong></td><td>📰 <strong>News &amp; information</strong></td></tr>
<tr><td>🌤️ <strong>Weather &amp; outdoors</strong></td><td>🎮 <strong>Games &amp; play</strong></td><td>🏃 <strong>Fitness &amp; wellbeing</strong></td></tr>
</table>

## 2. What you plan to build

Briefly describe the main workflows and why this environment would be useful for personal-agent tasks.

**✍️ Your answer (required):** A resettable service, seen from one applicant's account, that holds application documents, collects confidential letters from writers and delivers packets to programs (fellowships, graduate admissions, faculty and postdoc searches). The applicant and their agent can see each letter's status but never its content.

Workflows:

1. **Documents:** add a document from supplied bytes, add a new version, archive. Old versions remain readable and stay in any packet that already used them.
2. **Letter requests:** request a letter from a writer with a due date, a message and a waiver choice. Edit the message or due date before upload, cancel before upload, and log a reminder. The writer's side (viewed, uploaded, declined, replaced) arrives as Infra events.
3. **Deliveries:** preview a packet for a program against its requirements, send it, and follow the program's status. A program that accepts updates can receive a new delivery before its deadline.
4. **Notices:** Vouchfile records four notices for the applicant: request created, letter uploaded, request declined and delivery sent. When Mail is enabled, the host delivers them to the applicant's inbox (Section 3).

Business rules that make the right action depend on the person:

- **A delivery is a snapshot.** It contains exactly the document versions and letters selected when it was sent. A letter uploaded later is not added to earlier deliveries. For example, if a packet goes to program A on Dec 1 with two letters and the third letter arrives on Dec 3, A holds two letters until a new delivery is sent, and only if A accepts updates.
- **Letters are confidential.** No Agent tool or resource read returns letter bytes. Letter metadata (writer, upload time, page count, waiver) is visible.
- **The waiver is fixed at request time.** It records whether the applicant gives up the right to see the letter later, outside this service; the letter is unreadable here either way. It cannot be changed later. Programs may require waived letters, and preview flags a mismatch.
- **Letters are chosen per delivery.** A writer's letter can be left out of one program's packet and included in another's.
- **Reminders are rate-limited.** No reminder in the first 7 days after the request, then at most one every 7 days, and none after upload, decline or cancellation. A reminder only records its time in the request history; no message reaches the writer, and the Task scripts any reaction.
- **Deadlines are instants in the program's time zone**, such as 17:00 on Dec 1 in New York, and a delivery after the deadline is rejected.

Entities: applicant account, document and its immutable versions, writer, letter request, letter (metadata plus a confidential asset, with versions), program and its requirements, delivery (an immutable snapshot), program status history and outbound notice.

Request status: `requested` → `viewed` → `uploaded`, or `declined` (by the writer), or `cancelled` (by the applicant). An open request is one in `requested` or `viewed`. A replaced letter keeps the request in `uploaded` and adds a letter version; new deliveries use the latest version, and earlier deliveries keep the version they were sent with.

Reusable value: the rules above support tasks that do not share a story. Examples: a third letter that arrives after the first delivery; a writer who sits on one program's panel, so their letter must be excluded from that packet only (the situation in Task #185); a writer the user no longer wants to ask (Task #178); a program that requires waived letters; reminding a slow writer without nagging. Task #185 currently stands in for this service with timed Mail notes and plain upload links, so snapshot, confidentiality and waiver behavior cannot be tested there today. The App holds no rubric, no preferred writer and no task answer.

Related work, checked against the proposal index on 2026-11-23: #4 (Zotero-style research library), #148 (paper release and submission receipts) and #22 (job postings and applications). None manages confidential letters or dossier deliveries. A future job-board application could link to a Vouchfile delivery; that link is not in this scope.

## 3. Potential app connections

Name possible connections and briefly explain their purpose. Internal personal apps include Mail, Calendar, Contacts and similar tools. Use `None` if no connection applies, or `TBD` if undecided.

For internal personal Apps, state which workflow needs each App and whether the connection is required or optional. Link the existing public interface/version, or identify the missing capability, owner and fallback.

- **Internal personal apps (required):**
  - **Mail 1.3.0, optional, in v1 scope (workflow 4).** Vouchfile stores each notice as an outbound record in its own state and exposes it as a stable CloudEvent through the read-only tool `vouchfile.outbound`, as `messages.outbound` does for chat messages. It declares one `messaging.publishes` entry (channel `channel.email`, event type `org.pale.mail.notification.v1`, schema `urn:pale:email-message:2`, payload `urn:pale:email-payload:1`, and a `schema_ref` to a pinned, byte-identical copy of Mail's wire schema). Mail receives it with `mail.receive_notification`, as declared in [`examples/apps/mail/contribution/contribution.json`](../../examples/apps/mail/contribution/contribution.json). The host or runner calls `router.publish` on the Infra-supplied publisher connection; the Agent and the App handlers never publish. The host reads new notices through `vouchfile.outbound` on an agent-role connection, which the task policy must allow, after each committed write or event, and publishes them before the Agent's next step. Delivery needs a router configuration that lists Vouchfile as a publisher with `allowed_recipients: [{app_id: mail, account_id: <applicant's mail account>, channel: channel.email}]`, and the recipient is `{kind: person_ref, id: <applicant's person ID from binding.json>}`. Vouchfile runs without Mail: notices are then recorded and nothing is published. No attachments are sent, so the attachment channel is not used.
  - **Contacts 1.0.0, optional (workflow 2).** The agent reads writer addresses with `contacts.list` and `contacts.get` and passes them to `vouchfile.request.create`. There is no messaging between the two Apps.
  - **Files 1.0.0, optional (workflow 1).** The agent reads a document with `files.read`, which returns base64 bytes and SHA-256, and passes both to `vouchfile.document.add`. There is no messaging between the two Apps.
  - **Calendar 1.3.0, optional.** The agent may record a program deadline with `calendar.create`, which needs a start, an end and a time zone and rejects conflicting events. Calendar has no messaging receiver, and Vouchfile sends it nothing.
- **Other apps and websites (required):** None at run time. Writers and programs are outside actors; their actions arrive as validated Infra events whose timing the Task decides.

### Integration details

- **Operations and access (required):** MCP only in v1. Agent tools and their effects are listed below. Write tools take `expected_version` and `request_id`. `request_id` is Core's idempotency key; a letter request is addressed by `id` in tools and by `letter_request_id` in event payloads.

  | Tool | Effect | Precondition | Result | Failure example |
  | :--- | :--- | :--- | :--- | :--- |
  | `vouchfile.documents.list` / `vouchfile.document.get` | read | own account | metadata; `get` returns bytes of a selected version | unknown ID → `not_found` |
  | `vouchfile.document.add` | write | base64 and SHA-256 match; PDF or UTF-8 text; at most 16 KB | new document or new version | hash mismatch → Core's `invalid_attachment`; larger file → `file_too_large` (App pre-check); instance budget exceeded → Core's `invalid_bundle`, with nothing changed |
  | `vouchfile.document.archive` | write | not already archived | hidden from new deliveries; kept in old ones | already archived → `conflict` |
  | `vouchfile.requests.list` / `vouchfile.letters.list` | read | own account | statuses, history and letter metadata, never bytes | — |
  | `vouchfile.request.create` | write | valid writer address; waiver chosen | request `requested`; outbound notice recorded | missing waiver → Core's `invalid_arguments` |
  | `vouchfile.request.update` | write | open request | message or due date changed; waiver unchanged | waiver in patch → `immutable_field` (the input schema admits the field so that the App can name the rule); not open → `request_closed` |
  | `vouchfile.request.cancel` | write | open request | request `cancelled` | after upload → `letter_already_uploaded`; declined or cancelled → `request_closed` |
  | `vouchfile.request.remind` | write | open request; at least 7 days since the request and since the last reminder | reminder time recorded in the request history | 3 days after the last → `reminder_rate_limited`; not open → `request_closed` |
  | `vouchfile.programs.list` / `vouchfile.program.get` | read | — | requirements: letters required, waiver required, documents, deadline and time zone, accepts updates | — |
  | `vouchfile.delivery.preview` | read | input: program ID, document version IDs, letter IDs | packet contents and requirement gaps | archived document or letter of a closed request → `invalid_selection` |
  | `vouchfile.delivery.send` | write | same input as preview; before the program deadline; first delivery, or the program accepts updates; no requirement gaps unless `allow_incomplete` is true | immutable snapshot `sent`; outbound notice recorded | after deadline → `deadline_passed`; second delivery when updates are not accepted → `updates_not_accepted`; gaps without the flag → `requirements_not_met` |
  | `vouchfile.deliveries.list` / `vouchfile.delivery.get` | read | own account | snapshot contents and program status history | — |
  | `vouchfile.outbound` | read | own account | recorded notices as stable CloudEvents; the tool reports no delivery state | — |
  | `vouchfile.help.get` | read | — | the service's rules page, so every business rule above is discoverable | — |

  Infra uses the shared management operations (`env.load_seed`, `env.apply_event`, `env.reset`, `env.snapshot`, `env.event_status`, `env.validate_bundle`, `env.advance_time`), which are not available on the Agent connection. `fixtures/policies.json` ships a read-only `scenario` profile and a `sandbox` profile that allows all writes; Tasks supply their own policy.

  Confidentiality is enforced by the platform's resource-access check, not by App code. Letter assets are attached to objects of type `letter`, which has no registration entry, so both MCP resource reads and the App's own `ctx.assets.read` are denied; page counts therefore come from event payloads. Seeded letter assets also declare an audience without `agent`. The proposed registration `runtime/registrations/vouchfile.json` maps only `document` to `vouchfile.document.get`, and documents are readable only when the task policy allows that tool. The confidentiality test covers the MCP resource path and every Vouchfile read tool.
- **State and lifecycle (required):** Core persists one state per run and App instance, and each instance holds exactly one applicant account; a second applicant is a second instance with its own state root. A seed loads the account, documents and versions, writers, requests in any status with their reminder history, letters (metadata and asset bytes), programs with their status history, and past deliveries. Reset restores the loaded baseline, and snapshots are Infra-only. Writes check `expected_version`; a repeated `request_id` with the same arguments, including `expected_version`, returns the original result, and with different arguments fails with `idempotency_conflict`. A failed write or event changes no business state and no clock. Current time comes from `ctx.virtual_now`; deadlines are compared in each program's time zone, and an event cannot move time backwards. Vouchfile's shipped bundles reject missing assets; if a Task bundle allows declared-missing assets, the affected letter or document cannot be selected for a delivery (`invalid_selection`).
- **Events and notifications (required):** Events use the runtime shape `{event_id, at, operation, payload}`.

  | Operation | Payload | Effect | Rejected when |
  | :--- | :--- | :--- | :--- |
  | `vouchfile.writer.viewed` | `letter_request_id` | `requested` → `viewed` | request not `requested` → `invalid_transition` |
  | `vouchfile.writer.uploaded` | `letter_request_id`, `file` (`filename`, `mime_type`, `base64`, `sha256`), `pages` | request → `uploaded`; letter stored with `ctx.assets.add`; notice recorded | unknown request → `not_found`; request not open → `invalid_transition`; bad hash, format or size → `invalid_attachment`; over budget → `invalid_bundle` |
  | `vouchfile.writer.declined` | `letter_request_id`, optional `reason` | request → `declined`; notice recorded | request not open → `invalid_transition` |
  | `vouchfile.writer.replaced` | `letter_request_id`, `file`, `pages` | new letter version; earlier deliveries unchanged | unknown request → `not_found`; request not `uploaded` → `invalid_transition`; file and budget errors as for upload |
  | `vouchfile.program.status` | `delivery_id`, `status` (`received`, `complete`, `incomplete`), optional `reason` | appended to the delivery's status history | unknown delivery → `not_found` |
  | `vouchfile.program.updated` | `program_id`, changed deadline or requirements | program record updated; existing deliveries unchanged | unknown program → `not_found` |

  Example: `{"event_id":"evt-req3-upload","at":"2026-12-03T10:15:00-05:00","operation":"vouchfile.writer.uploaded","payload":{"letter_request_id":"req-3","file":{"filename":"letter-3.pdf","mime_type":"application/pdf","base64":"<bytes>","sha256":"<hash>"},"pages":2}}` moves req-3 to `uploaded` and leaves delivery d-1 unchanged. Minimal payloads for the other operations: `{"letter_request_id":"req-3"}` for viewed; `{"letter_request_id":"req-2","reason":"conflict of interest"}` for declined; the upload payload again for replaced; `{"delivery_id":"d-1","status":"incomplete","reason":"2 of 3 letters"}` for program status; and `{"program_id":"prog-kestrel","deadline":"2026-12-08T17:00:00-05:00"}` for program updated. A rejected event rolls back completely.

  Notice example, following the shape of `examples/workflows/delivery-to-mail/delivery/message.json`: `{"specversion":"1.0","id":"vouchfile-3fa81c20","source":"urn:pale:app:vouchfile:account:vouchfile-ana","type":"org.pale.mail.notification.v1","time":"2026-12-04T09:00:00-05:00","datacontenttype":"application/json","dataschema":"urn:pale:email-payload:1","data":{"channel":"channel.email","recipient":{"kind":"person_ref","id":"person-ana"},"source_object":{"app_id":"vouchfile","account_id":"vouchfile-ana","object_type":"delivery","object_id":"d-2"},"content":{"title":"Delivery sent to Kestrel Fellowship","body":{"format":"text/plain","text":"Your packet with 3 letters and 2 documents was sent on Dec 4."},"asset_ids":[]},"extensions":[]}}`. The plan includes one such example per notice type, each checked against Mail's wire schema with the public validator. The Vouchfile commit and the Mail commit are separate: a rejected or unknown receipt does not roll back the request or delivery. The receipt is returned to the host by `router.publish` and logged by Messaging; Vouchfile does not learn it. Delivery is verified in Mail, whose record carries the receipt's event ID.
- **Shared data and dependencies (required):** Writers and the applicant are bound to people and accounts through `fixtures/binding.json`, so a Task can align them with Contacts and Mail records. Object references are program, request, letter, document version and delivery IDs. Media: documents in PDF or UTF-8 text and letters in PDF, each at most 16 KB. Each seed uses at most 24 assets (at most 384 KB), which leaves room for 40 more assets within the 64-asset / 1 MiB per-instance budget; run-time uploads and replaced letters count against the same budget. The package runs alone with the shared runtime and declares no package dependencies. Mail is a recipient chosen in the run assembly, and the integration test uses a router configuration and registry in the style of `examples/workflows/delivery-to-mail`.

## 4. Construction plan and effort

Specify how the environment will be built, what will be collected or synthesized, and how each deliverable will be checked. Include expected counts or coverage where relevant. Effort estimates may be ranges; use person-days for human work. Mark reusable components and explain any workstream that is not applicable.

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Web / app construction | `apps/vouchfile/`: the 18 Agent tools above, business rules, seed, state and event schemas and six event handlers, following the Files and Messages package layout. No GUI in v1. | Business tests for every tool: one success and at least one failure each, plus snapshot, waiver, reminder, deadline and confidentiality invariants, and every rejected event transition. | 3–4 |
| Data and image collection | N/A: no scraping or copied assets. The reference product's public help pages are read for plausibility only. | Source note in `contribution/dataset.json` | N/A |
| Synthetic data and assets | Three seed files, each loading one applicant account into its own instance: postdoc fellowships, PhD admissions and a faculty search. About 8 writers, 7 programs with varied requirements and time zones, and 30–45 objects in all statuses across the three seeds. Short original PDF letters and documents, at most 24 assets per seed. | Referential and chronological consistency, every status and requirement combination present, no real people or institutions, assets within budget | 1–1.5 |
| App integrations | Outbound notices and the `messaging.publishes` declaration for the four notice types, delivered to Mail 1.3.0 by a host workflow that calls `router.publish`. Contacts, Files and Calendar use only Agent tools and need no App code. | Real-runtime test: the notice is in the Mail inbox with the expected fields and matches the committed receipt's event ID; with a rejected grant or an unknown recipient, `router.publish` returns a rejection, Mail is unchanged and Vouchfile's request or delivery stands; a duplicate publish returns the first receipt and delivers once | 1.5–2 |
| Validation and reset | `app:verify` on the package alone, plus the Mail workflow above. Agent cannot call Infra operations or read letters. Stale and duplicate writes, rollback on bad events, history loading, reset to the loaded baseline and time-zone deadline cases. | Report with exact App, runtime and Mail versions, commands and outputs, reproducible from a clean checkout; list of remaining manual checks | 2–2.5 |

- **Milestones, owners and dependencies (required):** DianJJ owns delivery. Days 1–7: tools, rules, schemas, fixtures and tool business tests. Days 8–12: event handlers and their tests, outbound notices, the Mail workflow and public-runtime verification. Days 13–14: evidence report and first-version submission, within the 14-day first-version deadline. Dependencies: public runtime 1.6.0 and Mail 1.3.0 on `main`, both available. Related: Task #185 (would use workflows 2 and 3), Task #178 (writer choice), and #148 and #4 (no overlap in scope).
- **Resources and total effort (required):** 7.5–10 person-days. Laptop with Node.js 18+, no package installs, no GPU, no paid data or live services. Synthetic text fixtures under 1 MiB per seed.
- **Scope boundary and open questions (required):** Excluded from v1: a GUI, the writer-facing upload page, program-side review portals, fees and payments, letters shared across applicant accounts, and attachments in notices. Program decisions such as admit or reject are out of scope; programs only report packet status. Not applicable in v1: recalling a sent delivery, because a snapshot is immutable and a correction is a new delivery where the program accepts updates; and restoring an archived document, because a new version can be added instead. Open questions, to settle with the reviewer before implementation: (1) the `vouchfile.document` resource registration needs Infra review; if it is not granted, `vouchfile.document.get` returns metadata only and v1 ships without document byte reads; (2) whether notices already delivered to Mail need any handling when only Vouchfile is reset. A notice ID is `vouchfile-` plus a SHA-256 prefix of the source object ID, notice type and content, so a retry is stable and changed content gets a new ID. After a reset, the plan assumes the runner starts a new run for Vouchfile, Mail and the router.
- **License and external dependencies (required):** MIT for code and all synthetic fixtures; no third-party assets, logos or copied text. Nothing is hosted elsewhere, and no external service is needed at run time.

After approval, add implementation and validation links against these deliverables in the same PR. Reviewers use the approved plan as the acceptance baseline; substantial scope changes require another design review. See the [contribution guide](../../CONTRIBUTING.md#review-and-implementation).
