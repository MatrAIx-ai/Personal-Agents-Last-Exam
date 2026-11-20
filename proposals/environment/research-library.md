# Environment Track proposal

**Proposed PR title:** `[Environment Proposal] [Learning & research] Research Library (Zotero-inspired)`

Design revision 2026-11-20. This is a proposal, not a completed implementation. Product names identify workflow references only; no affiliation is claimed.

## 1. App and domains

- **Authors / GitHub handles (required):** @2018cx (proposal owner); Xiao Cui (implementation lead after plan approval). Ongoing maintenance is not yet assigned.
- **Reference app or website / URL (required):** Zotero; https://www.zotero.org/ and https://www.zotero.org/support/collections_and_tags. An independently branded research library, not a full clone.
- **Primary domain (required):** Learning & research
- **Secondary domains (optional):** None

## 2. What you plan to build

**✍️ Your answer (required):** A persistent synthetic research library in which the right action depends on the user's research history, prior annotations and permissions. The scope retains six workflows: search/filter; add/import from a local catalog; edit metadata, notes, tags and reading status; create/rename collections and change membership without deleting records; preview and export selected citations; and trash/restore. Draft edits are separate from saving. Personal and group libraries have scoped viewer/editor access. Private notes and preview attachments are not citation fields. Examples include revising a literature collection while keeping earlier annotations, and exporting citations for a collaborator without disclosing private notes. These are environment examples, not separate Task proposals.

## 3. Potential app connections

- **Internal personal apps (required):** The six base workflows run standalone, with no hard personal-App package dependency. These published integrations are optional scenario context, not shadow stores or shared state:

  | Published source and owner | Caller, direction and data | Verification and effects |
  | :--- | :--- | :--- |
  | [Mail 1.3.0](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/61b637164e4abddf81536bb48935cdb688a69ff1/examples/apps/mail/tools.json) owns synthetic request/correction messages | Task/Infra seeds or delivers; Agent queries folder then reads by opaque message ID and may use a synthetic catalog key in a separate Library operation. | Inspect the Mail source and separately read back any authorized Library edit/import. No outbound Mail or mutation on read. |
  | [Calendar 1.3.0](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/61b637164e4abddf81536bb48935cdb688a69ff1/examples/apps/calendar/tools.json) owns the reading deadline | Task/Infra seeds or upserts; Agent reads by time window or event ID and applies it as context. | Inspect the source event and any resulting Library record; Calendar is not a Messaging receiver and no Calendar write is implied. |
  | [Contacts 1.0.0](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/61b637164e4abddf81536bb48935cdb688a69ff1/apps/contacts/tools.json) owns collaborator identity | Task/Infra seeds; Agent searches/reads by ID. The Library maps stable contact/person IDs to local principals and checks library-specific roles. | Inspect the matching contact and verify a separately authorized read or denied write. Groups or unmapped identities do not grant Library access. |

  A standalone scenario can supply equivalent synthetic context in its input; that fallback is not evidence that the optional integration passed.
- **Other apps and websites (required):** Local synthetic catalog and text previews only. No live scholarly search, provider accounts, synchronization or external messaging. Citation exports remain local; neither Files nor Messaging is required.

### Integration details

- **Operations and access (required):** Target the [business Web Host](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/61b637164e4abddf81536bb48935cdb688a69ff1/runtime/web/README.md) and [Core runtime](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/61b637164e4abddf81536bb48935cdb688a69ff1/runtime/core/runtime.cjs) pinned to main `61b6371` (public runtime 1.6.0, Core API 1.2.0). Library-owned pages/controllers call the same fixed Agent MCP business connection and read back the same run/account state as direct Agent calls. The browser UI is for synthetic authorized users or agents when supplied by the task harness; no new generic host, management route or grader UI. Viewers can read scoped records and preview citations; editor grants are needed for writes and persisted exports. Private notes are scoped to their authors. Setup, events, clock, snapshot and reset are Infra-only. The operation names in the acceptance matrix are proposed Library operations, not existing API names.
- **State and lifecycle (required):** The Library owns per-run libraries, role bindings, record revisions, notes, collections, exports and expiry. Reusable catalog definitions are separate from each account/run's seeded state. Example seed (proposed shape):

  ```json
  {"library_id":"group-1","roles":{"a":"editor","b":"viewer"},"records":[{"id":"paper-17","revision":2,"title":"Field Notes"}],"notes":[{"record_id":"paper-17","author":"a","visibility":"private","text":"Check method"}],"collections":[{"id":"reading","members":["paper-17"]}],"session_expires_at":"2027-01-08T12:00:00+00:00"}
  ```

  Use Core request IDs and expected versions for writes. Return committed object/artifact ID and version; same-ID identical replay returns the original result without a second effect, while conflicting replay, stale version or unauthorized writes leave business state unchanged. Reads and cancel do not mutate it. Infra `env.reset` restores this App's seeded state and clock; `env.snapshot` is evaluator evidence, not a restore API. The task/Infra runner owns any coordinated multi-App reset and session/event cursor; resetting the Library does not reset the other Apps.
