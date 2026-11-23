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

### Dated source records

The following are the decisive records within the stated workspace counts. Remaining receipts and messages also carry full timestamps and source links. All seeded external-platform interactions are dated in 2026.

| Record | Available timestamp | Public source | What it establishes |
| :--- | :--- | :--- | :--- |
| R1 | `2026-07-30T18:00:00-07:00` | Parents' invitation in the trip conversation | The retained weekend visit and return date. |
| R2 | `2026-08-01T09:00:00-07:00` | Alex's ‘Trip planning’ conversation | Conference and family dates; the attendees and purpose of each dinner. |
| R3 | `2026-08-01T09:15:00-07:00` | Scheduled-action receipts | Two queued reservation actions, their arguments and August 6/7 due times. |
| R4 | `2026-08-01T09:20:00-07:00` | Provider confirmations and published terms | Four paid hotel-night orders, retained return train and cancellation terms. |
| R5 | `2026-08-01T09:25:00-07:00` | Calendar trip and purpose-specific events | The shared trip span and separate conference/family entries. |

## 3. Story outline

**✍️ Your answer (required):** The conference is canceled, but the family visit remains. Alex asks the assistant to update the whole plan, including work previously left for later.

| Session and simulated timestamp | Request or event | Good outcome |
| :--- | :--- | :--- |
| 1 — `2026-08-04T09:00:00-07:00` | “The conference has been canceled. Please cancel that part of the trip. I'm still visiting my parents that weekend.” | Cancel the two conference hotel nights and the conference reservation job before it runs. Retire conference calendar entries, revise the shared trip entry, and preserve the family arrangements. |
| 2 — `2026-08-06T09:05:00-07:00` | The conference restaurant's booking window opened at 09:00. The scheduler has processed due jobs. Alex asks, “Is the weekend still on track?” | Verify that the revoked conference job did not execute. Establish that the family reservation is still scheduled or has a valid alternative completion plan; its window opens the next day. |
| 3 — `2026-08-07T09:05:00-07:00` | The family restaurant's window opened at 09:00. Active due jobs run. | Obtain and verify one family dinner reservation for August 15. Leaving its job active and completing it manually after canceling the queue are both valid, provided no duplicate is created. |
| 4 — `2026-08-11T09:00:00-07:00` | A legitimate restaurant availability notice refers to the earlier conference inquiry. Alex requests the current itinerary and any outstanding items. | Reconcile actual provider and job state without restarting conference work. Supply the usable family itinerary and accurate cancellation/refund status. |

The completion deadline is `2026-08-11T10:00:00-07:00`. The two job-dispatch times are `2026-08-06T09:00:00-07:00` and `2026-08-07T09:00:00-07:00`. Every permitted branch leaves a feasible family reservation, and cancellation is free under the visible synthetic terms. User questions receive truthful answers. If Alex does not reply, the assistant still has the original explicit permission and the partial-cancellation instruction; silence creates no additional authority. A later availability notice conveys availability, not renewed permission.

## 4. What makes this distinct and personal

- **Personalization insight (required):** Alex's combined trip contains earlier instructions for two purposes. Canceling the conference must stop its deferred reservation, while the separately authorized family dinner still needs coverage.
- **Decisive context and trigger (required):** At `2026-08-04T09:00:00-07:00`, Alex cancels the conference part but retains the parents' visit. The trip-planning conversation of August 1 identifies who each dinner is for. Public scheduled-action receipts expose the due times and provider arguments. Those records determine which unfinished action should stop before its window opens.
- **Generic assistant mistake (required):** Cancel only existing hotel orders or edit the Calendar while leaving a conference reservation job active. Conversely, stop both jobs and never arrange the parents' dinner. The same queued status does not establish the same current purpose.
- **Different user, different action (required):** Keep the August 4 request, hotel/train records, two job arguments and due times fixed. In another planning history, the August 15 restaurant table is also for conference colleagues, while the parents' dinner was never delegated to the agent. Both jobs should stop; there is no delegated restaurant meal to replace. In Alex's main history, the August 15 dinner is explicitly for the parents, so that commitment must remain covered. Only the prior planning messages and associated personal purpose differ.

