# Environment Track Proposal: Hearth — Household Simulation

**Title:** `[Environment Proposal] [Home & utilities + Shopping & groceries] Hearth`

**Proposed file:** `proposals/environment/household-simulation.md`

## 1. App and domains

- **Authors / GitHub handles (required):** Nassim (@nassimberrada)
- **Reference app or website / URL (required):** Home Assistant ([home-assistant.io](https://www.home-assistant.io/)) as a conceptual reference for household entity modeling. Hearth is an original simulation focusing on physical space, furniture inventories, maintenance lifecycles, and resident resource sharing.
- **Primary domain (required):** Home & utilities
- **Secondary domains (optional):** Shopping & groceries

## 2. What you plan to build

Hearth is a persistent household simulation environment where personal agents manage a home, its physical spaces, belongings, maintenance needs, and resident constraints across long-horizon scenarios.

Rather than duplicating productivity apps or simulating smart-home device protocols, Hearth models the home’s physical reality: property dimensions, 2D room coordinates, furniture inventories with clearances, appliance conditions, maintenance histories, and shared resident preferences. It serves as the household system of record for tasks like spatial re-organization, moving, appliance repair coordination, and shared expense/inventory management.

The Hearth package is completely self-contained and runs on the shared runtime (Runtime 1.6.0 / Core API 1.2.0) with zero external network dependencies.

### Core Workflows (Version 1)

1. **Spatial & Furniture Inventory Management (Read/Write):**
   - The agent inspects room dimensions, architectural obstacles (door swings, windows), and furniture dimensions ($L \times W \times H$, clearance requirements), or updates furniture locations and status (`active` → `stored` → `disposed`).
   - *Checkable outcome:* Object records reflect updated room placements, coordinates, and disposition histories.
2. **Maintenance & Repair Lifecycle (Read/Write):**
   - The agent tracks appliance warranties, schedules repairs, or resolves household faults (`reported` → `scheduled` → `resolved`).
   - *Checkable outcome:* Appliance condition records update from `degraded`/`broken` to `operational` with attached repair cost entries.
3. **Purchasing with Resident Approval (Read/Write):**
   - The agent proposes household purchases (e.g., replacement microwave, furniture). Large purchases enter a structured approval flow (`pending_approval` → `approved`, `denied`, or `expired`).
   - *Checkable outcome:* Upon approval event from a resident, inventory adds the item and household budget balances decrement atomically.
4. **Resident Profile & Shared Preference Auditing (Read-Only):**
   - The agent retrieves resident spatial preferences, accessibility rules, and heirloom constraints bound to platform `person_id`s.
   - *Checkable outcome:* Agent retrieves confirmed constraints without hallucination.

## 3. Potential app connections

Hearth does not simulate or copy existing platform apps. External interactions are handled via direct Agent calls to merged apps or declared message sends:

- **Calendar 1.3.0 (`examples/apps/calendar` - Required for appointments):**
  - Direct Agent tools: `calendar.list`, `calendar.freebusy`, `calendar.create`, `calendar.update`.
  - *Usage:* Maintenance service visits and resident moving days are scheduled as real calendar events. Calendar events remain in Calendar; Hearth only stores internal chore routines and appliance maintenance histories.
- **Mail 1.3.0 (`examples/apps/mail` - Optional):**
  - Direct Agent tools: `mail.search`, `mail.get`.
  - *Messaging declaration:* Hearth declares send-only in `messaging.publishes` on `channel.email` (`mail.receive_notification`, payload `urn:pale:email-payload:1`) to send automated household summary notices to the resident's inbox.
- **Contacts 1.0.0 (`apps/contacts` - Required for people):**
  - Direct Agent tools: `contacts.list`, `contacts.get`.
  - *Usage:* Landlords, plumbers, and household members are resolved through Contacts. Hearth references them strictly by their platform `person_id`.
- **Files 1.0.0 (`apps/files` - Optional for documents):**
  - Direct Agent tools: `files.read`, `files.put`.
  - *Usage:* PDF lease documents, appliance user manuals, and warranty receipts are stored in Files; Hearth holds the foreign `file_id`.
- **Tasks 1.0.0 (`apps/tasks` - Optional for chore assignments):**
  - Direct Agent tools: `tasks.create`, `tasks.transition`.
  - *Usage:* Individual chore to-do items assigned to specific residents are pushed to Tasks.

### Integration details

- **Operations and access (required):**
  Hearth exposes an Agent-facing MCP interface in `tools.json`. All mutating tools require `request_id` (idempotency) and `expected_version` (optimistic locking):
  
  *Agent MCP Tools:*
  - `hearth.get_property() -> PropertyDetails` (Read-only: address, floor plan metadata, rooms list)
  - `hearth.get_room(room_id: string) -> RoomDetails` (Read-only: dimensions, door/window boundaries, current objects)
  - `hearth.list_inventory(room_id?: string, category?: string) -> InventoryList` (Read-only)
  - `hearth.update_item_placement(item_id: string, room_id: string, coordinates: [int, int], expected_version: int, request_id: string) -> ItemRecord` (Write)
  - `hearth.dispose_item(item_id: string, reason: string, expected_version: int, request_id: string) -> ItemRecord` (Write)
  - `hearth.request_purchase(purchase_data: PurchaseInput, request_id: string) -> PurchaseRecord` (Write: creates request in `pending_approval`)
  - `hearth.cancel_purchase(purchase_id: string, expected_version: int, request_id: string) -> PurchaseRecord` (Write)
  - `hearth.list_maintenance_issues(status?: string) -> IssueList` (Read-only)
  - `hearth.report_maintenance_issue(issue_data: IssueInput, request_id: string) -> IssueRecord` (Write)
  - `hearth.resolve_maintenance_issue(issue_id: string, resolution_notes: string, cost_usd: float, expected_version: int, request_id: string) -> IssueRecord` (Write)
  - `hearth.get_resident_profile(person_id: string) -> ResidentProfile` (Read-only)

  *Platform Infra Operations:*
  `env.load_seed`, `env.reset`, `env.snapshot`, and `env.apply_event` are Core-managed infrastructure operations served on a separate connection inaccessible to the Agent.

- **State and lifecycle (required):**
  - **Single Account per Instance:** One Hearth instance represents exactly one household property identified by `account_id` and owned by the primary resident's `person_id`.
  - **Seed Loading & Reset:** Loaded via `env.load_seed` (`schemas/seed.schema.json`). Calling `env.reset` deterministically restores the household to the loaded seed state (`reset_scope: app_instance`), leaving other platform apps unaffected.
  - **Audit & Actor Identity:** Changes initiated by residents arrive as Infra events with `actor_person_id` and are logged in Hearth's internal history ledger.

- **Events and notifications (required):**
  External circumstances enter via Core's `env.apply_event`:

  *Example Injected Event (`hearth.appliance_breakdown`):*
  ```json
  {
    "event_id": "evt_appliance_20261118_01",
    "at": "2026-11-18T14:30:00+01:00",
    "operation": "hearth.inject_breakdown",
    "payload": {
      "item_id": "appliance_refrigerator_kitchen",
      "fault_type": "compressor_failure",
      "severity": "critical",
      "reported_by_person_id": "person_resident_02"
    }
  }
  ```
  *Effect:* Sets refrigerator condition to `broken` and opens a new issue in `hearth.list_maintenance_issues` with status `reported`.

  *Example Approval Response Event (`hearth.purchase_approval`):*
  ```json
  {
    "event_id": "evt_appr_20261118_02",
    "at": "2026-11-18T16:00:00+01:00",
    "operation": "hearth.process_approval",
    "payload": {
      "purchase_id": "purch_futon_09",
      "decision": "approved",
      "decided_by_person_id": "person_resident_01"
    }
  }
  ```
  *Effect:* Transitions purchase status to `approved`, deducts cost from household budget, and appends the new item into the room's inventory.

  *Time Rules:*
  - App state advances strictly with `ctx.virtual_now` or incoming event `at` timestamps.
  - Appliance warranties and overdue maintenance are evaluated lazily on read. An appliance whose warranty expiration date precedes `ctx.virtual_now` returns `warranty_status: "expired"`.

- **Shared data and dependencies (required):**
  - Residents and contacts are bound to platform `person_id`.
  - Document attachments (receipts, lease agreements, floor plans) store foreign `file_id` pointers to `apps/files`.
  - Standalone package statement: Hearth operates with only the shared runtime (Runtime 1.6.0) and declared dependencies.

## 4. Construction plan and effort

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Household Engine & Data Model | Implement Core storage engine, JSON seed loader, schema validation, and Core Infra handlers (`env.load_seed`, `env.reset`, `env.snapshot`, `env.apply_event`). | Standalone engine passing `npm run app:verify -- --app apps/hearth`. | 4–6 |
| Agent MCP Tools | Implement `tools.json` definitions and handlers for rooms, inventory placement, maintenance issues, resident profiles, and purchase approvals. Enforce optimistic locking (`expected_version`). | Unit tests verifying optimistic concurrency conflicts (`stale_version`) and idempotent retries (`request_id`). | 4–5 |
| Synthetic Household Fixtures | Build 3 distinct household seed fixtures (e.g., shared rental apartment, family suburban house, multi-tenant flat) with 30–60 inventory items, dimensioned floor plans, and repair histories. | Fixture validation verifying referential integrity (item-to-room, person-to-preference). | 3–5 |
| Web Dashboard (GUI) | Responsive GUI in `gui/` hosted on public business Web Host (`runtime/web/`) visualizing floor plans, room items, maintenance status, and budget ledgers using the same MCP tools. | Verified UI flows rendering stored state accurately without client-side state drift. | 4–6 |
| Verification & Integration | Comprehensive automated verification suite (`npm run app:verify`), event replay integration, and end-to-end trace validation with Task #30. | Fully green public-runtime verification suite; deterministic reset verified. | 3–4 |

- **Milestones, owners and dependencies (required):**
  - **Milestone 1 (Days 1–5):** Data schemas, seed loader, and core storage engine.
  - **Milestone 2 (Days 6–10):** Agent MCP tools and event handlers; verified with `npm run app:verify`.
  - **Milestone 3 (Days 11–15):** Synthetic household seed fixtures and floor plan coordinates.
  - **Milestone 4 (Days 16–20):** GUI dashboard and integration validation with Task #30.
  - *Owner:* Nassim (@nassimberrada) as sole author/developer across all milestones.
  - *Platform Dependencies:* Pinned to Runtime 1.6.0 and Core API 1.2.0.
  - *Related PR Connections:* 
    - **PR #86 (Brightwire Home):** Live smart-home telemetry and device automation are left to #86; Hearth references appliances only by physical inventory ID.
    - **PR #5 (Home Repair Slots):** Handyman dispatch and booking are left to #5; Hearth tracks internal issue status.
    - **PR #39 (Lintel):** Tenancy agreements and landlord contracts are left to #39.
    - **PR #33 (Personal Records):** Financial receipts and document archiving are left to #33 and `apps/files`.
- **Resources and total effort (required):**
  - Estimated effort: **18–26 person-days** (sequenced for a single contributor over ~4 calendar weeks; reduced from 27–39 days by eliminating duplicate mail/calendar/contacts implementations).
  - Local execution on Node.js 18+; no hosted databases, paid APIs, or smart-home hardware required.
- **Scope boundary and open questions (required):**
  - *In scope:* 2D room layouts, furniture inventory dimensions, maintenance tracking, resident preference retrieval, and purchase approvals.
  - *Out of scope:* Real-time 3D CAD rendering, physical smart-home device control, live financial payments, and direct contractor scheduling.
  - *Open questions resolved:* Geometry is represented as 2D coordinate bounding boxes $[x, y, w, l]$ with PNG floor plans; approval flows are modeled via explicit resident Infra events.
- **License and external dependencies (required):**
  - MIT license. 100% synthetic fixture generation. Image assets use openly licensed photography (CC0/Unsplash) with recorded source metadata in `assets.catalog.json`.

### First-Version Workflows, State Transitions & Failure Paths

| Workflow | Entities & States | MCP Tools | Success Example | Error / Rejection Example | Confirm / Cancel Paths |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Furniture Placement** | Inventory item: `active` → `stored` → `disposed` | `hearth.update_item_placement`, `hearth.dispose_item` | Moving desk to Bedroom 2 updates coordinates to `[120, 240]` and increments record version. | Attempting to move an item with status `disposed` returns `error_code: "item_already_disposed"`. | Relocating back restores prior coordinates. |
| **2. Maintenance Tracking** | Maintenance issue: `reported` → `scheduled` → `resolved` | `hearth.report_maintenance_issue`, `hearth.resolve_maintenance_issue` | Reporting leak in Bathroom creates issue `iss_01` with status `reported`. | Resolving an already `resolved` issue returns `error_code: "issue_already_closed"`. | Resident can close issue without repair as `cancelled`. |
| **3. Purchase Approval** | Purchase request: `pending_approval` → `approved` / `denied` / `expired` | `hearth.request_purchase`, `hearth.cancel_purchase` | Agent requests $120 mattress; returns `status: "pending_approval"`. Approval event transitions to `approved` and deducts $120 from budget. | Agent requests purchase exceeding remaining household cap; returns `error_code: "budget_exceeded"`. | Agent can call `cancel_purchase` while in `pending_approval`. |
| **4. Resident Profile Audit** | Resident record (`active`) | `hearth.get_resident_profile` | Agent queries `person_resident_01`; receives heirloom restriction on grandfather's armchair. | Querying invalid `person_id` returns `error_code: "resident_not_found"`. | Read-only; cancel not applicable. |