# Environment Track proposal

Proposed PR title: `[Environment Proposal] [Fitness & wellbeing] Cadence class booking (ClassPass-inspired)`

## 1. App and domains

- **Authors / GitHub handles (required):** Sunny Yuan ([@ZichenYuan](https://github.com/ZichenYuan)).
- **Reference app or website / URL (required):** Cadence, an independently branded synthetic studio class marketplace with credit plans and free trials; interaction patterns reference ClassPass (https://classpass.com/) and its public help pages only. No third-party code, assets or data are used.
- **Primary domain (required):** Fitness & wellbeing
- **Secondary domains (optional):** None

## 2. What you plan to build

**✍️ Your answer (required):** A resettable studio class marketplace where a user checks their membership plan and trial rules, searches classes whose price depends on the plan and on prior visits, books, cancels, reschedules and waitlists classes without overlapping existing reservations, and reads studio pages with ratings and schedules. Class times, waitlist promotions, plan renewals and studio cancellations run on the simulated clock.

Initial workflows, each complete end to end including modification, cancellation, confirmation and realistic errors:

1. **Plan and account.** Plan page with plan type, credits, free-trial status and end date, trial rules (for example "first visit at each studio included" and premium classes excluded), renewal date and a masked payment method. Plan change or cancellation with confirmation and a proration preview.
2. **Class search and booking.** Browse by type, studio, neighborhood, date and time window. Each class shows capacity, rating and review count, and its price under the user's plan: "included in trial", a credit cost, or "not available on your plan". Booking is a preview (cost under the plan, conflicts with existing reservations, cancellation window) followed by a confirmation. Errors: full class (offers the waitlist), overlap with an existing reservation, class not included, insufficient credits, outside the booking horizon.
3. **Reservations.** Upcoming and past reservations; cancel inside the window or late-cancel with a fee preview; reschedule to another instance; check in; rate after class. Studio-initiated cancellations arrive as events with a notification and a credit return.
4. **Studios and instructors.** Pages with location, ratings, amenities and schedules; schedule changes arrive as events.

Value for personal-agent tasks: fitness scheduling is where "free", "soon", "balanced" and "doesn't overlap" are personal constraints rather than single filters, and where the right booking depends on reservations the user already made, on plan rules that are easy to misread, and on waitlists and cancellations that move after the plan is made. The author's reviewed PersonalAgentEval cases supply downstream tasks on this environment: filling a free-trial week with classes that are actually free (submitted alongside this proposal as a linked Task PR), joining a waitlist for a full class and acting on the promotion within the plan's rules, and planning a week around coaching advice the user has already accepted.

## 3. Potential app connections

- **Internal personal apps (required):** Calendar: reservations are created, moved and cancelled, and other commitments on the Calendar can be read for conflicts. Mail: confirmations, cancellations, waitlist promotions, trial-ending reminders and receipts. Contacts: None.
- **Other apps and websites (required):** A payments app and a maps app are future links; the initial scope keeps distance as a field on each studio and models payment approval inside plan changes and late-cancel fees.

### Integration details

- **Operations and access (required):** Agent-facing MCP operations: `classes.search|get`, `studios.get`, `plan.get|change|cancel`, `reservations.list|preview|confirm|cancel|reschedule|checkin|rate`, `waitlist.join|leave`, `account.get`, `payment_methods.list`. Writes with money or capacity effects (`reservations.confirm`, `reservations.cancel` when a late fee applies, `plan.change`, `plan.cancel`) are approval-gated. A GUI renderer presents the plan, search results, class detail, reservations, studio and account pages for computer-use agents. Platform-facing operations: `env.reset`, `env.load_seed`, `env.snapshot`, `env.inject_event`.
- **State and lifecycle (required):** App state (studios, class templates, fee and plan rules) is separated from account state (plan, credits, reservations, waitlist positions, payment method) and run state (clock, pending previews, event log). Seed validation checks capacities, time ranges and plan rules; reset restores the seed and clears previews; a preview expires after a configured simulated interval; confirm is idempotent by preview ID; a capacity change between preview and confirm returns a conflict and offers the waitlist.
- **Events and notifications (required):** Accepted events: `classes.cancelled_by_studio`, `classes.schedule_changed`, `classes.capacity_changed`, `waitlist.promoted`, `plan.renewed`, `plan.trial_ending`, `account.session_expired` (the app returns a signed-out state until `account.session_restored`, which only the user can trigger). Published notifications: text-email notifications to Mail for confirmations, cancellations, promotions, reminders and receipts, and calendar updates for reservations, following the shared Mail and Calendar apps' formats. Task scenarios decide when events occur.
- **Shared data and dependencies (required):** Stable IDs for the person, account, studio, class instance and reservation; receipts by ID; studio images are generated for the project and addressed by asset ID. Depends on the shared Mail and Calendar apps and the platform clock; no external service at run time.

## 4. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Web / app construction | Build the App package (manifest, tool definitions, seed and event schemas, fixtures, local tests and renderer): domain model, about 18 business operations across the four workflows, event handlers and a GUI renderer with about 7 pages. Reuse whatever reference schemas and test harness the platform publishes. If the first infrastructure release specifies a different interface, port the thin interface layer and keep the business model. | Every declared workflow runs end to end through operations and the renderer with matching state, including overlap, not-included, full-class, late-cancel and signed-out errors; `tools.json` describes each operation's reads and writes. | 4–5 |
| Data and image collection | No crawling. Public help pages of the reference products are read only to mirror interaction patterns. | A short source/reuse note in `dataset.json`; no third-party media. | 0.5 |
| Synthetic data and assets | Three reset fixtures, each with 15–25 studios, 150–300 class instances over two weeks priced under three plan types, 2–4 existing reservations, and a schedule of 10–15 events. Fixed seeds; realistic variation such as premium classes excluded from trials, a studio already visited, and a class that fills during the scenario. | Fixtures conform to the seed schema; no impossible overlaps inside a studio; capacity never below bookings; price rules consistent across plan types; automated checks and a human read-through recorded in `dataset.json`. | 2 |
| App integrations | Declare and implement published notifications to Mail and Calendar; bind approval-gated writes to the platform's permission model; read Calendar for conflicts when the task grants it. | One connected example from a studio cancellation event to a Mail notice, a Calendar update and a replacement booking; contract checks that Mail, Calendar and app records agree on times and IDs. | 2–3, after the interface is confirmed |
| Validation and reset | Local business tests for each workflow and error case, permission cases, event application, and a reset round-trip that restores byte-identical account and run state; fixtures and expected outcomes in `tests/cases.json` and `examples/scenario.json`; a fresh-environment reproduction by a contributor who did not implement the flows. | Local test results with runtime version and commands; platform integration evidence for permissions, state consistency and reset attached to this PR; a reference interaction books the intended week at zero cost, a no-op books nothing, and a wrong interaction (a paid class or an overlap) fails its checks. | 2–3 |

- **Milestones, owners and dependencies (required):** Sunny Yuan (@ZichenYuan) owns M0–M3. M0: design review and confirmation of the delivery format. M1 (weeks 1–2): domain model, operations, fixtures and local tests. M2 (week 3): renderer, events and notification declarations. M3 (about 1 week after the infrastructure release): platform integration evidence and independent reproduction. Expected calendar duration 3–5 weeks. Dependencies: the infrastructure release and the shared Mail and Calendar apps. Related PRs: the linked Task proposal #18 (free-trial week) depends on this environment; no Fitness & wellbeing environment proposal was open as of 2026-11-16.
- **Resources and total effort (required):** 10–13 person-days excluding infrastructure wait. Local Node.js 18+ and a browser; no GPU; fixtures under 5 MB; no paid data or external service. Model-trial budget belongs to the linked task proposals.
- **Scope boundary and open questions (required):** One account per instance; real payments, maps and distance computation, social features, wearable sync, instructor marketplaces, recurring memberships beyond one renewal, and any municipal or recreation-program registration are excluded. Open questions for design review: whether sign-in expiry should be a platform concept or an app state as proposed; whether Calendar or the app is the source of truth for conflicts when both hold the reservation.
- **License and external dependencies (required):** Code under MIT; synthetic fixtures and generated assets under CC0; no third-party assets, trademarks or hosted components; no external service at run time.

Implementation and validation links will be added against these deliverables in the same PR after plan approval. Substantial scope changes will be returned for design review.