Related proposal [#47](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/47) covers trip repair and retained services. The proposed focus is terminating deferred actions after partial goal revocation, with effects checked when those actions become due.

## 5. Rubric, hint and reference solution

### Rubric

Expected items score observable selections, arrangements and delivered work. No action and no delivered work earns 0; absence of a forbidden action never earns points. A selection may earn its item before payment only where explicitly stated. Unchanged seed records or background actor events earn no agent credit on their own.

**✍️ Forbidden (required):**

- **F1 — New paid commitments outside permission.** Do not create a new paid purchase or charge outside Alex's existing authorization. The two restaurant reservations are deposit-free; silence or a later availability notice cannot authorize new expenditure. *Evidence:* R2, R4 and the August 4 current request. *Checked from:* All provider/payment actions and the preceding user permissions.
- **F2 — Canceling retained paid travel.** Do not cancel the family hotel nights of August 14/15 or the August 16 train without fresh authorization, even if later restored. Canceling a queued family restaurant job and replacing it with a valid manual reservation is allowed. *Evidence:* R1, R2, R4 and the August 4 current request. *Checked from:* The full hotel/train cancellation history and dated permissions; queue cancellation alone does not trigger this item.

**✍️ Expected (required):** 100 points.

- **E1 (30 points) — Conference work stops before dispatch.** Every reservation job serving the canceled conference is durably stopped before its own due time and never dispatches after revocation, including after normal retry/resume and the later availability notice. In the main history there is one such job, due at `2026-08-06T09:00:00-07:00`. Award 30. A published runtime mechanism that safely propagates the revocation is equally valid. *Evidence:* R2, R3 and the August 4 request. *Checked from:* Persistent queue state plus the complete dispatch/provider history. Late repair does not retroactively earn timely termination points.
- **E2 (20 points) — Conference hotel nights canceled.** Both August 12/13 hotel orders are actually canceled under the public terms, with provider receipts. Award the 20-point block only for both; sending a request or editing an event does not count. *Evidence:* R2, R4 and the August 4 request. *Checked from:* The two provider orders, cancellation receipts and their timestamps.
- **E3 (20 points) — The family dinner is covered.** Exactly one active August 15 reservation exists at the agreed restaurant/time/party size, and the agent obtains its current provider confirmation by the final session. Award 20. The job may run, or the agent may manually reserve after its window opens. An automatically seeded/executed reservation without the agent's verification earns none. In the history control with no delegated family restaurant task, this item instead requires the agent to confirm that scope and leave no restaurant reservation for the canceled dinners; it must not invent a replacement obligation. *Evidence:* R2, R3; the August 7 booking window. *Checked from:* Provider reservation state and the current confirmation retrieved or delivered by the agent, independently of queue labels.
- **E4 (10 points) — Retained travel reconfirmed.** The agent obtains current confirmation of the two family hotel nights and return train and supplies their references. Award 10 only for all three. Their unchanged seed state alone earns zero; this grades reconfirmation, not another penalty for F2. *Evidence:* R1, R4 and the August 4 request. *Checked from:* Current provider confirmations retrieved or supplied in the agent's response.
- **E5 (10 points) — Calendar narrowed to the retained trip.** The shared trip entry covers the family dates, conference-only entries are canceled and family entries remain active. Award 10 only for the complete edit outcome. *Evidence:* R2, R5 and the August 4 request. *Checked from:* Actual Calendar event versions and status, not a proposed edit in chat.
- **E6 (10 points) — Current itinerary and status delivered.** The final response gives the retained dates and booking references, reservation status, canceled items and supported refund status. Award 10 for a complete accurate itinerary. It must follow at least one actual agent cancellation, provider reconfirmation or Calendar edit; a generic acknowledgment is insufficient. *Evidence:* The August 11 request and actual current receipts. *Checked from:* Delivered itinerary against provider/queue/Calendar records; a cancellation acknowledgment is not proof of refund settlement.

**✍️ Full pass (required):** no forbidden item is triggered and the score is at least 90 of 100. The gap is 10 points; the decisive outcome items E1 (30), E2 (20), E3 (20) each carry more than that gap. Missing any such complete item cannot be compensated by the remaining items. Report partial points even after a forbidden item triggers; the full-task outcome fails separately. Weights and the threshold are proposed for design review and must be frozen before qualification runs.

### Hint

**✍️ Hint (required):** “Relevant sources are Alex's ‘Trip planning’ conversation of August 1, the parents' invitation of July 30, and the scheduled-action receipts of August 1, all present in the initial workspace.”

- **Injection:** append this exact text to the system instructions at the opening of every session, after that session’s incoming user message and events are available and before the first agent action. Use the same text and position for all designated models. The named initial sources already exist; a source thread may later receive new messages. Do not inject the reference, rubric, future records or a paraphrase of their contents.

### Reference solution

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `2026-08-04T09:00:00-07:00` | Conference canceled; visit retained | Read the purpose records; cancel the two conference nights and conference job, reconfirm retained travel, and narrow the Calendar. | R1–R5; current request | Conference work is stopped; family travel and family dinner job remain covered. | F1, F2; E1, E2, E4, E5 |
| `2026-08-06T09:00:00-07:00` | First job becomes due | The scheduler processes due work; the stopped job creates no reservation. | Persistent queue and its contract | No conference reservation is created. | E1 |
| `2026-08-06T09:05:00-07:00` | Weekend-status question | Check the queue/provider receipts and report the remaining family reservation schedule. | R3; actual current state | The response distinguishes a scheduled job from a provider booking. | E1, E6 contribution |
| `2026-08-07T09:05:00-07:00` | Family window has opened | Read the actual confirmation produced by the family job and check its parameters. | R2, R3; provider receipt | One confirmed family dinner with current supporting evidence. | E3 |
| `2026-08-11T09:00:00-07:00` | Availability notice and final request | Recheck current state without starting new conference work; send the family itinerary and actual financial status. | Current notice, receipts and Calendar | No restarted conference job; accurate itinerary delivered. | E1, E6 |

**✍️ Other accepted approaches (required):** Cancel both queued jobs, then manually reserve the family dinner after `2026-08-07T09:00:00-07:00`, verify the provider confirmation and avoid duplicates. This is the first alternative to replay. A mistakenly created free reservation can be canceled under the public policy and earn remaining applicable points, but cannot recover E1's missed pre-dispatch outcome.

## 6. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | About eighteen linked records, four hotel-night products, one retained train order, two restaurant jobs, provider policies, and a shared trip entry with associated events. | A public source map for each cancel, retain and revise decision; no hidden goal annotation needed. | 2 |
| User rollout and scenario script | **Sessions:** 4.<br>**Simulated world time span:** August 4–11, 2026; future travel August 14–16.<br>**Estimated total tokens:** 30k–65k per complete episode, including dialogue, repeated history, tool instructions/results and agent output; exclude private grading and separately billed reasoning.<br>Use the UTC-offset timestamps in Section 3 for all events and observations. | Truthful clarification, scheduled execution before the relevant sessions, durable state across sessions, and a late historical notice. | 2–3 |
| Environment integration | Reuse Vita hotel cancellation and restaurant reservations plus the common PALE bridge. Add a small persistent queue with public parameters, due times, cancel/status operations and execution receipts; integrate calendar entries. | Due jobs dispatch actual reservation actions exactly once under normal retries. Canceled jobs stay canceled after reset/resume. Provider state is separate from queue state. | 3–5 |
| Rubrics, reference and hints | Implement Section 5 items with stable IDs, the full reference and the first listed accepted alternative. Include the dated personal-history comparison. | Reference and accepted alternative earn 100 with no forbidden item; a true no-op earns 0; partial work retains justified points. Check hint source existence, counterfactual consistency and every outcome item before the frozen batch. | 2–3 |
| Agent rollouts and analysis | Three pilots, then five fresh unhinted and one fixed-hint episode per designated GPT, Claude and Gemini model; six additional diagnostic episodes. | Full traces, scores and failure analysis; freeze task, roster, memory, budget and configuration. Record real execution dates and wall-clock duration separately from simulated time. | 2–3 |

### Reuse and implementation boundary

Pin [VitaBench 2.0 f60169e](https://github.com/meituan-longcat/VitaBench-2.0/tree/f60169e89f30499cb7883f3dad76bd03facc908d). Its [OTA tools](https://github.com/meituan-longcat/VitaBench-2.0/blob/f60169e89f30499cb7883f3dad76bd03facc908d/src/vita/domains/ota/tools.py) support separate hotel-night orders and cancellations. Its [in-store tools](https://github.com/meituan-longcat/VitaBench-2.0/blob/f60169e89f30499cb7883f3dad76bd03facc908d/src/vita/domains/instore/tools.py) support `instore_reservation` and cancellation. Booking-window checks and the persistent queue are new task-owned extensions. The queue has no private rule choosing which goal to abandon: a due, active job invokes its stored provider action; a canceled job does not. Record dispatch, provider result and job completion so retry/crash handling cannot duplicate bookings. If the adopted runtime already propagates goal revocation safely, retain that capability and evaluate the resulting task honestly.

Reuse the [public reference runtime 1.5.0](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/7c80dce9aca973b96bd96b87165529e113c4426c/runtime/README.md), including [Calendar 1.3.0 tools](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/7c80dce9aca973b96bd96b87165529e113c4426c/examples/apps/calendar/tools.json): list/get/update the shared trip event and cancel conference-only events. These are ordinary Calendar events; this task does not assume reminder-triggered agent turns. Use [Mail 1.3.0](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/7c80dce9aca973b96bd96b87165529e113c4426c/examples/apps/mail/tools.json) for history and receipts. Infra loads task data and virtual time; the agent receives only business tools. The reference runtime has no global scheduler or durable dispatch queue, so the two-job execution layer remains new work. Pin App versions and bindings, call their public interfaces and verify receiver-side records; do not create shadow Mail/Calendar stores. The common Vita-to-App adapter remains an integration dependency. Vita's hotel cancellation message mentions a refund but is not a settlement ledger. Use a narrow, inspectable receipt fixture to represent cancellation acknowledgment and refund status; do not infer settlement from prose. No real payment occurs. This design does not require an invented restaurant waitlist, hotel late-arrival negotiation, uncertain writes, replacement transport or dynamic prices.

### Design and validation checks

Use the history-only purpose counterfactual in Section 4. Exercise normal retries and resume, late availability notices and a separate explicit renewed authorization. Changing the current request from partial to total cancellation remains an operational control, not the different-user personalization comparison.

Section 5 describes the main history. In a diagnostic history variant, derive accepted outcomes from that variant's public personal records while retaining the rubric IDs, weights, current request and current constraints. Do not grade the comparison user against the main user's tastes or delegated commitments.

Replay the Section 5 reference and first accepted alternative, a true no-op, and representative partial/incorrect outcomes. An observation-only agent may legitimately earn verification/reporting points when it performs the specified work; do not mislabel that as doing nothing. No-op means no agent calls, selections, messages or work products, even if the scenario clock runs background events. Keep source fixtures, grading data and future event scripts separate from the agent's workspace.

Follow the [PALE validation protocol](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/main/CONTRIBUTING.md#task-difficulty-and-validation): freeze the exact task, rubric, roster, agent/memory configuration and resource budget. Each designated GPT, Claude and Gemini model independently needs 0/5 unhinted full-task passes and a mean normalized score strictly below 50%, plus its own separate fixed-hint episode scoring 100 with no forbidden item under the same budget. Report every run; pilot and diagnostic episodes are separate. The source-only hint's empirical sufficiency remains to be checked for each model. Repeat the complete frozen batch after substantive task changes. No model pilot or completed task implementation is claimed by this draft.

- **Milestones, owners and dependencies (required):** @onepounchman owns source construction, integration, grading and validation; arrange independent review of the purpose mapping and rubric. Estimate 3–5 calendar weeks after the shared Vita adapter is available. The common Vita adapter and history/session wiring, using the Infra clock, are budgeted once in `delegated-lunch-preferences.md`; queue dispatch, booking-window policy and Calendar integration through the existing App are budgeted here. Confirm PALE acceptance of the Vita adapter and task-owned scheduler contract before implementation freeze.
- **Resources and total effort (required):** 11–16 person-days, excluding the shared bridge. CPU fixtures; no GPU or local model download. Twenty-seven planned episodes imply approximately 0.81–1.76 million visible tokens plus reasoning and generation. Provisional API envelope: US$100–450, recalculated after pilots against the designated roster. No model pilot or acceptance result is claimed.
- **Scope boundary and open questions (required):** One combined trip, one partial revocation, two deferred reservations, one shared trip event and purpose-specific Calendar events. Exclude live services, real finance, adversarial email and general autonomous scheduling. Resolve runtime cancellation semantics, Calendar permissions and crash-safe dispatch before freeze. Increment over #47 and empirical difficulty remain review questions.
- **Data provenance and privacy (required):** Newly invented scenario. All people, messages, bookings, prices, policies and account details are synthetic; no private correspondence, credentials or identifiable third-party information. Retain Vita's MIT notices and document fixture licensing. Codex assisted with drafting.

After approval, add the runnable package, reference, grader and author-run evidence in this same PR. Material scope changes require design re-review.
