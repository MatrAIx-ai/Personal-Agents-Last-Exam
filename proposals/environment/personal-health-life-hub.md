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
   - The agent logs completed workouts or transitions planned workouts across states (`planned` → `completed`, `skipped`, or `cancelled`).
   - *Checkable outcome:* Workout records persist in the Hub store with sport type, duration, perceived exertion, and average heart rate.
3. **Habit & Wellness Goal Tracking (Read/Write):**
   - The agent inspects and updates target wellness metrics (e.g., daily hydration, minimum sleep duration, weekly cardio targets).
   - *Checkable outcome:* Goals progress through states (`active` → `achieved`, `missed`, `abandoned`).
4. **Routine Template Definition (Read/Write):**
   - The agent inspects and modifies reusable weekly routine templates (e.g., "Monday Morning Strength Window", "Post-Work Decompression Routine"). Note: Concrete schedule placement is delegated to Calendar 1.3.0.
   - *Checkable outcome:* Stored routine template records update their component blocks and version counters.

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
  The Hub provides an agent-facing MCP interface in `tools.json` consisting strictly of verbs on Hub-owned entities. All write tools require `request_id` and `expected_version` for optimistic concurrency.
  
  *Agent MCP Tools:*
  - `health_hub.get_daily_summary(date: string) -> DailySummary` (Read-only)
  - `health_hub.list_metrics(metric_type: string, start_date: string, end_date: string) -> MetricSeries` (Read-only)
  - `health_hub.list_workouts(start_date: string, end_date: string, status?: string) -> WorkoutList` (Read-only)
  - `health_hub.log_workout(workout_data: WorkoutInput, request_id: string) -> WorkoutRecord` (Write)
  - `health_hub.update_workout(workout_id: string, status: string, expected_version: int, request_id: string) -> WorkoutRecord` (Write)
  - `health_hub.list_goals(status?: string) -> GoalList` (Read-only)
  - `health_hub.create_goal(goal_data: GoalInput, request_id: string) -> GoalRecord` (Write)
  - `health_hub.update_goal(goal_id: string, status: string, expected_version: int, request_id: string) -> GoalRecord` (Write)
  - `health_hub.get_routine_template(routine_id: string) -> RoutineRecord` (Read-only)
  - `health_hub.update_routine_template(routine_id: string, blocks: BlockList, expected_version: int, request_id: string) -> RoutineRecord` (Write)
  - `health_hub.list_notifications() -> NotificationList` (Read-only)

  *Platform Infra Operations:*
  Platform operations (`env.load_seed`, `env.reset`, `env.snapshot`, `env.apply_event`) are Core-managed infrastructure operations served on a separate connection inaccessible to the Agent.

- **State and lifecycle (required):**
  - Single-account architecture: Each instance manages exactly one user account identified by `account_id` bound to the run's `person_id`.
  - Fixtures are loaded via `env.load_seed` adhering to `schemas/seed.schema.json`.
  - State isolation: The Hub stores only biometrics, workouts, goals, and routine templates. Reset (`env.reset`) restores Hub records to the initial seed baseline without touching other apps (`reset_scope: app_instance`).
  - Writes return Core's committed record version. Retries with identical `request_id` are idempotent.

