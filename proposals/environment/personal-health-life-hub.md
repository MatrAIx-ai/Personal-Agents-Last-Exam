# Personal Health & Life Hub

**Title:** `[Environment Proposal] [Fitness & wellbeing + Health & care] Personal Health & Life Hub`

**Proposed file:** `proposals/environment/personal-health-life-hub.md`

## 1. App and domains

- **Authors / GitHub handles (required):** Nassim (@nassimberrada)
- **Reference app or website / URL (required):** Apple Health ([apple.com/health](https://www.apple.com/health/)) and Whoop/Oura companion platforms. The environment is an original simulated application focused on wearable biometrics, recovery, workouts, habits, and routine templates.
- **Primary domain (required):** Fitness & wellbeing
- **Secondary domains (optional):** Health & care

## 2. What you plan to build

Personal Health & Life Hub is a simulated personal health, recovery, and fitness platform. It provides an agent-accessible repository for wearable sensor data (sleep architecture, resting heart rate, HRV, daily strain, step counts), workout logging, personal wellness goals, and recurring routine templates.

Rather than duplicating general productivity apps (which are handled by dedicated platform apps), the Hub acts as the specialized system of record for personal physical wellbeing and physical routine structures. It enables personal agents to inspect biometric trends, correlate physical recovery with planned activities, update workout logs, track habit completions, and manage wellness goals.

The Hub package is completely standalone and runs on the shared runtime (Runtime 1.6.0 / Core API 1.2.0) with zero external network dependencies.

### Core Workflows (Version 1)

1. **Biometric & Recovery Inspection (Read-Only):**
   - The agent inspects historical sleep metrics, resting heart rate (RHR), heart rate variability (HRV), and daily exertion/strain scores over a requested date range to evaluate physical readiness.
   - *Checkable outcome:* Agent returns accurate recovery summaries or detects data gaps without hallucinating values.
2. **Workout Lifecycle Management (Read/Write):**
   - Workouts originate either from seed fixtures (as `planned` sessions) or are dynamically planned/logged by the agent. The agent transitions workouts across states: `planned` → `completed`, `skipped`, or `cancelled`.
   - *Checkable outcome:* Workout records persist in the Hub store with sport type, duration, perceived exertion, and average heart rate.
3. **Habit & Wellness Goal Tracking (Read/Write):**
   - The agent inspects, creates, and updates target wellness metrics (e.g., daily hydration, minimum sleep duration, weekly cardio targets).
   - *Checkable outcome:* Goals progress through states (`active` → `achieved`, `missed`, `abandoned`).
4. **Routine Template Lifecycle Management (Read/Write):**
   - The agent creates, inspects, updates, activates, and archives reusable routine templates (e.g., "Monday Morning Strength Window", "Post-Work Decompression Routine"). Note: Concrete scheduling into specific calendar slots is executed via Calendar 1.3.0.
   - *Checkable outcome:* Routine records progress through states (`draft` → `active` → `archived`), updating component blocks and record versions.

## 3. Potential app connections

The Hub does not store or shadow records owned by other apps. The Agent calls separate apps directly via their respective MCP tools:

- **Calendar 1.3.0 (`examples/apps/calendar` - Required for scheduling workflows):**
  - Direct Agent tools: `calendar.freebusy`, `calendar.list`, `calendar.create`, `calendar.update`.
  - *Usage:* When a Hub routine template is scheduled into a concrete time slot, the agent calls `calendar.create`. The Hub only stores recurring templates, not calendar events.
- **Tasks 1.0.0 (`apps/tasks` - Required for action-item tracking):**
  - Direct Agent tools: `tasks.list`, `tasks.create`, `tasks.transition`.
  - *Usage:* Actionable health to-dos (e.g., "buy new running shoes") are created in Tasks by the agent.
- **Notes 1.0.0 (`apps/notes` - Optional):**
  - Direct Agent tools: `notes.list`, `notes.create`.
  - *Usage:* Long-form workout reflections or doctor notes are stored directly in Notes.
- **Mail 1.3.0 (`examples/apps/mail` - Optional) & Messages 1.0.0 (`apps/messages` - Optional):**
  - Direct Agent tools: `mail.search`, `messages.list`.
  - *Usage:* The agent inspects external context or notifies the user via standard chat/mail channels.
- **External Specialized Domains (Deferred):**
  - Clinical healthcare records are deferred to PR #14 (Northlake Patient Portal).
  - Weather tracking is deferred to PR #123 (Rainshadow) / PR #126 (Gustline).
  - Class bookings are deferred to PR #15 (Cadence).

### Integration details

- **Operations and access (required):**
  The Hub provides an agent-facing MCP interface in `tools.json`. App ID is `health-hub`. All tools are prefixed with `health-hub.`. All write operations require `request_id` (string) and Core's version object `expected_version: { epoch: number, revision: number }` for optimistic concurrency.

  *Agent MCP Tools:*
  - `health-hub.get_daily_summary(date: string) -> DailySummary` (Read-only)
  - `health-hub.list_metrics(metric_type: string, start_date: string, end_date: string) -> MetricSeries` (Read-only)
  - `health-hub.list_workouts(start_date: string, end_date: string, status?: string) -> WorkoutList` (Read-only)
  - `health-hub.plan_workout(workout_data: WorkoutPlanInput, expected_version: VersionObj, request_id: string) -> WorkoutRecord` (Write: creates workout in `planned` state)
  - `health-hub.log_workout(workout_data: WorkoutLogInput, expected_version: VersionObj, request_id: string) -> WorkoutRecord` (Write: creates workout directly as `completed`)
  - `health-hub.update_workout(workout_id: string, status: string, expected_version: VersionObj, request_id: string) -> WorkoutRecord` (Write: transitions status to `completed`, `skipped`, or `cancelled`)
  - `health-hub.list_goals(status?: string) -> GoalList` (Read-only)
  - `health-hub.create_goal(goal_data: GoalInput, expected_version: VersionObj, request_id: string) -> GoalRecord` (Write: creates goal in `active` state)
  - `health-hub.update_goal(goal_id: string, status: string, expected_version: VersionObj, request_id: string) -> GoalRecord` (Write: transitions status to `achieved`, `missed`, or `abandoned`)
  - `health-hub.list_routine_templates(status?: string) -> RoutineList` (Read-only)
  - `health-hub.create_routine_template(template_data: RoutineInput, expected_version: VersionObj, request_id: string) -> RoutineRecord` (Write: creates template in `draft` state)
  - `health-hub.update_routine_template(routine_id: string, blocks?: BlockList, status?: string, expected_version: VersionObj, request_id: string) -> RoutineRecord` (Write: updates blocks or transitions status between `draft`, `active`, and `archived`)
  - `health-hub.list_notifications() -> NotificationList` (Read-only)

  *Platform Plugin Hooks (Core-Managed Infra):*
  The Hub does not implement its own storage engine, snapshotting, or reset server. Instead, it exposes the standard App plugin hooks (`validateSeed`, `handleTool`, `applyEvent`, `init`) invoked by Core. Core handles persistence, snapshots, version checks, and the separate Infra operations (`env.load_seed`, `env.reset`, `env.snapshot`, `env.apply_event`).

- **State and lifecycle (required):**
  - Single-account architecture: One user account per instance (`account_id` bound to the run's `person_id`).
  - Fixtures are loaded via `env.load_seed` adhering to `schemas/seed.schema.json`.
  - State isolation: Reset (`env.reset`) restores Hub records to the initial baseline without modifying other apps (`reset_scope: app_instance`).
  - Writes return Core's updated `{ epoch, revision }` version object. Re-submitting the same `request_id` is idempotent.

- **Events and notifications (required):**
  Events represent incoming asynchronous wearable data ingested via Core's `env.apply_event`.

  *Example Injected Event (`health-hub.ingest_daily_sync`):*
  ```json
  {
    "event_id": "evt_sync_20261118_01",
    "at": "2026-11-18T06:30:00+01:00",
    "operation": "health-hub.ingest_daily_sync",
    "payload": {
      "date": "2026-11-17",
      "sleep": {
        "duration_minutes": 442,
        "deep_sleep_minutes": 85,
        "rem_sleep_minutes": 102,
        "sleep_score": 81
      },
      "recovery": {
        "resting_hr": 54,
        "hrv_rmssd": 62,
        "recovery_score": 78
      },
      "day_strain": 14.2
    }
  }
  ```

  *Time Rules & Notification:*
  - In Core, read operations are strictly side-effect-free; any read that attempts to mutate data is rejected.
  - Therefore, notifications (such as "missed habit", "low recovery alert", or "routine conflict") are **persisted to the internal ledger strictly during write operations or event applications** (such as when `health-hub.ingest_daily_sync` arrives or when a workout is updated).
  - During reads (`health-hub.list_notifications`), the Hub returns existing ledger entries and may dynamically project derived statuses against `ctx.virtual_now` without modifying stored records.

- **Shared data and dependencies (required):**
  - People are referenced strictly by `person_id`. External entities are referenced by ID (e.g., `linked_calendar_event_id`).
  - Standalone package statement: The package operates with only the shared runtime (Runtime 1.6.0) and its declared dependencies.

- **Health Record Granularity & Gap Representation:**
  - *Granularity:* Daily aggregates for sleep, resting heart rate, HRV, and strain. Discrete records for planned and logged workouts.
  - *Dating Policy:* All seeded historical data is dated **on or after 2026-01-01**.
  - *Data Gaps (Explicit Missing Days):*
    Days where the tracker was uncharged or not worn return explicit `no_data` objects:
    ```json
    {
      "date": "2026-10-14",
      "status": "no_data",
      "reason": "device_not_worn",
      "metrics": null
    }
    ```
    This allows tasks like Task #117 to directly verify that agents distinguish between zero values and missing data.
  - *Generation:* Synthetic profiles are generated deterministically using seeded scripts.

## 4. Construction plan and effort

**Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Core Hub Plugin Hooks & Schemas | Implement Hub schemas (`seed.schema.json`, `events.schema.json`, `tools.json`) and App plugin hooks (`validateSeed`, `handleTool`, `applyEvent`, `init`). | Standalone package passing `npm run app:verify -- --app apps/health-hub`. | 2–3 |
| Agent MCP Tools Implementation | Implement all 13 `health-hub.*` tool handlers with optimistic locking on `{ epoch, revision }` and idempotent `request_id` handling. | Automated tool tests verifying CRUD workflows, state transitions, and `stale_version` rejection. | 4–5 |
| Synthetic Data & Generator | Deterministic generator for 5 fictional user personas dated on or after 2026-01-01, including explicit `no_data` gap days. | Schema-validated fixtures satisfying physiological bounds and gap structures. | 3–4 |
| Web Dashboard (GUI) | Responsive GUI in `gui/` hosted on public business Web Host (`runtime/web/`) using the same `health-hub.*` MCP tools. | Verified browser rendering of sleep, recovery, workouts, and templates matching state. | 4–5 |
| Verification & Task Integration | Run public runtime test suite (`npm run app:verify`), verify snapshot/reset determinism, and run end-to-end integration trace with Task #117. | Fully green test suite; verified trace logs with Task #117. | 2–3 |

- **Milestones, owners and dependencies (required):**
  - **Milestone 1 (Days 1–5):** App plugin hooks, schema definitions, and seed loader.
  - **Milestone 2 (Days 6–10) — [FIRST RUNNABLE VERSION]:** Complete implementation of `health-hub.*` MCP tools, event handler (`health-hub.ingest_daily_sync`), and baseline fixtures passing `npm run app:verify`. **This milestone will be submitted within 14 calendar days of plan approval.**
  - **Milestone 3 (Days 11–14):** Full synthetic dataset generation with 2026-01-01+ timestamps and explicit gap modeling.
  - **Milestone 4 (Days 15–18):** GUI dashboard in `gui/` and trace validation with Task #117.
  - *Owner:* Nassim (@nassimberrada).
  - *Platform Dependencies:* Pinned to Runtime 1.6.0 and Core API 1.2.0.
  - *Related PR Connections:* 
    - **Task #117:** Hub supplies the daily sleep and strain feed with explicit missing-day gaps.
    - **Task #29:** Uses standalone Calendar and Tasks apps; does not depend on Hub biometrics.
    - **PR #14, PR #15, PR #123:** External clinical, booking, and weather sources remain out of scope and deferred to those apps.
- **Resources and total effort (required):**
  - Estimated effort: **15–20 person-days** (further reduced as Core provides storage, reset, and lifecycle management).
  - Local execution on Node.js 18+; no external services or paid APIs required.
- **Scope boundary and open questions (required):**
  - *In scope:* Wearable biometrics (sleep, recovery, strain), workout logging/planning, wellness goals, routine templates, and explicit gap reporting.
  - *Out of scope:* Clinical medical diagnosis, live wearable syncing, and duplication of platform Calendar/Tasks/Mail.
- **License and external dependencies (required):**
  - MIT / repository standard license. 100% synthetic data generated deterministically. No external network dependencies.

### First-Version Workflows, State Transitions & Failure Paths

| Workflow | Entities & States | MCP Tools | Success Example | Error / Rejection Example | Confirm / Cancel Paths |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Biometric Read** | Daily recovery summary (`valid` or `no_data`) | `health-hub.get_daily_summary`, `health-hub.list_metrics` | Agent requests summary for `2026-11-17`; receives sleep score (81) and HRV (62). | Query for unseeded future date returns `error_code: "date_out_of_range"`. | Read-only; cancel not applicable. |
| **2. Workout Lifecycle** | Workout record: `planned` → `completed`, `skipped`, or `cancelled` | `health-hub.plan_workout`, `health-hub.log_workout`, `health-hub.update_workout` | Agent plans a run via `health-hub.plan_workout` (state: `planned`), or updates a seeded planned workout to `completed`. | Update submitted with stale `expected_version: { epoch: 1, revision: 1 }` when record is at revision 2 returns `error_code: "stale_version"`. | Agent can transition status to `cancelled` upon user request. |
| **3. Goal Lifecycle** | Goal record: `active` → `achieved`, `missed`, `abandoned` | `health-hub.create_goal`, `health-hub.update_goal`, `health-hub.list_goals` | Agent creates goal "Sleep $\ge 8$ hrs". Stored with `status: "active"` and version `{ epoch: 1, revision: 1 }`. | Agent submits negative duration target; rejected with `error_code: "invalid_target_value"`. | Agent can transition goal to `abandoned`. |
| **4. Routine Template Lifecycle** | Routine template: `draft` → `active` → `archived` | `health-hub.create_routine_template`, `health-hub.update_routine_template`, `health-hub.list_routine_templates` | Agent creates template (status: `draft`), then calls `health-hub.update_routine_template` with `status: "active"`. | Stale `{ epoch, revision }` supplied on update returns `stale_version`; stored template remains unchanged. | Transitioning status to `archived` deactivates template without deleting history. |