- **Events and notifications (required):** Task/Infra calls `env.apply_event` using these proposed Library events:

  ```json
  {"event_id":"grant-01","at":"2027-01-08T09:00:00+00:00","operation":"library.permission_change","payload":{"library_id":"group-1","principal_id":"b","role":"editor"}}
  {"event_id":"catalog-01","at":"2027-01-08T09:05:00+00:00","operation":"library.catalog_correct","payload":{"record_id":"paper-17","expected_revision":2,"patch":{"title":"Field Notes, Revised"}}}
  ```

  Permission changes affect only the named principal/library (no grant, viewer or editor). Corrections affect catalog-owned fields and revision, not notes or memberships. An accepted event ID has one effect; unknown IDs, invalid payloads and stale corrections are rejected without a commit. Agent reads or authorization outcomes provide read-back. At access time compare `ctx.virtual_now` with the seeded expiry; at or after expiry even a pending draft cannot be saved. `env.advance_time` does not trigger timers; the runner orders events and synchronizes enabled Apps. Reset restores the seeded clock and deadline. Export confirmation is a local receipt, not external delivery.
- **Shared data and dependencies (required):** Stable synthetic principal, library, catalog, record, collection and export IDs. Initial budget: 100 structured bibliographic records; 20 previews at up to 8 KiB each; 8 retained exports per run at up to 16 KiB and 25 records each. Maximum 288 KiB decoded preview/export bytes. Reject over-cap requests before creating an artifact; report missing previews. UTF-8 BibTeX exports only selected records and allowlisted fields (title, author, year), e.g. `@misc{paper17, title={Field Notes}, author={Avery Example}, year={2027}}`. Never export private notes, attachment bytes or unselected records.

## 4. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Web / app construction | App-owned pages and shared action layer for six workflows. | Browser and Agent output agree on persisted data and denials. | 4–5 |
| Data and image collection | Original synthetic text; no crawling or product media. | Provenance and licenses recorded. | 0.5 |
| Synthetic data and assets | Start with compact seed, expand to the declared budget and cases. | Check IDs, permissions, cross-references and caps. | 1.5–2 |
| App integrations | Standalone first, then validate optional context calls. | Read actual source context and subsequent Library state separately. | 1.5–2 |
| Validation and reset | Use pinned Core lifecycle and shared UI/Agent checks. | Reproduce six traces and verify isolation, replay and reset. | 2.5–3 |

| Workflow and proposed Agent operations | Success and expected evidence | Failure, cancel or unchanged state |
| :--- | :--- | :--- |
| Search/filter: `library.search`, `library.get` (read) | Returns expected record IDs/filter results or empty result. | Unrelated private library denied; no record or note mutation. Cancel not applicable. |
| Add/import: `library.catalog_search` (read), `library.import` (write) | Editor imports catalog item; read back one persisted ID/version. | Retry returns original receipt; discard, invalid ID or viewer write creates no record. |
| Edit: `library.get` (read), `library.save_record` / `library.save_note` (write) | Updated fields/version read back and private note visible only to its author. | Cancel, stale version or expiry leaves the original record and note unchanged. |
| Collections: `library.list_collections` (read), `library.create_collection` / `library.rename_collection` / `library.set_membership` (write) | Read back collection and membership; removing a member retains original record. | Cancel, stale or denied change leaves structures unchanged. |
| Preview/export: `library.preview_citations` / `library.read_export` (read), `library.export_citations` (write) | One local artifact and receipt; exact allowlisted UTF-8 bytes verified. | Preview/cancel has no artifact; replay has one only; over-limit/denied export creates nothing and private data stays out. |
| Trash/restore: `library.list_trash` (read), `library.trash_record` / `library.restore_record` (write) | Trash then restore same ID, notes and membership; verify via direct read and UI. | Cancel/stale/denied operations leave state unchanged; replay has one effect. |

Planned Infra validation uses `env.load_seed`, `env.apply_event`, `env.advance_time`, `env.snapshot` and `env.reset`. Compare UI/direct Agent read-back, repeat request and event IDs, check stale/role/expiry denials and unchanged business state, and correlate evidence by account/run, request/event ID and version. For optional scenarios inspect the public source records and intended Library effects independently, and check that App reset leaves other Apps intact. These are planned tests, not implementation results.

- **Milestones, owners and dependencies (required):** Xiao Cui will lead implementation after the first maintainer plan approval. We will submit a first runnable version in this same PR within 14 calendar days of that approval. This standalone milestone includes a seeded Library App on public Core, Agent search/get/import/edit, a viewer/editor transition, and a reproducible seed → read/write/deny → snapshot → reset demonstration. Full six-workflow GUI/API coverage, optional integrations and independent validation follow as separate milestones. This is not a promise to merge in 14 days; ongoing maintenance is not yet assigned. Related-work comparison checked 2026-11-20 against [#51 Language Study Workspace](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/51), which focuses on recall and study scheduling, and [#33 Personal Records](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/33), which focuses on personal-document extraction and evidence. Our scope is bibliographic citations, research collections and library-level permissions. [#77](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/77) and [#120](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/120) are possible downstream uses, not dependencies or commitments.
- **Resources and total effort (required):** 10–12.5 person-days for the full scope excluding review waits; local target 2 CPU cores and 4 GB RAM, bounded text assets per §3, no paid services or live data.
- **Scope boundary and open questions (required):** No real accounts, public publication, PDF editing, live sync, outward messaging, collection-specific grants or whole-run rollback. Review items: v1 boundary, optional connector coverage and any harness needs beyond the pinned business Web Host.
- **License and external dependencies (required):** MIT proposed for newly authored code and synthetic assets, subject to owner approval and dependency-license review. No proprietary or redistributed product assets. Record licenses and pinned versions for any reused code in delivery evidence.
