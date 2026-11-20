# Personal Health & Life Hub

**Title:** `[Environment Proposal] [Fitness & wellbeing + Health & care + Work & business] Personal Health & Life Hub`

**Proposed file:** `proposals/environment/personal-health-life-hub.md`

## 1. App and domains

- **Authors / GitHub handles (required):** Nassim (@nassimberrada)
- **Reference app or website / URL (required):** Apple Health ([apple.com/health](https://www.apple.com/health/)) as a health-data reference, combined with the connected-app model of a wearable companion platform. The environment will be an original simulated application, not a copy of a single product.
- **Primary domain (required):** Fitness & wellbeing
- **Secondary domains (optional):** Health & care; Work & business

## 2. What you plan to build

Personal Health & Life Hub is a simulated personal assistant ecosystem that brings together wearable data, health and fitness information, and everyday digital tools in one environment.

The app will provide a unified view of a person's physical wellbeing, daily routines and commitments. It will combine data such as sleep, heart rate, HRV, activity, workouts and recovery with calendar events, emails, notes, tasks and personal goals. Users will be able to inspect trends, manage routines, set goals and coordinate their day.

Personal agents will be expected to reason across these connected data sources rather than act on isolated records. For example, an agent handling an adaptive routine task might consider poor sleep, low recent activity, a demanding calendar and an upcoming commitment before proposing changes to exercise, work and rest periods.

Potential workflows include:

- **Adaptive daily routines:** Adjust routines based on sleep, recovery, activity, commitments and changing circumstances.
- **Fitness planning:** Create and adapt workout plans using activity history, goals, preferences and available time.
- **Sleep and recovery:** Identify patterns and suggest changes to routines and activity plans.
- **Habit and goal tracking:** Track progress, detect missed habits and revise plans.
- **Health-aware scheduling:** Find suitable times for exercise, meals, breaks and personal activities around existing commitments.
- **Personal productivity:** Summarize upcoming commitments, prepare for meetings and connect notes or emails to relevant tasks.
- **Proactive assistance:** Detect relevant changes and notify the user when a routine or plan may need attention.

The environment will support both read-only analysis and controlled write actions. It will provide realistic multi-day history, changing user state, conflicting information and events that require agents to update their plans.

## 3. Potential app connections

- **Internal personal apps (required):**
  - Mail: Read messages, identify commitments and extract relevant dates or action items.
  - Calendar: Read events and availability; create or update events with user permission.
  - Notes: Read and create personal notes, journals and routine plans.
  - Tasks / reminders: Read, create, update and complete tasks.
  - Contacts: Resolve people referenced in messages and calendar events.
- **Other apps and websites (required):**
  - Wearable and health platforms: Simulated Apple Health and Google Health Connect-style data sources for activity, sleep, heart rate, workouts and recovery.
  - Fitness services: Simulated workout libraries and exercise tracking.
  - Nutrition services: Food logs, meals, hydration and nutrition summaries.
  - Weather: Context for outdoor activity and daily planning.
  - Optional health-provider records: Synthetic appointments, measurements and care information. No real provider connection is required.

### Integration details

- **Operations and access (required):** Provide an agent-facing API or MCP interface with structured tools for querying health metrics, activity history, sleep, workouts, goals, calendar events, emails, notes and tasks. Include actions to create or update routines, workouts, calendar events, notes and reminders. The interface should also expose setup, reset, snapshot and event-injection operations for platform use. A web UI will provide equivalent user-facing workflows. Actions that affect personal records should support explicit confirmation where appropriate.
- **State and lifecycle (required):** Each simulated user account will have isolated profile, health, wearable and connected-app state. Initial fixtures will include profile information, preferences, health goals, historical measurements, calendar events, messages, notes and tasks. State will persist across agent actions within a run. Provide deterministic reset and snapshot behavior, with a way to restore initial fixtures. Writes should return clear success or failure results, support safe retries and avoid duplicate records. Concurrent updates should use version checks or equivalent conflict handling.
- **Events and notifications (required):** Support injected events such as new wearable measurements, completed workouts, sleep summaries, calendar changes, incoming emails, task updates and missed reminders. The environment should also generate notifications for relevant changes, such as a routine conflict, a missed goal or a suggested adjustment. Events should include timestamps, source identifiers and structured payloads. Task scenarios will define event timing and expected agent responses.
- **Shared data and dependencies (required):** Use consistent identifiers for users, accounts, activities, measurements, workouts, goals, calendar events, emails, notes and tasks. Health records should include units, timestamps and source metadata. Support common attachment metadata and synthetic image assets where useful, but avoid requiring real personal data. Shared services should cover authentication simulation, event delivery, persistence and fixture management.

## 4. Construction plan and effort

**Work breakdown (required):**

| Workstream                | Planned work and scale                                                                                                                                                                                                                     | Deliverable / quality check                                                                                                                             | Effort (person-days) |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Web / app construction    | Build a responsive dashboard with overview, health metrics, activity, sleep, workouts, routines, goals, calendar, mail, notes and task views. Include detail pages, history views and connected-app settings.                              | Working end-to-end UI flows; verify that displayed values match stored state and that user actions produce expected changes.                            | 8–12                 |
| Data and image collection | Reuse no real personal health records. Review public documentation and interface references to guide realistic data structures and visual design. Use only assets with suitable reuse rights.                                              | Record sources and licenses; verify that reused assets render correctly.                                                                                | 1–2                  |
| Synthetic data and assets | Generate 5–10 user profiles, 30–90 days of wearable and health history per profile, and realistic calendars, emails, notes, tasks and goals. Include varied activity levels, routines, preferences, missing data and occasional anomalies. | Consistent linked fixtures with realistic trends, timestamps, units and source metadata. Check for duplicates, impossible values and broken references. | 4–6                  |
| App integrations          | Implement simulated connections for wearable data, Mail, Calendar, Notes, Tasks and Contacts. Add optional nutrition and weather sources if time permits.                                                                                  | Verify cross-app reads and writes, permissions, identifier consistency and behavior when a connection is unavailable.                                   | 5–8                  |
| Validation and reset      | Add deterministic fixtures, API and UI tests, event injection, reset and snapshot support. Test adaptive routine scenarios, conflicting commitments, missing measurements, stale data, denied permissions and failed writes.               | Reproducible tests with expected outcomes; demonstrate state consistency, permission enforcement and reliable reset.                                    | 4–6                  |

- **Milestones, owners and dependencies (required):** First define the data model, user profiles and fixture format. Next build the core dashboard and agent-facing API. Then implement connected-app simulations and event injection. Finally add validation, reset and example task scenarios. Owners: Nassim (@nassimberrada]. Expected duration: approximately 3–5 weeks. Main dependencies are agreement on the API/MCP interface and the platform's environment lifecycle requirements.
- **Resources and total effort (required):** Estimated total: 22–34 person-days. Use synthetic data and locally hosted services. No paid health API or wearable hardware should be required. Storage and compute needs should be modest; exact hosting requirements are TBD pending platform integration.
- **Scope boundary and open questions (required):** The environment is a task simulation, not a medical product. It will not diagnose conditions, prescribe treatment or make clinical decisions. Real wearable accounts and real personal health records are out of scope. Initial implementation will prioritize wearable data, routines, calendar, mail, notes and tasks. Nutrition, weather and provider-record integrations may be deferred. Open questions include the exact MCP/API contract, whether the platform requires multiple simultaneous user accounts, and which write actions require confirmation. Resolve these during design review and platform integration.
- **License and external dependencies (required):** Original code and synthetic data will be released under the repository's applicable license. Any third-party assets or references will be reviewed for reuse rights and documented. No external service should be required at runtime. Any optional integrations will be simulated or replayed from controlled fixtures so that tasks remain deterministic and reproducible.