- **Events and notifications (required):**
  Events represent incoming asynchronous wearable sync payloads ingested via Core's `env.apply_event`:
  
  *Example Injected Event (`wearable.sync_day`):*
  ```json
  {
    "event_id": "evt_sync_20261118_01",
    "at": "2026-11-18T06:30:00+01:00",
    "operation": "health_hub.ingest_daily_sync",
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
  *Time Rules & Notifications:*
  - In line with platform constraints, advancing the virtual clock triggers no background callbacks. 
  - Goal and habit deadlines are evaluated lazily against `ctx.virtual_now` during read operations. A daily goal whose window closed prior to `ctx.virtual_now` without meeting threshold values is dynamically derived as `missed`.
  - Notifications (e.g., low recovery alerts, missed habit flags) are appended to the internal Hub notification ledger, read by the agent via `health_hub.list_notifications`. No direct messaging channel declaration is required for v1.

- **Shared data and dependencies (required):**
  - People are referenced strictly by the run binding's `person_id`.
  - External entities are referenced solely by foreign ID (e.g., `linked_task_id`, `linked_calendar_event_id`).
  - Standalone package statement: The package operates with only the shared runtime (Runtime 1.6.0) and its own declared code.

- **Health Record Granularity & Gap Representation:**
  - *Granularity:*
    - Sleep: 1 aggregated summary record per 24-hour cycle.
    - Recovery (RHR & HRV): 1 daily baseline reading taken during the primary sleep period.
    - Strain & Activity: 1 daily aggregate (active calories, steps, strain score 0–21).
    - Workouts: Discrete event records with start timestamp, duration, activity type, and calorie burn.
  - *Volume:* A standard 60-day profile contains ~60 sleep records, ~60 recovery summaries, and ~30–50 discrete workout records.
  - *Data Gaps (Explicit Missing Days):*
    If a user does not wear the tracker (e.g., device uncharged), queries covering that date return:
    ```json
    {
      "date": "2026-10-14",
      "status": "no_data",
      "reason": "device_not_worn",
      "metrics": null
    }
    ```
    This allows tasks (such as Task #117) to explicitly test that an agent handles missing data without hallucinating biometric metrics.
  - *Generation:* Synthetic profiles and time series are deterministically generated via seeded Python/Node scripts enforcing physiological realism (e.g., elevated strain correlates with increased sleep need).

## 4. Construction plan and effort

**Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Core Hub & Data Model | Implement Hub storage engine, JSON seed loader, schema validation, and Core Infra handlers (`env.load_seed`, `env.reset`, `env.snapshot`, `env.apply_event`). | Standalone engine passing `npm run app:verify -- --app apps/health-hub`. | 5–7 |
| Agent MCP Tools | Implement `tools.json` definitions and handlers for health summaries, workouts, goals, routine templates, and notification queries. Enforce optimistic locking (`expected_version`). | Unit tests verifying each tool, optimistic locking conflicts (`stale_version`), and idempotent retries (`request_id`). | 4–6 |
| Synthetic Data & Generator | Build deterministic generator for 5 fictional user personas with 30–90 days of physiological data, including intentional anomalies and sensor-off gap days. | Seed validation checking physiological bounds, timestamp consistency, and gap schema compliance. | 3–5 |
| Web Dashboard (GUI) | Responsive GUI in `gui/` hosted on public business Web Host (`runtime/web/`) visualizing sleep, recovery, workout logs, and goals using the same MCP tools. | Verified UI flows rendering stored state accurately without client-side state drift. | 4–6 |
| Verification & Integration | Comprehensive automated verification suite (`npm run app:verify`), event replay integration, and end-to-end trace validation with Task #117. | Fully green public-runtime verification suite; deterministic reset verified. | 3–4 |

- **Milestones, owners and dependencies (required):**
  - **Milestone 1 (Days 1–5):** Data schemas, seed loader, and core storage engine.
  - **Milestone 2 (Days 6–10):** Agent MCP tools and event handlers; verified with `npm run app:verify`.
  - **Milestone 3 (Days 11–15):** Deterministic synthetic history generator and gap simulation.
  - **Milestone 4 (Days 16–20):** GUI dashboard and integration validation with Task #117.
  - *Owner:* Nassim (@nassimberrada).
  - *Platform Dependencies:* Pinned to Runtime 1.6.0 and Core API 1.2.0.
  - *Related PR Connections:* 
    - **Task #117:** Hub supplies the daily sleep and strain feed with explicit missing-day gaps.
    - **Task #29:** Uses standalone Calendar and Tasks apps; does not depend on Hub biometrics.
    - **PR #14 (Northlake), PR #15 (Cadence), PR #123 (Rainshadow):** Specialized clinical, studio booking, and weather workflows are excluded from Hub and left to those apps.
- **Resources and total effort (required):**
  - Estimated effort: **19–28 person-days** (reduced from 22–34 days due to scoping out duplicate mail/calendar/task implementations).
  - Local execution on Node.js 18+; no hosted servers, API subscriptions, or physical hardware required.
- **Scope boundary and open questions (required):**
  - *In scope:* Biometrics (sleep, RHR, HRV, strain), workout tracking, routine templates, wellness goals, and missing-day gap reporting.
  - *Out of scope:* Medical diagnosis, clinical prescription, real-world wearable hardware syncing, and direct calendar/email shadow stores.
  - *Open questions resolved:* All write actions require explicit `request_id` and `expected_version`; runtime is pinned to local reference runtime 1.6.0; single-user account per instance.
- **License and external dependencies (required):**
  - MIT / repository standard license. 100% synthetic data generated algorithmically. No proprietary Apple Health or Whoop assets used.

### First-Version Workflows, State Transitions & Failure Paths

| Workflow | Entities & States | MCP Tools | Success Example | Error / Rejection Example | Confirm / Cancel Paths |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Biometric Read** | Daily recovery summary (`valid` or `no_data`) | `health_hub.get_daily_summary`, `health_hub.list_metrics` | Agent requests summary for `2026-11-17`; receives sleep score (81) and HRV (62). | Query for unseeded future date returns `error_code: "date_out_of_range"`. | Read-only; cancel not applicable. |
| **2. Workout Logging** | Workout record: `planned` → `completed`, `skipped`, or `cancelled` | `health_hub.log_workout`, `health_hub.update_workout` | Agent logs 45-min run with `request_id: "req_01"`. Record created with `status: "completed"`. | Re-submitting update with stale `expected_version: 1` when record is at version 2 returns `error_code: "stale_version"`. | Agent can update status to `cancelled` if user cancels workout. |
| **3. Goal Tracking** | Goal record: `active` → `achieved`, `missed`, `abandoned` | `health_hub.create_goal`, `health_hub.update_goal` | Agent creates goal "Sleep $\ge 8$ hrs" with target 480 mins. Returns `status: "active"`. | Agent submits negative duration target; rejected with `error_code: "invalid_target_value"`. | Agent can transition goal to `abandoned` upon user instruction. |
| **4. Routine Template Update** | Routine template: `draft` → `active` → `archived` | `health_hub.update_routine_template` | Agent updates "Morning Routine" blocks with new version; returns updated record. | Concurrent conflict triggers `stale_version` error; stored routine remains unchanged. | Reverting changes creates a new version with previous blocks. |