# Environment Track proposal

## 1. App and domains

- **Authors / GitHub handles (required):** Priyanka Mary Mammen (@priyankamary)
- **Reference app or website / URL (required):** Clue, https://helloclue.com (public workflow reference for cycle logging and forecasts; verify the current feature set before finalizing)
- **Primary domain (required):** Health & care
- **Secondary domains (optional):** Fitness & wellbeing

## 2. What you plan to build

**✍️ Your answer (required):**

Tidewell (working name) is an independently branded, synthetic menstrual cycle tracker, scoped to a first version that is complete and testable. A user logs cycles and reads a forecast that reflects what changed in their life. The environment is built around one personalization problem: a forecast is only useful if it accounts for irregular stretches the user has marked, such as an illness.

First version, two complete workflows:

1. **Log and review a cycle.** Record a period start and end date, with edit, correction and deletion. View the cycle-length history. Validation covers missing dates and overlapping cycles.
2. **Forecast with an exclusion.** Show the next predicted period. The user can mark a stretch as irregular (for example, an illness), and the forecast excludes those entries and says so in the interface.

Out of scope for the first version, and planned as later extensions to be proposed separately: sharing and privacy controls, calendar, mail and contacts integrations, reminders, the clinic summary export, pregnancy or fertility modules, medical advice, and community features.

Value for personal-agent tasks: the agent must use stored history correctly, respect what the user has marked as irregular, and decide whether to update a forecast or ask first.

## 3. Potential app connections

- **Internal personal apps (required):** None in the first version. Calendar and Contacts integrations are a planned extension.
- **Other apps and websites (required):** None.

### Integration details

- **Operations and access (required):** Browser GUI as the primary agent interface. Platform operations: reset to the seeded account, and load a scenario fixture. Event injection is not used in the first version.
- **State and lifecycle (required):** One synthetic account per run, isolated per run. The seed contains 12 months of cycle entries with one marked irregular stretch. Reset restores the seed exactly. Snapshots are taken before each scenario step so grading can compare states. Writes are single-user, so no concurrency handling is needed in the first version.
- **Events and notifications (required):** None in the first version.
- **Shared data and dependencies (required):** One synthetic persona with no real personal data and no real health-record formats. No attachments. Dependencies: a standard web stack. No third-party health-data SDKs.

## 4. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Web / app construction | Two workflows; about 3 screens (log and edit, history and forecast, irregular-stretch marking); a standard form and table library | Each workflow completes end to end, including edit, deletion and error states (missing dates, overlapping cycles) | 4–6 (estimate) |
| Data and image collection | N/A: no crawling or image collection. Reference app is used only for workflow shape. | N/A | N/A (no collection) |
| Synthetic data and assets | One persona with 12 months of cycle history and one marked irregular stretch | Checks for consistent date arithmetic and no overlapping cycles | 1–2 (estimate) |
| App integrations | None in the first version | N/A | N/A (no integrations) |
| Validation and reset | Local tests for the forecast exclusion and the edit and delete paths; scenario fixtures with expected outcomes; reset and snapshot checks | Reproducible local test results; reset restores the seed exactly; the forecast changes as expected when an irregular stretch is marked | 2–4 (estimate) |

- **Milestones, owners and dependencies (required):** Order: (1) data model and persona, (2) logging and history, (3) forecast and irregular-stretch marking, (4) reset, snapshots and validation. Owners: Priyanka Mary Mammen (@priyankamary). Duration: about 3–4 weeks part-time for one contributor (estimate). Dependencies: the first infrastructure release for the reset and snapshot interface.
- **Resources and total effort (required):** Total about 8–12 person-days (estimate, the sum of the ranges above). No collection or generation costs beyond compute for local tests. Storage: under 10 MB for the seeded account.
- **Scope boundary and open questions (required):** Excluded from this version: sharing and privacy controls, integrations, reminders, the clinic summary export, pregnancy or fertility modules, medical advice, and community features. Open question: whether the forecast should be a simple rolling average or a documented model. The choice will be fixed in the design review, and the grader will be built to match.
- **License and external dependencies (required):** Code and synthetic assets: MIT License, matching the repository's default license. No hosted service is needed at run time; the reference app is not redistributed. External services: none. Replay strategy: not applicable, because there are no external events.

---

After approval, add implementation and validation links against these deliverables in the same PR. Reviewers use the approved plan as the acceptance baseline; substantial scope changes require another design review. See the [contribution guide](../../CONTRIBUTING.md#review-and-implementation).
