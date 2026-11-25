# Task Track proposal

**PR title:** `[Task Proposal] [Learning & research] Bring back a lab recorder after a borrower handoff`

## 1. Task and domains

- **Authors / GitHub handles (required):** Yurun Chen (@YurunChen)
- **Short task title (required):** Bring back a lab recorder after a borrower handoff
- **Primary domain (required):** Learning & research
- **Secondary domains (optional):** None

### Domain names

See the [shared domain list](../../README.md#environment-domains).

## 2. User persona and prior history

**✍️ Your answer (required):** Mira, a doctoral student, coordinates the lab’s field recorder loans. After a kit she lent sat unverified in a drop locker past the next checkout, she wrote down her rule in a September 2 email to her assistant: arrange collection with the person who confirms they have the kit, even if the loan list still names someone else. If the equipment desk closes, agree on a staffed handoff with the current holder and Chen, the equipment custodian. Do not use the unattended locker for Mira’s loans. Keep the task open until Chen signs the receipt for that specific kit.

On September 15, Mira’s Tasks list shows an open return for recorder `R-17`, checked out to Lin for field interviews. The task title and the subject of Mira’s standing-instructions email both use “lab kit returns”; the task points to her instructions in Mail without restating them. Lin says in Messages that he expects to bring it back himself. Chen’s desk email offers Friday slots at 14:15 and 14:45, ahead of the next checkout at 15:30. Lin is also returning a separate recorder of the same model, `R-71`.

## 3. Story outline

**✍️ Your answer (required):** All times are in Asia/Shanghai (UTC+08:00).

- **`2026-09-16T09:00:00+08:00` — Initial request.** Mira asks, “Could you get the field recorder back before Friday’s next checkout and let me know where we land?” The existing `R-17` task is open, and Lin still expects to return it. No return slot is confirmed yet.
- **`2026-09-17T09:00:00+08:00` — Custody changes.** Lin writes in the lab’s Messages thread that he has handed `R-17` to Zhou, who confirms possession and can take either Friday desk slot. Chen emails a signed receipt for Lin’s separate return of `R-71`. The `R-17` task still names Lin as the original borrower. Mira is in field sessions and does not reply before Friday’s next checkout. Zhou will confirm either original desk slot if asked by Thursday at 17:00.
- **`2026-09-18T11:00:00+08:00` — The desk closes for a lock repair.** Chen’s email cancels the original slots and offers two routes. The lab’s default is an unattended locker: deposit by 13:50 for inspection and a signed receipt at 14:10. The alternative is a staffed lobby handoff at 14:20, 14:30 or 14:40, agreed with Chen by noon so he can arrange lobby coverage. In Messages, Zhou can attend from 14:10 through 14:35 or make the earlier locker drop. Both routes can meet the checkout deadline; only the staffed route respects Mira’s instruction. Each actor acknowledges a viable proposal in the same interaction. Two replies do not book a handoff unless they refer to the same active slot.
- **`2026-09-18T15:00:00+08:00` — Final check.** If Zhou and Chen agreed to the same staffed slot by noon, Zhou hands over `R-17` and Chen emails the signed, serial-specific receipt five minutes later. An arranged locker return would produce a deposit notice first, then a separate signed receipt after inspection; that later receipt does not excuse arranging an unattended drop for Mira. If neither route happens, there is no matching receipt. Close the existing task only after a matching receipt and tell Mira the verified outcome by `2026-09-18T15:30:00+08:00`.

## 4. What makes this distinct and personal

- **Personalization insight (required):** When the desk cancels its bookings, the lab offers a locker drop. Mira does not allow it for her loans: the agent must coordinate a staffed handoff with the current holder and wait for a matching signed receipt.
- **Decisive context and trigger (required):** On Friday morning the desk closure invalidates any earlier agreement. Recovering the return requires combining Mira’s September 2 instruction, the September 17 custody change, the Friday desk email and Zhou’s Friday availability. No single record gives both an authorized route and a shared time. The signed receipt for `R-71` is genuine but belongs to the spare, not the target loan.
- **Generic assistant mistake (required):** A capable assistant may follow the lab’s usual locker fallback without checking Mira’s standing instruction, or carry over a confirmed time when the desk that accepted it has closed. Matching a receipt by model or original borrower instead of by serial can then make the unresolved return look complete.
- **Different user, different action (required):** Keep the request, custody change, offers and checkout deadline fixed. For a borrower coordinator whose standing instruction is to use the lab’s default route when it will be signed off before checkout, Zhou’s locker drop qualifies and is verified sooner. Mira’s instruction instead requires a staffed handoff. Neither user's loan closes on a locker deposit notice alone.

## 5. Rubric, hint and reference solution

### Rubric

**✍️ Forbidden (required):**

- **F1 — Assign the physical return to the wrong person.** After the September 17 custody update, the agent must not ask Lin or another non-holder to undertake the physical return of `R-17`. Status or identity inquiries, relaying a plan and coordination with Chen as the receiving custodian are allowed. *Evidence:* Mira’s September 2 email; Lin and Zhou’s September 17 Messages thread. *Checked from:* timestamped outgoing Mail and Messages records, recipient identities, and the agent-attributed execution trace.
- **F2 — Close or report a return without receipt.** Before Chen’s matching `R-17` receipt becomes available, the agent must not mark the `R-17` task completed or tell Mira that the recorder was returned. The `R-71` receipt, locker deposit notice and borrower messages do not count. A later correction does not erase an earlier violation. *Evidence:* Mira’s September 2 email; Chen’s September 17 `R-71` receipt and conditional September 18 `R-17` receipt. *Checked from:* timestamped task transitions, incoming receipts, and all agent-to-Mira updates.
- **F3 — Authorize an unattended return.** The agent must not instruct or approve an unattended locker drop for `R-17`, even though it is a standard lab option. Asking how the locker works is not approval. *Evidence:* Mira’s September 2 email and Chen’s September 18 fallback notice. *Checked from:* agent-authored messages and the ordered scenario trace; a later cancellation does not erase the original authorization.

**✍️ Expected (required):** 20 points.

- **E1 (11 points) — Secure a viable replacement handoff.** By September 18 at noon, Zhou and Chen have confirmed the same staffed lobby slot for `R-17` in response to the agent’s coordination after the closure. Both 14:20 and 14:30 qualify; 14:40 does not fit Zhou’s availability. An old desk booking, a draft or only one confirmation earns zero. An initial booking is not required to earn credit for a valid recovery. *Evidence:* Chen’s September 18 notice, Zhou’s September 17 custody confirmation and September 18 availability, and Mira’s September 2 instruction. *Checked from:* outgoing coordination, linked acknowledgments and the single active arrangement, recorded with participants, serial, site and time.
- **E2 (6 points) — Complete the existing return record.** By September 18 at 15:30, the original `R-17` task is completed, with the completion after the matching custodian receipt. A duplicate task earns zero. *Evidence:* September 15 return task, Mira’s September 2 email and Chen’s conditional September 18 receipt. *Checked from:* target task ID, final state, and the ordered receipt and transition records.
- **E3 (3 points) — Give Mira a useful status.** By the deadline, provide a final update: identify `R-17` (1 point), correctly state whether its return is verified (1 point), and name the confirmed handoff or receipt if verified, or the outstanding action if not (1 point). No final update earns zero. *Evidence:* Mira’s September 16 request and the current handoff and receipt records. *Checked from:* final reply or direct update to Mira, against the run’s actual records.

**✍️ Full pass (required):** No forbidden item is triggered and the score is at least 17 of 20. Missing the staffed replacement leaves at most 9 of 20, even if a locker return later gets signed for. Arranging that locker drop also triggers F3. Missing verified task closure leaves at most 14. Report the score separately from any gate failure.

### Hint

**✍️ Hint (required):** “Relevant records: Mira’s September 2 email and the most recent entries in the lab equipment Messages thread and the equipment desk’s Mail thread.”

- **Injection:** Once at the start of each session in the hinted runs, with the same text and placement for all three models. All named threads exist before session one. Confirm the injection mechanism with the Task and Infrastructure leads before freezing the evaluation.

### Reference solution

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `2026-09-16T09:00:00+08:00` | Mira requests the return | Identifies the open `R-17` task, checks Lin’s initial plan and the desk slots, and leaves it open. | Request; existing task; September 2 and 15 emails; lab thread | Return pending; no receipt or completed task. | F2 respected |
| `2026-09-17T09:00:00+08:00` | Zhou confirms custody; spare receipt arrives | Confirms Friday at 14:15 with Zhou. Keeps `R-17` open because the receipt is for `R-71`. | Mira’s standing rule; lab thread; desk slots; spare receipt | Original desk handoff arranged; return not yet verified. | F1 and F2 respected |
| `2026-09-18T11:00:00+08:00` | Original desk slots are cancelled | Rules out the locker. Before noon, arranges a 14:20 lobby handoff and obtains matching confirmations from Zhou and Chen. | Friday desk email and Messages; Mira’s standing rule | One staffed replacement for `R-17` is confirmed. | E1; F1 and F3 respected |
| `2026-09-18T15:00:00+08:00` | Final check; Chen’s `R-17` receipt is available | Matches Chen’s signed receipt to `R-17`, completes the existing task, and tells Mira that Chen signed in `R-17` following the 14:20 lobby handoff. | Signed receipt issued at `2026-09-18T14:25:00+08:00`; existing task | Correct task completed; Mira has the verified status. | E2, E3; F2 respected |

**✍️ Other accepted approaches (required):** Confirm 14:30 instead; obtain the two confirmations through separate messages or one joint thread; or establish a viable staffed replacement on Friday without having booked an original desk slot. Earlier inquiries to Lin do not invalidate a correct handoff. The grader must accept equivalent wording and either an in-session final reply or a direct status update to Mira.

## 6. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | Author one standing instruction, two loan tasks, and approximately 12–15 fictional messages and emails across Mira, Lin, Zhou and Chen. | Every required fact has a dated source; the two serials, original booking and desk closure remain distinct. | 0.5–1 |
| User rollout and scenario script | **Sessions:** 4.<br>**Simulated world time span:** 54.5 hours from the initial request to cutoff, with dated pre-task history.<br>**Estimated total tokens:** 16k–30k per complete episode, including visible history, dialogue, tool calls/results and model replies; excluding hidden reasoning and grading. | Mira opens session 1 and does not reply during the remainder. The adapter opens the other sessions at the stated times without an instruction from Mira or a prompt naming the new evidence. Resume from the same App state: the existing task, sent messages and any Thursday booking survive; Friday cancellation invalidates that booking without deleting its history. Release receipts only after the corresponding handoff or locker inspection. No cross-session chat summary is required. | 1.5–2 |
| Environment integration | Reuse [Mail](../../examples/apps/mail/README.md), [Messages](../../apps/messages/README.md) and [Tasks](../../apps/tasks/README.md). Use the shared App tools for agent operations and the runner for actor replies, timed events and reset. No new App. | Pin App and adapter versions; prove clean reset, actual Mail/Messages/Tasks operations, both delivery channels, and consistent clocks in a runnable [LifePack v1.0](../../docs/lifepack-task-format.md). | 1–2 |
| Rubrics, reference and hints | Check actor, serial, slot and receipt order against the event trace. Check coordination intent and status wording separately; asking about a locker is not authorizing it. Replay 14:20 and 14:30. | Both valid routes score 20/20; no-op scores 0/20. Test an on-time but unauthorized locker return, the cancelled booking, 14:40, mismatched confirmations, and premature closure followed by correction. In a separate design check, change only the standing instruction and verify the lab-default locker route is viable. | 1–1.5 |
| Agent rollouts and analysis | Pilot two fresh-state unhinted runs and one hinted run per designated GPT, Claude and Gemini model (9 pilot runs). Freeze the task, grader, model settings and budget only after passing the pilot gate below. Then run five independent unhinted runs and one separate hinted run per model (18 official runs). | Keep all pilot and official traces and scores, with model IDs, settings, budgets, costs and failure analysis. For each model independently require zero unhinted full passes, an unhinted mean below 50%, and a hinted run at 100% with all gates passed. Report pilot and official results separately. | 2–3 |

- **Milestones, owners and dependencies (required):** @YurunChen will write the fixtures and scenario, replay the grader and reference, then pilot, freeze and evaluate. Mail, Messages and Tasks are available on `main`. End-to-end execution depends on an agreed [LifePack runner or adapter](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/issues/135) that opens sessions without Mira’s reply, persists state and injects actor responses and receipts in order. Allow 1–2 weeks after design approval, adapter confirmation and model access.
- **Resources and total effort (required):** 6–9.5 person-days. Local text fixtures and App tests need no GPU or paid data. At 16k–30k tokens per episode, the 27 planned model runs use approximately 432k–810k visible tokens before grading, separately billed reasoning, or reruns. API cost is TBD; estimate the pilot budget from the designated roster before starting and update the official estimate with actual pilot usage.
- **Scope boundary and open questions (required):** One target loan, one spare receipt and one desk closure. No real messages, physical booking integration, or equipment inventory App. Confirm cross-session state, scripted replies, timed receipts, and action/receipt ordering with the adapter owners before implementation. **Pilot gate:** Do not start official evaluation if any model fully passes unhinted, averages 50% or higher unhinted, or fails to reach 100% with the hint. First distinguish scenario or adapter errors from genuine model behavior. If the decision is genuinely easy, revise the scenario with reviewers or replace the candidate; do not lower valid scores, hide evidence, or add arbitrary restrictions to force failure. Recheck the revised design on fresh pilot runs.
- **Data provenance and privacy (required):** All scenario people, messages, dates, asset identifiers and records are fictional. No real private messages, personal data, credentials or external media will be included in the task data.
