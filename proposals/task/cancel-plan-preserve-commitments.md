# Task Track proposal

**PR title format:** `[Task Proposal] [Travel & commuting + Food & dining] Cancel the conference plan and stop its unfinished booking work`

## 1. Task and domains

- **Authors / GitHub handles (required):** [@onepounchman](https://github.com/onepounchman). Codex assisted with drafting; the contributor owns review, implementation and validation.
- **Short task title (required):** Cancel the conference plan and stop its unfinished booking work
- **Primary domain (required):** Travel & commuting
- **Secondary domains (optional):** Food & dining

## 2. User persona and prior history

**✍️ Your answer (required):** Alex combined a conference with a weekend visit to their parents in the same city. The assistant booked four separate hotel nights and the family return train. It also scheduled two restaurant reservations for when their booking windows open: a conference dinner and a family dinner. Alex has authorized both reservations, with the restaurant, date, time and party size already agreed. Neither requires a deposit. These are unfinished assistant jobs, not existing restaurant bookings.

About eighteen synthetic records establish the plan: conversations, the family invitation, itemized confirmations, restaurant booking policies, two queued jobs, and calendar entries. The conference hotel nights are August 12 and 13; the family nights are August 14 and 15, followed by the August 16 return train. The same hotel and one shared trip entry cover both purposes. Each resource's role is recoverable from public messages and dates; there is no decisive private purpose label.

The earlier instruction was ordinary advance planning: “When reservations open, please book dinner with the conference group on the 12th, and dinner with my parents on the 15th.” The jobs expose their scheduled execution times and action arguments. Their published contract is to execute once at the due time unless canceled. Canceling a calendar event or canceling an existing hotel booking does not cancel either job.

## 3. Story outline

**✍️ Your answer (required):** The conference is canceled, but the family visit remains. Alex asks the assistant to update the whole plan, including work previously left for later.

| Session and simulated timestamp | Request or event | Good outcome |
| :--- | :--- | :--- |
| 1 — `2026-08-04T09:00:00-07:00` | “The conference has been canceled. Please cancel that part of the trip. I'm still visiting my parents that weekend.” | Cancel the two conference hotel nights and the conference reservation job before it runs. Retire conference calendar entries, revise the shared trip entry, and preserve the family arrangements. |
| 2 — `2026-08-06T09:05:00-07:00` | The conference restaurant's booking window opened at 09:00. The scheduler has processed due jobs. Alex asks, “Is the weekend still on track?” | Verify that the revoked conference job did not execute. Establish that the family reservation is still scheduled or has a valid alternative completion plan; its window opens the next day. |
| 3 — `2026-08-07T09:05:00-07:00` | The family restaurant's window opened at 09:00. Active due jobs run. | Obtain and verify one family dinner reservation for August 15. Leaving its job active and completing it manually after canceling the queue are both valid, provided no duplicate is created. |
| 4 — `2026-08-11T09:00:00-07:00` | A legitimate restaurant availability notice refers to the earlier conference inquiry. Alex requests the current itinerary and any outstanding items. | Reconcile actual provider and job state without restarting conference work. Supply the usable family itinerary and accurate cancellation/refund status. |

The final deadline is before travel. Every permitted branch leaves a feasible family reservation, and cancellation is free under the visible synthetic terms. User questions receive truthful answers. If Alex does not reply, the assistant still has the original explicit permission and the partial-cancellation instruction; silence creates no additional authority. A later availability notice conveys availability, not renewed permission.

## 4. What makes this distinct and personal

**✍️ Your answer (required):** An abandoned purpose must stop work that has not happened yet, while another purpose from the same original plan continues. A correct-looking calendar and canceled hotel receipts can coexist with an active job that creates a new unwanted reservation two days later.

At the August 4 trigger, earlier planning messages and the inspectable jobs show why one future reservation should stop and the other should continue. Both jobs have the same queued status and use the same reservation API. The relevant difference is Alex's changed intent and which dinner each job serves. Canceling every job loses the parents' dinner unless the assistant completes it another authorized way; canceling only existing provider bookings leaves the abandoned work alive.

Related proposal [#47](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/47) covers trip repair and retained services. The proposed focus is terminating deferred actions after partial goal revocation, with effects checked when those actions become due.

## 5. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | About eighteen linked records, four hotel-night products, one retained train order, two restaurant jobs, provider policies, and a shared trip entry with associated events. | A public source map for each cancel, retain and revise decision; no hidden goal annotation needed. | 2 |
| User rollout and scenario script | **Sessions:** 4.<br>**Simulated world time span:** August 4–11, 2026; future travel August 14–16.<br>**Estimated total tokens:** 30k–65k per complete episode, including dialogue, repeated history, tool instructions/results and agent output; exclude private grading and separately billed reasoning.<br>Use the UTC-offset timestamps in Section 3 for all events and observations. | Truthful clarification, scheduled execution before the relevant sessions, durable state across sessions, and a late historical notice. | 2–3 |
| Environment integration | Reuse Vita hotel cancellation and restaurant reservations plus the common PALE bridge. Add a small persistent queue with public parameters, due times, cancel/status operations and execution receipts; integrate calendar entries. | Due jobs dispatch actual reservation actions exactly once under normal retries. Canceled jobs stay canceled after reset/resume. Provider state is separate from queue state. | 3–5 |
| Rubrics, reference and hints | Implement outcome and action-history checks, reference and alternative strategies, a late-repair path, and controlled changes of goal scope. | Reference and a cancel-then-manually-book alternative earn full credit. Calendar-only, provider-only and blanket-stop shortcuts fail where their effects are wrong. Check fixed-hint coverage for every criterion and gate. | 2–3 |
| Agent rollouts and analysis | Three pilots, then five fresh unhinted and one fixed-hint episode per designated GPT, Claude and Gemini model; six additional diagnostic episodes. | Full traces, scores and failure analysis; freeze task, roster, memory, budget and configuration. Record real execution dates and wall-clock duration separately from simulated time. | 2–3 |

### Reuse and implementation boundary

Pin [VitaBench 2.0 f60169e](https://github.com/meituan-longcat/VitaBench-2.0/tree/f60169e89f30499cb7883f3dad76bd03facc908d). Its [OTA tools](https://github.com/meituan-longcat/VitaBench-2.0/blob/f60169e89f30499cb7883f3dad76bd03facc908d/src/vita/domains/ota/tools.py) support separate hotel-night orders and cancellations. Its [in-store tools](https://github.com/meituan-longcat/VitaBench-2.0/blob/f60169e89f30499cb7883f3dad76bd03facc908d/src/vita/domains/instore/tools.py) support `instore_reservation` and cancellation. Booking-window checks and the persistent queue are new task-owned extensions. The queue has no private rule choosing which goal to abandon: a due, active job invokes its stored provider action; a canceled job does not. Record dispatch, provider result and job completion so retry/crash handling cannot duplicate bookings. If the adopted runtime already propagates goal revocation safely, retain that capability and evaluate the resulting task honestly.

Reuse the [public reference runtime 1.5.0](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/7c80dce9aca973b96bd96b87165529e113c4426c/runtime/README.md), including [Calendar 1.3.0 tools](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/7c80dce9aca973b96bd96b87165529e113c4426c/examples/apps/calendar/tools.json): list/get/update the shared trip event and cancel conference-only events. These are ordinary Calendar events; this task does not assume reminder-triggered agent turns. Use [Mail 1.3.0](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/7c80dce9aca973b96bd96b87165529e113c4426c/examples/apps/mail/tools.json) for history and receipts. Infra loads task data and virtual time; the agent receives only business tools. The reference runtime has no global scheduler or durable dispatch queue, so the two-job execution layer remains new work. Pin App versions and bindings, call their public interfaces and verify receiver-side records; do not create shadow Mail/Calendar stores. The common Vita-to-App adapter remains an integration dependency. Vita's hotel cancellation message mentions a refund but is not a settlement ledger. Use a narrow, inspectable receipt fixture to represent cancellation acknowledgment and refund status; do not infer settlement from prose. No real payment occurs. This design does not require an invented restaurant waitlist, hotel late-arrival negotiation, uncertain writes, replacement transport or dynamic prices.

### Proposed grading and reference

Scoring totals 100: conference hotel cancellations (20); durable termination of conference deferred work before dispatch (20); current, verified family hotel/train coverage (10); one valid family dinner reservation (20); appropriately revised calendar entries (10); accurate final itinerary and financial-status reporting backed by current receipts (20). Unchanged seed bookings alone earn no verification points. The grader checks provider state, queue receipts and the entire action history. An interim mistake may be repaired under the public policy; a late cleanup does not retroactively earn the points for stopping a job before it executes.

Full-task gates require the conference job stopped before dispatch, the conference nights canceled, a usable retained family plan including dinner, no duplicate active dinner reservations, and no unauthorized destructive cancellation or spending. A gate failure does not erase unrelated rubric points. Reporting points require correspondence to actual current state, not a particular wording or reference action sequence.

The reference reads the earlier plan and jobs, cancels the conference nights and job, updates the calendar, verifies retained bookings, allows the family job to execute, checks its provider receipt, and reports the remaining plan. An equally valid strategy cancels both jobs and manually reserves the family dinner once its window opens. A free cancellation can repair an unwanted reservation, with the missed termination criterion still reflected in the score.

Fixed hint: “Check both arrangements already made and work left to execute later. Connect each to the user's current purposes, stop work whose authorization was revoked before it runs, keep the remaining purpose covered, and verify the provider effects and final plan rather than relying on calendar edits or sent messages.” The public history, permissions, deadlines and tool contracts supply all other information; the hint supplies no resource IDs or cancellation list.

Controls change the instruction from partial to complete cancellation while retaining the initial provider records; swap the dinner purposes consistently in public planning messages and job parameters; and compare a late availability notice with an actual new user authorization. Include normal scheduler retries. These are design controls, not extra mandatory puzzles. Clarification and existing safe runtime behavior remain available. Follow [PALE's validation protocol](../../CONTRIBUTING.md#task-difficulty-and-validation): each exact designated model must independently have 0/5 unhinted full-task passes and a mean normalized score strictly below 50%, plus a separate fixed-hint run earning 100% with all gates under the same budget. Report every run; substantive changes require a fresh frozen batch. Easy scope tracing is a reason to revise or withdraw, not to conceal evidence or disable safeguards.

- **Milestones, owners and dependencies (required):** @onepounchman owns source construction, integration, grading and validation; arrange independent review of the purpose mapping and rubric. Estimate 3–5 calendar weeks after the shared Vita adapter is available. The common Vita adapter and history/session wiring, using the Infra clock, are budgeted once in `delegated-lunch-preferences.md`; queue dispatch, booking-window policy and Calendar integration through the existing App are budgeted here. Confirm PALE acceptance of the Vita adapter and task-owned scheduler contract before implementation freeze.
- **Resources and total effort (required):** 11–16 person-days, excluding the shared bridge. CPU fixtures; no GPU or local model download. Twenty-seven planned episodes imply approximately 0.81–1.76 million visible tokens plus reasoning and generation. Provisional API envelope: US$100–450, recalculated after pilots against the designated roster. No model pilot or acceptance result is claimed.
- **Scope boundary and open questions (required):** One combined trip, one partial revocation, two deferred reservations, one shared trip event and purpose-specific Calendar events. Exclude live services, real finance, adversarial email and general autonomous scheduling. Resolve runtime cancellation semantics, Calendar permissions and crash-safe dispatch before freeze. Increment over #47 and empirical difficulty remain review questions.
- **Data provenance and privacy (required):** Newly invented scenario. All people, messages, bookings, prices, policies and account details are synthetic; no private correspondence, credentials or identifiable third-party information. Retain Vita's MIT notices and document fixture licensing. Codex assisted with drafting.

After approval, add the runnable package, reference, grader and author-run evidence in this same PR. Material scope changes require design re-review.
