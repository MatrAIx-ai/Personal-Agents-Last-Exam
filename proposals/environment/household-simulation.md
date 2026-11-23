# Environment Track Proposal: Hearth — Household Simulation

**Title:** `[Environment Proposal] [Home & utilities + Shopping & groceries] Hearth`

**Proposed file:** `proposals/environment/household-simulation.md`

## 1. App and domains

- **Authors / GitHub handles (required):** Nassim (@nassimberrada)
- **Reference app or website / URL (required):** Home Assistant ([home-assistant.io](https://www.home-assistant.io/)) as a conceptual reference for household entity modeling. Hearth is an independent simulation focused on physical space, furniture inventories, maintenance lifecycles, and resident resource sharing.
- **Primary domain (required):** Home & utilities
- **Secondary domains (optional):** Shopping & groceries

## 2. What you plan to build

Hearth is a persistent household simulation environment where personal agents manage a home, its physical spaces, belongings, maintenance needs, and resident constraints across long-horizon scenarios.

Rather than duplicating productivity apps or simulating smart-home device protocols, Hearth models the home’s physical reality: property dimensions, 2D room coordinates, furniture inventories with clearances, appliance conditions, maintenance histories, and shared resident preferences. It serves as the household system of record for tasks like spatial re-organization, moving, appliance repair coordination, and shared expense/inventory management.

The Hearth package is completely self-contained and runs on the shared runtime (Runtime 1.6.0 / Core API 1.2.0) with zero external network dependencies.

### Core Workflows (Version 1)

1. **Spatial & Furniture Inventory Management (Read/Write):**
   - The agent inspects room dimensions, architectural obstacles (door swings, windows), and furniture dimensions ($L \times W \times H$, clearance requirements), updates furniture placements within rooms, moves items to storage, or records disposal (`active` → `stored` → `disposed`).
   - *Checkable outcome:* Object records reflect updated room placements, storage coordinates, and disposition histories.
2. **Maintenance & Repair Lifecycle (Read/Write):**
   - The agent tracks appliance warranties, schedules repairs, or resolves household faults (`reported` → `scheduled` → `resolved`, or cancelled by resident).
   - *Checkable outcome:* Appliance condition records update from `degraded`/`broken` to `operational` with attached repair cost entries.
3. **Purchasing with Resident Approval (Read/Write):**
   - The agent proposes household purchases. Purchases enter a structured approval flow (`pending_approval` → `approved`, `denied`, or `expired`).
   - *Checkable outcome:* Upon approval event from a resident, inventory adds the item and household budget balances decrement atomically. If unapproved past the expiration window, the request expires with no budget or inventory change.
4. **Resident Profile & Shared Preference Auditing (Read-Only):**
   - The agent retrieves resident spatial preferences, accessibility rules, and heirloom constraints bound to platform `person_id`s.
   - *Checkable outcome:* Agent retrieves confirmed constraints without hallucination.

## 3. Potential app connections

Hearth does not simulate or copy existing platform apps. External interactions are handled via direct Agent calls to merged apps:

- **Calendar 1.3.0 (`examples/apps/calendar` - Required for appointments):**
  - Direct Agent tools: `calendar.list`, `calendar.freebusy`, `calendar.create`, `calendar.update`.
  - *Usage:* Maintenance service visits and moving appointments are created as calendar events in Calendar. Hearth maintains internal appliance repair histories and chore schedules, referencing Calendar events solely by foreign ID where applicable.
- **Contacts 1.0.0 (`apps/contacts` - Required for people):**
  - Direct Agent tools: `contacts.list`, `contacts.get`.
  - *Usage:* Landlords, plumbers, and household members are resolved through Contacts. Hearth references them strictly by platform `person_id`.
- **Files 1.0.0 (`apps/files` - Optional for documents):**
  - Direct Agent tools: `files.read`, `files.put`.
  - *Usage:* PDF lease documents, appliance user manuals, and warranty receipts are stored in Files; Hearth holds the foreign `file_id`.
- **Tasks 1.0.0 (`apps/tasks` - Optional for chore assignments):**
  - Direct Agent tools: `tasks.create`, `tasks.transition`.
  - *Usage:* Individual chore to-do items assigned to specific residents are pushed to Tasks.
- **Messaging:** 
  - The agent interacts with residents directly through standard chat/task channels (`apps/messages`) or inspects Hearth's internal activity log.

### Integration details

- **Operations and access (required):**
  Hearth exposes an Agent-facing MCP interface in `tools.json`. All mutating tools require `request_id` (idempotency) and `expected_version` as Core's `{epoch: int, revision: int}` object for optimistic locking:
  
  *Agent MCP Tools:*
  - `hearth.get_property() -> PropertyDetails` (Read-only: address, floor plan metadata, rooms list)
  - `hearth.get_room(room_id: string) -> RoomDetails` (Read-only: dimensions, door/window boundaries, current objects)
  - `hearth.list_inventory(room_id?: string, category?: string, status?: string) -> InventoryList` (Read-only)
  - `hearth.update_item_placement(item_id: string, room_id: string, coordinates: [int, int], expected_version: VersionObject, request_id: string) -> ItemRecord` (Write: moves item within active living spaces)
  - `hearth.store_item(item_id: string, storage_room_id: string, expected_version: VersionObject, request_id: string) -> ItemRecord` (Write: transitions item from `active` → `stored`)
  - `hearth.dispose_item(item_id: string, reason: string, expected_version: VersionObject, request_id: string) -> ItemRecord` (Write: transitions item to `disposed`)
  - `hearth.request_purchase(purchase_data: PurchaseInput, expected_version: VersionObject, request_id: string) -> PurchaseRecord` (Write: creates purchase in `pending_approval` with a 48-hour `expires_at` timestamp)
  - `hearth.cancel_purchase(purchase_id: string, expected_version: VersionObject, request_id: string) -> PurchaseRecord` (Write: cancels pending request)
  - `hearth.list_maintenance_issues(status?: string) -> IssueList` (Read-only)
  - `hearth.report_maintenance_issue(issue_data: IssueInput, expected_version: VersionObject, request_id: string) -> IssueRecord` (Write: opens issue in `reported`)
  - `hearth.schedule_maintenance(issue_id: string, scheduled_date: string, service_contact_id: string, expected_version: VersionObject, request_id: string) -> IssueRecord` (Write: transitions issue from `reported` → `scheduled`)
  - `hearth.resolve_maintenance_issue(issue_id: string, resolution_notes: string, cost_usd: float, expected_version: VersionObject, request_id: string) -> IssueRecord` (Write: transitions issue to `resolved`)
  - `hearth.get_resident_profile(person_id: string) -> ResidentProfile` (Read-only)

  *Platform Infra Operations:*
  `env.load_seed`, `env.reset`, `env.snapshot`, and `env.apply_event` are Core-managed infrastructure operations served on a separate connection inaccessible to the Agent.

- **State and lifecycle (required):**
  - **Single Account per Instance:** One Hearth instance represents exactly one household property identified by `account_id` and owned by the primary resident's `person_id`.
  - **Seed Loading & Reset:** Loaded via `env.load_seed` (`schemas/seed.schema.json`). Calling `env.reset` deterministically restores the household to the loaded seed baseline (`reset_scope: app_instance`).
  - **Audit & Actor Identity:** Changes initiated by residents arrive as Infra events with `actor_person_id` and are logged in Hearth's internal history ledger.

- **Events and notifications (required):**
  External circumstances enter via Core's `env.apply_event`:

  *Example Injected Event 1 (`hearth.appliance_breakdown`):*
  ```json
  {
    "event_id": "evt_appliance_20261118_01",
    "at": "2026-11-18T14:30:00+01:00",
    "operation": "hearth.appliance_breakdown",
    "payload": {
      "item_id": "appliance_refrigerator_kitchen",
      "fault_type": "compressor_failure",
      "severity": "critical",
      "reported_by_person_id": "person_resident_02"
    }
  }
  ```
  *Effect:* Sets refrigerator condition to `broken` and opens a new issue in `hearth.list_maintenance_issues` with status `reported`.

  *Example Injected Event 2 (`hearth.cancel_maintenance_issue`):*
  ```json
  {
    "event_id": "evt_maint_cancel_20261118_02",
    "at": "2026-11-18T15:00:00+01:00",
    "operation": "hearth.cancel_maintenance_issue",
    "payload": {
      "issue_id": "iss_bathroom_leak_01",
      "reason": "False alarm; resident tightened valve manually",
      "cancelled_by_person_id": "person_resident_01"
    }
  }
  ```
  *Effect:* Transitions the maintenance issue from `reported` or `scheduled` to `cancelled`.

  *Example Injected Event 3 (`hearth.purchase_approval`):*
  ```json
  {
    "event_id": "evt_appr_20261118_03",
    "at": "2026-11-18T16:00:00+01:00",
    "operation": "hearth.purchase_approval",
    "payload": {
      "purchase_id": "purch_futon_09",
      "decision": "approved",
      "decided_by_person_id": "person_resident_01"
    }
  }
  ```
  *Effect:* Transitions purchase status to `approved`, deducts cost from household budget, and appends the item to the room's inventory with status `active`.

  *Time Rules & Purchase Expiration:*
  - App state advances strictly with `ctx.virtual_now` or incoming event `at` timestamps.
  - Purchases remain in `pending_approval` until an approval event arrives. If no event arrives and `ctx.virtual_now` advances past `expires_at` (default: 48 virtual hours after creation), any subsequent read dynamically derives and records its status as `expired`. The pending funds reservation is released, and inventory remains untouched.
  - Appliance warranties are evaluated lazily against `ctx.virtual_now`. If the warranty expiration date precedes `ctx.virtual_now`, `warranty_status` returns `expired`.

- **Shared data and dependencies (required):**
  - Residents and contacts are bound to platform `person_id`.
  - Document attachments store foreign `file_id` pointers to `apps/files`.
  - Standalone package statement: Hearth operates with only the shared runtime (Runtime 1.6.0) and declared dependencies.

## 4. Construction plan and effort

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Plugin Hooks & Schema Validation | Implement App plugin interface (`validateSeed`, `handleTool`, `applyEvent`, and schema checkers). Core manages underlying storage, persistence, snapshots, and `env.*` operations. | Standalone App module passing Core plugin lifecycle tests. | 2–3 |
| Agent MCP Tools | Implement `tools.json` definitions and handlers for rooms, inventory placement, maintenance issues, resident profiles, and purchase approvals. Enforce `{epoch, revision}` optimistic locking. | Unit tests verifying optimistic concurrency conflicts (`stale_version`) and idempotent retries (`request_id`). | 4–5 |
| Synthetic Household Fixtures | Build 3 distinct household seed fixtures (rental apartment, family house, shared flat) dated from **2026-01-01 onward**, with 30–60 items, 2D floor plans, and repair histories. | Fixture validation verifying referential integrity (item-to-room, person-to-preference). | 3–5 |
| Web Dashboard (GUI) | Responsive GUI in `gui/` hosted on public business Web Host (`runtime/web/`) visualizing floor plans, room items, maintenance status, and budget ledgers using the same MCP tools. | Verified UI flows rendering stored state accurately without client-side state drift. | 4–5 |
| Verification & Integration | Comprehensive automated verification suite (`npm run app:verify -- --app apps/hearth`), event replay integration, and end-to-end trace validation. | Fully green public-runtime verification suite; deterministic reset verified. | 2–3 |

- **Milestones, owners and dependencies (required):**
  - **Milestone 1 (Days 1–3):** Plugin hooks (`validateSeed`, `handleTool`, `applyEvent`) and schema definitions.
  - **Milestone 2 (Days 4–8 - First Runnable Version):** Complete Agent MCP tools with `{epoch, revision}` versioning and event handlers. Passes `npm run app:verify -- --app apps/hearth`. **Submitted within 14 calendar days of plan approval.**
  - **Milestone 3 (Days 9–13):** Seed fixtures dated $\ge \text{2026-01-01}$, 2D coordinate layouts, and repair histories.
  - **Milestone 4 (Days 14–18):** Web GUI dashboard and end-to-end integration validation.
  - *Owner:* Nassim (@nassimberrada) as sole author/developer across all milestones.
  - *Platform Dependencies:* Pinned to Runtime 1.6.0 and Core API 1.2.0.
  - *Related PR Connections:* 
    - **PR #86 (Brightwire Home):** Smart-home device automation is left to #86; Hearth references appliances only by physical inventory ID.
    - **PR #5 (Home Repair Slots):** Handyman dispatch and booking are left to #5; Hearth tracks internal issue status.
    - **PR #39 (Lintel):** Tenancy agreements and landlord contracts are left to #39.
    - **PR #33 (Personal Records):** Financial receipts and document archiving are left to #33 and `apps/files`.
- **Resources and total effort (required):**
  - Estimated total effort: **15–21 person-days** (down from 18–26 days to reflect Core handling persistence and removal of Mail messaging).
  - Local execution on Node.js 18+; no external services or paid APIs required.
- **Scope boundary and open questions (required):**
  - *In scope:* 2D room layouts, furniture inventory dimensions, maintenance tracking, resident preference retrieval, and purchase approvals.
  - *Out of scope:* Real-time 3D CAD rendering, physical smart-home device control, live financial payments, direct contractor scheduling, and email dispatch.
- **License and external dependencies (required):**
  - MIT license. 100% synthetic fixture generation. Visual assets use CC0 (Public Domain) photography or script-drawn 2D vector layouts converted to PNG. No Unsplash-licensed assets are used.

### First-Version Workflows, State Transitions & Failure Paths

| Workflow | Entities & States | MCP Tools / Events | Success Example | Error / Rejection Example | Confirm / Cancel Paths |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Furniture Placement & Storage** | Inventory item: `active` → `stored` → `disposed` | `hearth.update_item_placement`, `hearth.store_item`, `hearth.dispose_item` | Moving chair to basement storage via `hearth.store_item` sets status to `stored` and increments revision. | Moving an item with status `disposed` returns `error_code: "item_already_disposed"`. | Calling `hearth.update_item_placement` moves an item back to an active room (`stored` → `active`). |
| **2. Maintenance Tracking** | Maintenance issue: `reported` → `scheduled` → `resolved`, or `cancelled` | `hearth.report_maintenance_issue`, `hearth.schedule_maintenance`, `hearth.resolve_maintenance_issue`, event `hearth.cancel_maintenance_issue` | Scheduling technician via `hearth.schedule_maintenance` transitions issue from `reported` → `scheduled`. Resident cancellation event transitions issue to `cancelled`. | Resolving an already `resolved` or `cancelled` issue returns `error_code: "invalid_issue_state"`. | Resident sends `hearth.cancel_maintenance_issue` event to cancel. |
| **3. Purchase Approval** | Purchase request: `pending_approval` → `approved`, `denied`, or `expired` | `hearth.request_purchase`, `hearth.cancel_purchase`, event `hearth.purchase_approval` | Agent requests mattress; returns `status: "pending_approval"`. Approval event transitions to `approved`, deducts cost, and adds item. Unanswered request past 48h transitions to `expired`. | Request submitted with stale `{epoch, revision}` returns `error_code: "stale_version"`. | Agent can call `hearth.cancel_purchase` while in `pending_approval`. |
| **4. Resident Profile Audit** | Resident record (`active`) | `hearth.get_resident_profile` | Agent queries `person_resident_01`; receives heirloom restriction on grandfather's armchair. | Querying invalid `person_id` returns `error_code: "resident_not_found"`. | Read-only; cancel not applicable. |