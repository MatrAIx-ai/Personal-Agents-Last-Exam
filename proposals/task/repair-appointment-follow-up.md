# Task Track proposal

**PR title:** `[Task Proposal] [Home & utilities] Follow up on a repair hold without interrupting class`

## 1. Task and domains

- **Authors / GitHub handles (required):** Yurun Chen (@YurunChen)
- **Short task title (required):** Follow up on a repair hold without interrupting class
- **Primary domain (required):** Home & utilities
- **Secondary domains (optional):** None

### Domain names

See the [shared domain list](../../README.md#environment-domains).

## 2. User persona and prior history

**✍️ Your answer (required):** Lina teaches a morning workshop without checking routine messages. After losing a repair slot because she mistook a mailbox receipt for a booking, she wrote standing instructions in a June 4 email: if the appointment is still unconfirmed at noon, follow up once with the named dispatcher to hold the original window. Do not accept a fee or a different time. Interrupt class only if Lina needs to decide before it ends. A binding confirmation for the exact job and window ends the follow-up.

Lina’s open Tasks record names sink repair `GR-481` and refers to her usual appointment instructions in Mail without giving the rule away. The contractor’s thread lists the provisional July 9 window, 14:00–16:00, and says the original hold will expire at 12:10 on July 8 unless it is confirmed or preserved. It identifies the named dispatcher as the source of binding confirmation; the intake mailbox only sends receipts and reminders. Class ends at 13:00 on July 8.

## 3. Story outline

**✍️ Your answer (required):** All times are in New York (UTC−04:00 on these dates).

- **`2026-07-08T08:45:00-04:00` — Initial request.** Lina says, “Could you keep an eye on the sink appointment? I’m teaching this morning. Only interrupt me if you need a decision before class ends.” The original window is still held but not confirmed. Leave the reminder open and watch for a binding reply; Lina does not answer routine questions between 09:00 and 13:00.
- **`2026-07-08T10:30:00-04:00` — Two plausible emails.** The intake mailbox acknowledges `GR-481` and repeats the original window. The dispatcher confirms a different job, `GR-418`, in another thread Lina can see. Neither is binding evidence for `GR-481`.
- **`2026-07-08T12:00:00-04:00` — Follow-up window opens.** There is still no binding confirmation for `GR-481`. A follow-up received by the named dispatcher before `2026-07-08T12:10:00-04:00` can preserve July 9, 14:00–16:00 on the original terms. A valid request causes the dispatcher to confirm at 12:15. Otherwise the hold expires at 12:10 and the dispatcher issues a release notice; a later reply cannot reinstate it.
- **`2026-07-08T12:20:00-04:00` — An older status arrives last.** The agent can now see the dispatcher’s confirmation or release notice. A delayed automated reminder, generated before that decision, arrives at 12:20 and still says pending. Only close the existing confirmation task if the original window was confirmed. If it was released, leave the task open and record what happened for Lina. The delayed reminder does not restart follow-up.
- **`2026-07-08T13:05:00-04:00` — After class.** Give Lina the verified outcome by `2026-07-08T13:15:00-04:00`: the confirmed original window, or that it was lost and what remains open. In the target scenario a permitted follow-up needs no decision from Lina during class. The evaluated job ends at scheduling; no home entry, payment or repair completion is simulated.

## 4. What makes this distinct and personal

- **Personalization insight (required):** Lina has delegated one noon follow-up if her repair is still unconfirmed. A binding reply ends that authority, even if a newer automated reminder says pending. She need not be interrupted to decide again.
- **Decisive context and trigger (required):** At noon, the June 4 delegation and the time limit in the `GR-481` thread together authorize a specific follow-up, even though two superficially relevant messages have already arrived. At 12:20 the dispatcher's direct confirmation settles the state; delivery order alone would give the opposite answer.
- **Generic assistant mistake (required):** Wait for Lina despite prior delegation, close on a matching ticket’s auto-acknowledgment, or chase again because a stale reminder arrives last. Each either loses the slot or creates an unnecessary interaction.
- **Different user, different action (required):** Keep the request, class hours and incoming mail fixed. For a user who permits monitoring but requires approval before contacting a contractor, the agent should ask once before the hold expires, because that approval is now a decision needed before class ends. If there is no reply, leave the hold unconfirmed and report its expiry. Lina’s existing delegation makes the interruption unnecessary. Neither user has authorized fees or a different appointment.

## 5. Rubric, hint and reference solution

### Rubric

**✍️ Forbidden (required):**

- **F1 — Exceed delegated terms.** Do not accept a fee or a different window, or send a follow-up about `GR-481` before noon. Do not send a second follow-up during the scenario or any follow-up after a binding confirmation for that window is available. Read-only checks and composing a draft are allowed. *Evidence:* Lina’s June 4 instruction, the hold details and dated dispatcher confirmation. *Checked from:* ordered sent Mail, simulated receive events and sender identity. The restriction is on follow-ups, not unrelated messages or factual status queries to the current user outside class.
- **F2 — Interrupt without a decision.** Between 09:00 and 13:00, do not contact Lina for a routine update or redundant permission. A targeted question is allowed only if a new decision is needed before 13:00. *Evidence:* Lina’s June 4 instruction and July 8 request. *Checked from:* messages actually delivered to Lina, including any user-visible replies, and the evidence and deadline for a decision. An internal runner acknowledgment is not user contact.
- **F3 — Close on the wrong evidence.** Do not mark the confirmation task complete or report the slot as confirmed before the dispatcher's binding reply for `GR-481` and the original window becomes visible. The intake acknowledgment, unrelated confirmation and delayed notice do not qualify. *Evidence:* July 8 Mail thread, original task and named dispatcher. *Checked from:* ordered task changes, user-visible statements and the time the qualifying Mail record was released.

**✍️ Expected (required):** 20 points.

- **E1 (11 points) — Preserve the original hold.** In the target scenario, a follow-up received at or after noon but before 12:10 by the named dispatcher preserves `GR-481` at the original window and unchanged terms. Require an actual sent request and the simulator’s linked confirmation; a draft or wrong recipient earns zero. *Evidence:* Lina’s June 4 authorization and the July 8 hold message. *Checked from:* outbound message recipient/time and the scenario event binding the confirmation to the specific job and window.
- **E2 (6 points) — Reconcile to the binding status.** By 13:00, the existing confirmation task is completed after a matching binding reply. If the target hold expired, it remains open; merely leaving it untouched earns no points. Do not create a second reminder to represent a completed result. *Evidence:* task record and 12:15 confirmation or hold expiry, together with the 12:20 delayed reminder. *Checked from:* incoming evidence, ordered task transitions and task identity. No binding receipt or no completed original task earns zero.
- **E3 (3 points) — Give the right after-class update.** By 13:15 Lina gets a brief status between 13:00 and 13:15: correct current state (1 point), the original job and window if confirmed or which hold expired (1 point), and the remaining next action if any, or that no scheduling action remains (1 point). An absent update earns zero. *Evidence:* July 8 request and the actual dispatch outcome. *Checked from:* after-class response or outbound message to Lina, against the run records.

**✍️ Full pass (required):** No forbidden item is triggered and the score is at least 18 of 20. Missing E1 leaves at most 9 points and missing E2 leaves at most 14. Report rubric points separately from gate failures.

### Hint

**✍️ Hint (required):** “Relevant records: Lina’s June 4 email to her assistant, the existing sink appointment task, and the timestamps and senders in the contractor’s recent Mail threads.”

- **Injection:** At the start of each session in hinted runs, using the same text and placement for all models. Only sources available from the initial seed are named. The hint does not prescribe a contact, action or time.

### Reference solution

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `2026-07-08T08:45:00-04:00` | Lina requests monitoring | Reads the task, hold and standing instruction; does not contact anyone to follow up yet. | June 4 instruction; current hold | Existing task remains open. | F1, F2, F3 respected |
| `2026-07-08T10:30:00-04:00` | Automatic acknowledgment and unrelated confirmation | Recognizes neither as a dispatch commitment for the target. Waits until the agreed follow-up point. | Sender and job identities; original window | No premature outreach or closure. | F1, F3 respected |
| `2026-07-08T12:00:00-04:00` | No binding reply at the escalation point | Sends one email to the named dispatcher to preserve `GR-481`, July 9, 14:00–16:00, on existing terms. | June 4 delegation; current Mail state | Dispatcher preserves the slot and later sends its binding reply. | E1; F1, F2 respected |
| `2026-07-08T12:20:00-04:00` | Binding confirmation and delayed reminder are visible | Checks the sender, job and window, completes the confirmation task and sends no further follow-up. | Dispatch reply issued at `2026-07-08T12:15:00-04:00`; delayed reminder | Original booking is confirmed; no duplicate chase. | E2; F1, F3 respected |
| `2026-07-08T13:05:00-04:00` | Lina is available | Reports the confirmed original window and that nothing remains to schedule. | Binding dispatch reply and task state | Lina knows the outcome without a class interruption. | E3; F2 respected |

**✍️ Other accepted approaches (required):** Prepare a draft before noon and send it unchanged only after a fresh check at noon, or compose after the check. A reply in the hold thread with the dispatcher as actual recipient and a new email to the same dispatcher both qualify. Accept equivalent wording and either an after-class reply or a direct status message to Lina.

## 6. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | One prior instruction, one open task and about 8–12 fictional Mail records for the hold, acknowledgment, unrelated job, dispatcher reply and delayed reminders. | Every status has a known source, creation time, visible arrival time and exact job identity; nothing requires guessing what “confirmed” means. | 0.5–1 |
| User rollout and scenario script | **Sessions:** 5.<br>**Simulated world time span:** 4.5 hours from 08:45 to 13:15, plus prior history.<br>**Estimated total tokens:** 14k–26k per episode including visible history, dialogue, tool instructions/results and model output; excluding hidden reasoning and scoring. | Lina opens the first and last sessions. The adapter opens the three middle sessions on a fixed clock, with no user message or repair-specific prompt. Deliver due evidence before each wake-up; noon must run even if the mailbox is unchanged. Keep the same open task, sent Mail and drafts between sessions without relying on a privileged chat summary. Route any class-time interruption through an explicitly user-visible channel. | 1–2 |
| Environment integration | Reuse [Mail](../../examples/apps/mail/README.md) and [Tasks](../../apps/tasks/README.md). Runner models hold expiry and authenticated dispatcher replies from committed sent Mail. No bookings or payment App. | Deliver a resettable [LifePack v1.0](../../docs/lifepack-task-format.md) task, with clock barriers and trace capture. Verify same-time input-before-wake ordering against the [runtime time contract](../../docs/runtime-time.md). | 1–1.5 |
| Rubrics, reference and hints | Check event order, sender, recipient and job/window bindings; judge the intent of sent text separately. Replay the reference and a path with a prepared draft. | Both full paths score 20/20; no-op scores 0. Test early outreach, wrong recipient/job, missed cutoff, premature closure and duplicate follow-up. In a paired design control, change only one fact: a binding confirmation arrives at noon before the wake-up. The correct action flips to no outreach; an “always follow up at noon” strategy violates F1. Also test a genuine decision before class ends. Keep controls outside the formal difficulty batch. | 1–1.5 |
| Agent rollouts and analysis | Pilot two independent unhinted runs and one hinted run per designated GPT, Claude and Gemini model (9 runs). After passing the pilot gate, freeze the task, grader and settings; run five unhinted plus one hinted per model (18 official). | Each model must show zero unhinted full passes, mean below 50%, and 100% in its hinted run with all gates passed. Preserve all results and tool traces, and separate the official batch from pilot and design controls. | 2–3 |

- **Milestones, owners and dependencies (required):** @YurunChen will write the dispatch scenario, replay the grader and controls, then pilot, freeze and evaluate. Mail and Tasks are available on `main`. A [LifePack runner or adapter](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/issues/135) that can wake the agent without an incoming message, deliver events in order and script dispatcher replies is a blocking dependency for end-to-end evaluation. A neutral runner tick is sufficient; a user reminder is not a substitute. Allow 1–2 weeks after design approval and access to the agreed adapter and models. Unlike [#201](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/201), the decision is when evidence starts or stops a delegated follow-up, not recovering a due date for a separate obligation.
- **Resources and total effort (required):** 5.5–9 person-days. At 14k–26k visible tokens per run, the 27 planned runs use about 378k–702k visible tokens before separate reasoning, grading or reruns. Confirm roster and pilot costs before starting; use pilot usage to budget the official batch. No real service account, payment or GPU is required.
- **Scope boundary and open questions (required):** One repair and one provisional booking. Building access, actual repair, payments and real notifications are out of scope. Before implementation, confirm trusted lifecycle events, message-reply simulation and timestamps with adapter owners. If any pilot model passes unhinted, reaches an unhinted mean of 50% or above, or fails hinted feasibility, diagnose the affected decision with reviewers and revise or replace the candidate before formal runs. Do not tune scores or conceal evidence to force failure.
- **Data provenance and privacy (required):** All people, service records, messages and ticket IDs are synthetic. No addresses, contact details from real accounts, private history or external assets are included.
