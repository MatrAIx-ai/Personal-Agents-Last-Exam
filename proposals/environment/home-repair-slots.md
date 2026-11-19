# Environment Track proposal

**Proposed PR title:** `[Environment Proposal] [Home & utilities] Home Repair Slots (minimal MVP)`

Proposal only, prepared 2026-11-16. This deliberately narrows the earlier home-repair concept to a small booking state machine. No implementation, evaluation success, delivery date, expenditure, or maintenance commitment is claimed.

## 1. App and domains

- **Authors / GitHub handles (required):** @2018cx (proposal contributor). Implementation and maintenance ownership remain TBD, to be agreed before implementation.
- **Reference app or website / URL (required):** Taskrabbit handyman booking, https://www.taskrabbit.com/services/handyman. The proposed app is independently branded, with synthetic providers, prices, availability, and policies; it does not reproduce or claim Taskrabbit's exact behavior.
- **Primary domain (required):** Home & utilities
- **Secondary domains (optional):** None

## 2. What you plan to build

**✍️ Your answer (required):** A browser app for one non-emergency service: cabinet-hinge adjustment. The MVP supports four end-to-end workflows: (1) browse a few available slots and their fixed, all-inclusive synthetic estimates within a supplied budget; (2) select a slot, review a temporary reservation, and confirm or discard it; (3) reschedule a confirmed booking; (4) cancel a reservation or booking and see the resulting state. Use four small views: slot list, review/confirm, booking details, and change/cancel. No real payment or provider contact occurs.

One deterministic world change creates the initial challenge: a competing synthetic customer takes the selected slot after selection but before confirmation. The visible list and confirmation response must reflect that change. The agent can recover by choosing another available slot within the user's limit, or report that no suitable slot remains. A failed confirmation creates no booking. A failed reschedule preserves the original booking. Repeated confirmation or cancellation is idempotent. Invalid IDs, unavailable slots, and estimates above the supplied budget produce clear errors. Booking scope never includes permission to contact a provider or share home-access information.

## 3. Potential app connections

- **Internal personal apps (required):** None in the MVP. Budget and requested date range are supplied as local scenario context. Calendar and Messages are explicitly deferred, not dependencies.
- **Other apps and websites (required):** None in the MVP. Availability is an in-process synthetic schedule, not a live marketplace connection.

### Integration details

- **Operations and access (required):** Proposed access is the four browser views and a same-state action/observation surface for listing slots, reviewing a temporary reservation, confirming/discarding, rescheduling, and cancelling. Platform-only setup selects a synthetic fixture, resets it, and injects the already-scoped competing-booking event. No provider communication or payment operation is exposed. Exact MCP/API methods and official setup/reset/event hooks are TBD after release and design agreement; this adds interface detail, not new functionality.
- **State and lifecycle (required):** Separate the fixed service/provider definitions from each run's synthetic customer context, budget/date limits, slot availability, reservations, bookings, and event cursor. Restore all mutable state from the seed on reset; any platform snapshot must cover the same run state. Confirm/cancel results are read back from the booking store. Duplicate confirmations/cancellations are idempotent. Concurrent slot occupation is checked atomically at confirmation/rescheduling; failure creates no new booking and a failed reschedule retains the original one. Snapshot and receipt formats remain TBD.
- **Events and notifications (required):** The task scenario determines when a competing synthetic customer takes a selected slot. Illustrative input facts are slot_id=slot-3 and available=false; observable output is the updated slot list and an unavailable-slot result with no booking created. This is the one existing world-change type, not a live marketplace feed. Results are local UI/action responses only; no Mail, Messages, Calendar, or provider notification. The official event envelope and delivery hook are TBD.
- **Shared data and dependencies (required):** Synthetic service, provider, slot, reservation, and booking IDs connect the local schedule and booking store; budget and requested dates come from local scenario context. Estimates and timestamps are structured fixture values, with exact serialization TBD. No images, attachments, addresses, access codes, or real customer/provider records are needed. Reused UI components and the future official adapter depend only on local state; no external runtime service or other environment proposal is required.

## 4. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Web / app construction | Four simple views, one service, one persistent booking store, explicit reservation/confirmed/cancelled states, and atomic confirmation/rescheduling. Reuse generic accessible form components where appropriate. | Four working workflows with visible confirmation and cancellation outcomes; no double booking or loss of the original booking on failed reschedule. | 2–3 |
| Data and image collection | No crawling or collected images. Record the public workflow reference and any reused dependency licenses. | Short provenance manifest; no logos, copied provider listings, or personal data. | 0.25 |
| Synthetic data and assets | Two fictional providers, eight dated slots, four booking fixtures, one budget/date-range context, and one scripted slot-taken event. No photos or attachments. | Seeded fixture file with valid IDs, consistent dates and estimates, and a reviewed no-result case. | 0.5 |
| App integrations | No external or cross-app integrations. Define a small action/observation boundary for the four workflows, then bind it to PALE's interface after release and scope approval. | Documented observations, errors, and permissions; UI and action surface share the same state operations. No claim of current PALE compatibility. | 0.5–1 |
| Validation and reset | At least 12 state/permission/error assertions, four browser workflow tests, two fresh reset/replays, and one independently repeated reference trace. Plan two agent smoke trials after runtime access is available. | Reset restores slots, reservations, bookings, budget, clock, and event cursor. Check target slot, budget, one-booking invariant, cancellation state, and unaffected records. No-op, over-budget, and double-booking controls fail. Keep evaluator-only checks outside agent-visible state. | 1–1.5 |

- **Milestones, owners and dependencies (required):** M1: agree scope and state transitions; M2: fixtures and four UI workflows; M3: approved PALE adapter and tests; M4: demo and independent reproduction. @2018cx is the proposal contributor, not a confirmed implementer or maintainer. Implementation/reviewer names and the official adapter contract are TBD and will be settled before implementation. Planning estimate: 4.25–6.25 person-days, roughly one to two working weeks for one implementer after dependencies are ready; not a delivery commitment. No dependency on another proposed environment.
- **Resources and total effort (required):** 4.25–6.25 person-days. Target a local container with 2 CPU cores, 2–4 GB RAM, and less than 100 MB of fixture data, to be measured. No paid dataset, live API, or real transaction. Optional agent-trial cost is TBD until official runtime/model access and a separate budget are agreed; no spending is authorized here.
- **Scope boundary and open questions (required):** Exclude messaging, attachments, home addresses/access codes, payments, invoices, reviews, emergency repairs, multiple service categories, and every external integration. Only the slot-taken event is in the initial dynamic scenario; additional event types are deferred. Exact PALE action signatures, time control, and private evaluation hooks await the infrastructure release. The owner and maintainers must agree implementation and maintenance arrangements separately.
- **License and external dependencies (required):** MIT is a provisional preference for future newly authored code and synthetic fixtures/assets, subject to contributor approval and dependency-license review before implementation; no license or implementation commitment is made by this proposal. All such deliverables would be redistributed locally, with no hosted-only component. Record reused component licenses and provenance; exact packages and pinned versions are TBD in design review. No proprietary media, real personal data, or external runtime service is required. Public product references are not runtime dependencies; seeded local fixtures and controlled events replace live behavior.
