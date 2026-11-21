# Environment Track proposal

## 1. App and domains

- **Authors / GitHub handles (required):** Haoyang Su (@Hoyant-Su)
- **Reference app or website / URL (required):** ShelfMark Public Library, an independently branded synthetic municipal public-library catalog, hold-queue, loan/fine ledger and branch study-room portal. Public workflow references: Koha ILS patron OPAC (https://koha-community.org/) and BiblioCommons public catalog workflows (https://www.bibliocommons.com/). No live library API, trademark or scraped catalog is bundled.
- **Primary domain (required):** Public service & law
- **Secondary domains (optional):** Learning & research

## 2. What you plan to build

**✍️ Your answer (required):** ShelfMark Public Library is a resettable, independently branded municipal library simulator where routine actions can succeed on the portal and still fail a patron's real constraints. Real library patrons juggle physical holds across multiple city branches, strict pickup expiration windows, non-renewable loans blocked by another patron's hold queue, overdue-fine suspension thresholds on family or youth cards, inter-branch transit delays, and quiet study-room or museum-pass reservations with cancellation cutoffs. A personal agent must reconcile library deadlines with travel dates in Calendar, household member cards, and budget/fine rules rather than blindly cancelling holds or letting them expire.

Core reusable workflows (entities, state transitions, reads/writes, and failure/control paths):

1. **Search catalog and branch availability (`catalog_item` & `copy`: `available | checked_out | in_transit | on_hold_shelf | lost`):**
   - *Reads:* search titles by keyword, author, ISBN, format (`hardcover`, `paperback`, `audiobook_cd`, `museum_pass`, `library_of_things`), branch location, and availability; inspect per-branch copy status and current hold-queue depth.
   - *Failure/control:* unknown `title_id` returns `NOT_FOUND`; filtering by an unknown branch ID returns `VALIDATION_ERROR`.
2. **Place, suspend, redirect and cancel holds (`hold`: `queued -> suspended -> ready_for_pickup -> checked_out | expired | cancelled`):**
   - *Reads/writes:* place a hold for a chosen pickup branch, suspend/freeze a queued hold until a virtual-time `resume_at` date (preserving queue position during travel), resume a suspended hold, change pickup branch before fulfillment, or cancel a hold.
   - *Confirm/modify/cancel & error paths:* placing a hold while the patron card is `blocked_fines` or at its `max_holds` limit fails with `ACCOUNT_BLOCKED` or `HOLD_LIMIT_REACHED`; suspending a hold already `ready_for_pickup` fails with `INVALID_STATE_TRANSITION`; letting a `ready_for_pickup` hold pass `pickup_expires_at` under virtual time transitions it to `expired` and advances the queue.
3. **Manage active loans, renewals and fine ledger (`loan`: `checked_out -> renewed | overdue -> returned`; `fine`: `open -> waived | paid | disputed`):**
   - *Reads/writes:* inspect due dates, renewal counts, hold-queue blockers and itemized fines; renew eligible loans; pay or submit a waiver/dispute request for a fine (unblocking the card once balance drops below `block_threshold_cents`).
   - *Failure/control:* renewing a loan with an active waiting hold fails with `RENEWAL_BLOCKED_BY_HOLD`; renewing beyond `max_renewals` fails with `RENEWAL_LIMIT_REACHED`; paying with an invalid amount or already-paid `fine_id` fails with `INVALID_PAYMENT` or `ALREADY_SETTLED`.
4. **Reserve, modify and cancel branch study rooms and museum passes (`booking`: `held -> confirmed -> modified -> cancelled | no_show`):**
   - *Reads/writes:* check room/pass availability by branch, capacity, accessibility/quiet-zone attributes and virtual-time slot; create, reschedule or cancel a booking within the branch's cancellation cutoff.
   - *Failure/control:* double-booking an occupied slot fails with `SLOT_CONFLICT`; cancelling past the virtual-time cutoff records a late-cancellation strike (`late_cancel_count`); duplicate submission with the same `request_id` replays the committed receipt without double-booking.

Reuse across distinct task situations: (a) a patron traveling for four days receives a hold-ready notice at a distant branch and must decide—using Calendar—whether to freeze another queued hold so it does not expire while away and cancel or transfer the ready pickup; (b) a parent managing a linked child card discovers checkout is blocked by overdue fines above the $10.00 threshold and must dispute an erroneously billed returned book while paying a legitimate late fee; (c) a researcher needs a quiet study room with a whiteboard at a downtown branch without triggering a no-show penalty on an overlapping reservation. Every task seeds its own branches, catalog, patron cards, loans and event timeline.

Overlap acknowledgement (checked against `proposals/proposal-list.md` on 2026-11-21): existing `Public service & law` proposals are `#16` (CivicDesk, federal regulatory public comments) and `#125` (Ridgeway MVD, state motor-vehicle agency). No existing proposal covers public libraries, hold queues, loans/fines or branch room/museum-pass bookings.

## 3. Potential app connections

- **Internal personal apps (required):**
  - **Mail (`examples/apps/mail/`, version `1.3.0`, `contract_revision: 0.4.0`):** *Optional for standalone App operation; required for patron notice workflows.* Send-only from ShelfMark using Mail's pinned receive contract (`examples/apps/mail/contribution/contribution.json`, `messaging.receives` entry `channel.email`, `schema_id: urn:pale:email-message:2`, `payload_schema_id: urn:pale:email-payload:1`, `event_type: org.pale.mail.notification.v1`, `mcp_tool: env.apply_event`, `operation: mail.receive_notification`). Delivers hold-ready alerts, renewal/fine receipts and study-room booking confirmations.
  - **Calendar (`examples/apps/calendar/`, version `1.3.0`), Messages (`apps/messages/`, version `1.0.0`), Tasks (`apps/tasks/`, version `1.0.0`), Notes (`apps/notes/`, version `1.0.0`), Contacts (`apps/contacts/`, version `1.0.0`):** *Optional separate Agent tool-use connections only.* Agents may independently read travel dates or schedules in Calendar and coordinate pickups with family in Messages; ShelfMark does not import those Apps and does not assume Calendar has a messaging receiver.
- **Other apps and websites (required):** None required at runtime. No external ILS, payment gateway or live library website is called.

### Integration details

- **Operations and access (required):**
  - **Agent-facing business operations** (exposed via both `agent-mcp` stdio tools and the App-owned Web GUI reading/writing the same authoritative state):
    - `catalog.search` / `catalog.get` (`MCP` + `GUI`, `read`): search catalog items and inspect branch copy availability and hold-queue depth.
    - `account.summary` (`MCP` + `GUI`, `read`): read card status (`active | blocked_fines | expired`), hold/loan limits, fine balance and household linked-card references.
    - `hold.list` / `hold.get` (`MCP` + `GUI`, `read`) and `hold.place` / `hold.suspend` / `hold.resume` / `hold.change_branch` / `hold.cancel` (`MCP` + `GUI`, `write`): full hold-queue lifecycle.
    - `loan.list` / `loan.get` (`MCP` + `GUI`, `read`) and `loan.renew` (`MCP` + `GUI`, `write`): inspect due dates/blockers and renew eligible loans.
    - `fine.list` (`MCP` + `GUI`, `read`) and `fine.pay` / `fine.dispute` (`MCP` + `GUI`, `write`): inspect itemized fines, settle balances or file a billing dispute.
    - `booking.search_slots` / `booking.list` (`MCP` + `GUI`, `read`) and `booking.create` / `booking.modify` / `booking.cancel` (`MCP` + `GUI`, `write`): branch study-room and museum-pass reservations.
  - **Infra-only privileged operations** (strictly on `infra-mcp`, unavailable to the Agent and absent from the Agent Web GUI): `env.load_seed`, `env.apply_event`, `env.reset`, `env.snapshot`, `env.event_status`, `env.validate_bundle`, `env.advance_time`.
  - **Reviewer console:** None inside the Agent GUI; inspection uses Core's administrative snapshot/audit interface.
- **State and lifecycle (required):**
  - **State separation:** App-level shared library catalog (`branches[]`, `titles[]`, `copies[]`, `rooms[]`, policy thresholds), account-level patron state (`account_id`, `card_status`, `holds[]`, `loans[]`, `fines[]`, `bookings[]`), and run-level Core isolation (`run_id`, `app_id`, virtual clock, receipts and audit log). Each task loads its own initial catalog, patron history, active loans and fines via `env.load_seed` against `schemas/seed.schema.json`.
  - **Commit evidence, retries and concurrency:** Every write requires `request_id` and `expected_version`, returns `{committed: true, receipt_id, entity_id, version, state_epoch}` on commit, replays the identical receipt on `request_id` retry (preventing double fine payments or duplicate bookings), and rejects stale `expected_version` with `VERSION_CONFLICT`. Reads never mutate business state; rejected writes preserve business state and add a denial row to Core `state.audit`. Evaluator correlation joins App retained hold/loan/fine/booking history with Core `state.audit` and supplied Agent execution records; snapshots are retained prior to reset.
  - **Reset and restore:** `env.reset` enforces `reset_scope: app_instance`, restoring only this ShelfMark instance to its loaded baseline seed without touching Mail or other Apps. Snapshots are inspection evidence, not cross-App rollback.
- **Events and notifications (required):**
  - **Accepted Infra events** (task scenarios choose timing and payload; ShelfMark defines deterministic effects):
    - `hold.ready_for_pickup`: transitions a `queued` hold to `ready_for_pickup` and sets `pickup_expires_at`. Example: `{"event_id": "evt-lib-001", "at": "2026-11-18T10:00:00+00:00", "operation": "hold.ready_for_pickup", "payload": {"hold_id": "hld-402", "branch_id": "br-westside", "pickup_expires_at": "2026-11-21T17:00:00+00:00"}}`.
    - `loan.queue_pressure`: adds another patron's hold onto a title currently checked out, blocking future renewals. Example: `{"event_id": "evt-lib-002", "at": "2026-11-19T08:00:00+00:00", "operation": "loan.queue_pressure", "payload": {"title_id": "ttl-901", "queued_patrons": 2}}`.
    - `fine.assess`: posts an overdue or damaged-item fee and updates `card_status` to `blocked_fines` if total open fines reach `block_threshold_cents`. Example: `{"event_id": "evt-lib-003", "at": "2026-11-19T12:00:00+00:00", "operation": "fine.assess", "payload": {"account_id": "acct-maya-kid", "fine_id": "fin-77", "loan_id": "ln-310", "amount_cents": 1200, "reason": "overdue_12_days"}}`.
    - `branch.closure`: closes a branch for a virtual-time window, automatically extending `pickup_expires_at` for holds at that branch and cancelling affected study-room bookings without penalty. Example: `{"event_id": "evt-lib-004", "at": "2026-11-20T07:00:00+00:00", "operation": "branch.closure", "payload": {"branch_id": "br-westside", "closed_until": "2026-11-22T09:00:00+00:00", "reason": "HVAC maintenance"}}`.
  - **Virtual-time business rules:** Pickup expiration (`pickup_expires_at`), hold suspension auto-resume (`resume_at`), loan due dates and study-room cancellation cutoffs all run strictly on Core's supplied virtual time (`env.advance_time` / event `at`), never host wall-clock time.
  - **Messaging directions:** `publishes`: `channel.email` (send-only, CloudEvents 1.0 wire envelope matching `urn:pale:email-message:2` / `urn:pale:email-payload:1` / `org.pale.mail.notification.v1` -> Mail `mail.receive_notification`). `receives`: `None`. Wire-message payload example (matches `examples/apps/mail/schemas/email-payload.schema.json`, `asset_ids: []`):
    `{"channel": "channel.email", "recipient": {"kind": "person_ref", "id": "person-maya"}, "source_object": {"app_id": "shelfmark-library", "account_id": "acct-maya", "object_type": "hold", "object_id": "hld-402"}, "content": {"title": "ShelfMark Hold Ready at Westside Branch", "body": {"format": "text/plain", "text": "Your hold hld-402 is ready for pickup until 2026-11-21T17:00:00+00:00."}, "asset_ids": []}, "extensions": []}`.
    Sender commit and Mail receiver commit are separate; delivery rejection leaves Mail state unchanged and records the failed delivery receipt without rolling back the local library state.
- **Shared data and dependencies (required):**
  - Patrons and household members are referenced by shared IDs (`person_ref`, `account_id`) via `fixtures/binding.json`; ShelfMark does not duplicate Contacts or Mail accounts.
  - Assets and media fit PALE's reference profile: synthetic PNG book-cover/branch-map cards and UTF-8 JSON/text catalog records, at most 10 bundled assets and <= 200 KiB total decoded bytes (strictly within the 64-asset / 1 MiB reference-profile ceiling). Missing optional cover assets fall back cleanly to structured text metadata without error.
  - Standalone package boundary: `apps/shelfmark-library/` runs independently using only Node 18+, pinned Core API `1.2.0` / public runtime `1.6.0`, and its own package files. `examples/apps/mail` (`v1.3.0`) is an optional integration target supplied via `app:verify --with examples/apps/mail` during integration tests.

## 4. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Web / app construction | Build `apps/shelfmark-library/` package (`app.json`, `plugin.cjs`, `service.cjs`, `tools.json`, `contribution/contribution.json`, `contribution/gui.json`, JSON schemas) plus a Web GUI (Catalog Search, My Holds & Suspensions, Loans & Fines Ledger, Study Rooms & Museum Passes) backed by the same Core state as MCP. | Independent package startup via public runtime; browser + MCP parity across all 4 workflows; verified absence of Infra/admin controls in Agent GUI. | 2.5–3.5 |
| Data and image collection | N/A — no real library catalogs, patron records or third-party assets are scraped or redistributed. | Verified clean provenance manifest confirming zero third-party scraped content. | 0 (N/A) |
| Synthetic data and assets | Generate 100% original synthetic fixtures: 4 city branches, 24 catalog titles across 5 formats (books, audiobooks, museum passes, library-of-things), 6 study rooms, 3 sample patron/household cards, 6 active loans, 5 holds, 3 historical fines and 6 small synthetic PNG cover/floorplan assets (<= 200 KiB total). | Deterministic seed validation against `seed.schema.json`; zero duplicate IDs; binding consistency check; missing-asset fallback check. | 1.0–1.5 |
| App integrations | Implement `messaging.publishes` for `channel.email` targeting `examples/apps/mail` (`v1.3.0`, `urn:pale:email-message:2` / `urn:pale:email-payload:1`). Verify real delivery to Mail inbox, receipt correlation, retry idempotency, and rejected-delivery handling. | Automated integration test invoking real `examples/apps/mail` via `app:verify --with examples/apps/mail`, asserting actual Mail inbox message text, `source_object` metadata, and non-rollback behavior on Mail refusal. | 1.0–1.5 |
| Validation and reset | Write unit business tests covering all 4 workflows (success + error examples below), virtual-time pickup expiry and hold suspension (`env.advance_time`), `request_id` idempotency, `expected_version` conflict rejection, `env.reset` isolation (`reset_scope: app_instance`), and Playwright browser acceptance tests. | Reproducible commands and reports (`app:verify`, `npm test`, Playwright GUI report) verifying: (1) valid hold placement + suspension preserves queue position; (2) hold on `blocked_fines` card returns `ACCOUNT_BLOCKED`; (3) renewal when `loan.queue_pressure` is active returns `RENEWAL_BLOCKED_BY_HOLD`; (4) settling fines below threshold unblocks card; (5) study-room slot collision returns `SLOT_CONFLICT` and `env.reset` restores baseline without clearing Mail. Human review checks library policy realism and UI clarity. | 1.5–2.0 |

- **Milestones, owners and dependencies (required):**
  1. **M1 — Proposal design approval** (Owner: @Hoyant-Su; awaits maintainer `/approve-plan` review — platform/review dependency).
  2. **M2 — Core plugin, schemas, synthetic fixtures and business/virtual-time tests** (Owner: @Hoyant-Su; days 1–5 after M1; depends on M1 and existing public runtime `1.6.0`).
  3. **M3 — Web GUI, Mail integration tests and Playwright verification** (Owner: @Hoyant-Su; days 6–10 after M1; depends on M2 and existing `examples/apps/mail` `v1.3.0`).
  4. **M4 — Final validation report and implementation review** (Owner: @Hoyant-Su; days 11–13 after M1, within the 14-day Environment v1 window).
- **Resources and total effort (required):** Total **6.0–8.5 person-days** across construction, synthetic fixtures, Mail integration and validation. Zero GPU compute, zero paid model API costs, zero external data fees; local CPU Node 18+ + Playwright test runner only; total package storage < 1 MiB.
- **Scope boundary and open questions (required):**
  - *Excluded from v1:* real OverDrive/DRM ebook downloads, live payment-processor integration, inter-library loan (ILL) across external municipal systems, automatic Calendar event creation, and cross-App atomic rollback.
  - *Open questions for design review:* (1) Confirm whether `apps/shelfmark-library/` is the preferred target path; (2) Confirm whether household linked-card visibility should be modeled as separate `account_id` instances bound to one `person_ref` or guardian-delegated sub-accounts within one ShelfMark instance.
- **License and external dependencies (required):** All code, schemas, fixtures and synthetic PNG assets are original work licensed under the repository's MIT license. Zero external runtime services; only Node 18+ built-ins, pinned PALE Core API `1.2.0` / runtime `1.6.0`, and test-only Playwright/Chromium.
