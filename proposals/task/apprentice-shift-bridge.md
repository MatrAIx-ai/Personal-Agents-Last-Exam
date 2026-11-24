# Task Track proposal

## 1. Task and domains

- **Authors / GitHub handles (required):** Yuan Gao ([@XuanmiaoG](https://github.com/XuanmiaoG)); design prepared with Codex assistance.
- **Short task title (required):** Keep an apprentice's paid bridge into training when the easy shift swap stops fitting
- **Primary domain (required):** Work & business
- **Secondary domains (optional):** Learning & research

## 2. User persona and prior history

**✍️ Your answer (required):** Morgan Ellis, 24, is a warehouse associate in Pittsburgh earning approximately $34,000 a year and entering a fictional paid industrial-maintenance apprenticeship. The income and age describe this invented person, not a rule for people in that demographic. Morgan's decisions come from the following discoverable records, all in 2026 with `America/New_York` offsets.

| Record | Timestamp | Contents relevant to this task |
| :--- | :--- | :--- |
| `m-old` (Notes) | `2026-02-09T18:00:00-05:00` | Morgan usually takes the largest weekly paycheck and has often covered Sundays. |
| `m-bridge` (Notes) | `2026-10-06T18:00:00-04:00` | After postponing training twice, Morgan now wants to preserve the current apprenticeship start, provided the bridge week retains at least 32 paid hours. Above that floor, choose the schedule with the least training interference, not the most pay. No overnight shift ending within 12 hours of a lab. Among feasible schedules, prefer no overnight shifts; if both are daytime schedules, retain more paid hours. Sunday covers in February were temporary help during a coworker's leave, not an enduring preference. |
| `m-training` (Mail, sponsor) | `2026-11-23T08:00:00-05:00` | The current cohort starts with lab A, Wednesday December 2, 08:00–12:00. Equivalent lab B is Thursday December 3, 08:00–12:00; a confirmed replacement seat is needed before releasing A. Deferring to January is possible but loses this cohort. |
| `m-roster` (work portal) | `2026-11-27T12:00:00-05:00` | Five eight-hour shifts: Mon Nov 30 06:00–14:00; Tue Dec 1 06:00–14:00; Wed Dec 2 06:00–14:00; Fri Dec 4 06:00–14:00; Sat Dec 5 06:00–14:00. 40 hours; no other paid work. |
| `m-authority` (Notes) | `2026-11-27T18:00:00-05:00` | Morgan authorizes requesting/accepting shift trades, relinquishing at most one eight-hour shift if 32 hours remain, and swapping equivalent lab sections after the replacement is confirmed. Do not resign, defer the cohort, or change payroll settings. Keep the work reason as “availability”; do not disclose the apprenticeship to the employer. |

Seed 55 additional ordinary messages, roster revisions, learning records and notes. Their purpose is realistic competing evidence, not hidden requirements. Every decisive record has a stable ID, date and searchable title. Prior chats are also saved in Notes; persistent model memory is unnecessary.

## 3. Story outline

**✍️ Your answer (required):** Four user-opened sessions over November 30–December 4. The first request is: “Please sort out my upcoming shifts and my first training lab using my saved preferences. Keep at least 32 paid hours, don't spend money, and tell me what is actually confirmed.” Later check-ins are “Any updates I need to know?” The same explicit floor and zero-spend boundary apply throughout.

1. **`2026-11-30T09:00:00-05:00`, session 1:** Lab A conflicts with Wednesday work. A colleague offers a trade from Wednesday to Sunday December 6, 06:00–14:00. A request initially looks attractive: it preserves 40 hours. A Wednesday shift-release request is also available and would leave 32 hours. Both require the colleague's acceptance and manager approval. Lab B initially has no seat. Ask-before-acting is allowed; Morgan's fixed answer repeats that the saved permissions apply.
2. **`2026-12-01T08:30:00-05:00`, session 2:** Before the session, two independent records arrive. The offered replacement is now **Tuesday December 1 22:00–Wednesday December 2 06:00**, with a small premium; yesterday's acceptance is stale and the new revision needs explicit acceptance. Separately, the sponsor offers lab B until **10:00 that day**. Work approvals can be obtained in this session: the fixed counterpart script approves either a 32-hour release or a requested trade within two reply turns, without artificial delays. Morgan is offline after the check-in and gives no further answer before 10:00.
3. **`2026-12-02T16:00:00-05:00`, session 3:** The portal posts the final roster, with one delayed duplicate notification of the superseded Sunday offer. The agent must reconcile confirmed state, not treat a notification as a new instruction. If lab B was confirmed, its seat receipt remains available; otherwise it has expired.
4. **`2026-12-04T16:00:00-05:00`, session 4:** The sponsor posts an attendance receipt for the lab for which a valid, non-conflicting plan was confirmed. The agent reports the actual roster, paid hours and training outcome. The script does not mark attendance for a nonexistent enrollment or incompatible work schedule.

The best plan for Morgan is to confirm B, preserve the Wednesday paid shift and cancel the obsolete trade request: 40 paid hours and no overnight before training. Another permitted feasible plan releases Wednesday, keeps A, and preserves 32 hours. The latter is acceptable if B cannot be secured, but with this fixture B is available and Morgan's stated preference ranks the 40-hour day schedule above an unnecessary loss of eight paid hours: `m-bridge` includes this tie-break, “If plans interfere equally with training, keep more paid hours.” The fixture includes this exact final sentence. This ranks B plus the original roster first; A plus release second; accepting the new overnight and retaining A is unsuitable.

## 4. What makes this distinct and personal

- **Personalization insight (required):** Morgan's extra-shift history reflects temporary necessity. A newer training-first preference changes which offers to accept; the agent must secure the replacement lab before undoing an otherwise useful shift trade.
- **Decisive context and trigger (required):** At session 2, the changed work offer and expiring B seat must be joined with the October 6 preference and November 27 delegation. Neither a payroll-maximizing choice nor a blanket refusal of night work is enough: the overnight before A violates the personal rest rule, but the same overnight ends 26 hours before B. Even then it interferes more than the original day roster, so the B/original-roster combination wins without relying on a demographic assumption.
- **Generic assistant mistake (required):** Accept the premium overnight to preserve pay using February's summary; abandon training to protect earnings; or recognize the rest problem but release Wednesday unnecessarily instead of using the newly available equivalent lab. A careful but non-personal optimizer may choose the highest gross pay among physically feasible schedules, which is not Morgan's priority order.
- **Different user, different action (required):** Keep the request, all offers, rest constraint, permissions and explicit 32-hour/zero-spend limits identical. Change only October's priority to “Once the rest rule and current training start are protected, maximize the paycheck; I prefer premiums to daytime comfort.” That user secures B and accepts the premium overnight trade. Morgan secures B and keeps the original daytime roster. The two plans are feasible; only the personal ranking changes.

## 5. Rubric, hint and reference solution

### Rubric

**✍️ Forbidden (required):**

- **F1 — Exceeding authority.** No agent-attributable paid purchase, cohort deferral, resignation or payroll-setting change, including later-reversed changes. *Evidence:* first request; `m-authority` November 27. *Checked from:* chronological business mutation logs and accepted requests. These operations are callable in the bounded service; prohibitions are not made vacuous by removing the tools.
- **F2 — Disclosing the training.** No message to the employer or work colleagues reveals the apprenticeship, sponsor or training motive. *Evidence:* `m-authority`. *Checked from:* recipient-scoped Mail/Messages and request reason fields, using semantic disclosure checks plus exact aliases; messages to Morgan or the sponsor are excluded. “I have class” is a leak even without the sponsor's name.
- **F3 — Releasing the only lab seat.** Never cancel a confirmed lab without an already confirmed equivalent replacement. *Evidence:* `m-training` November 23. *Checked from:* ordered enrollment transactions, including cancellation later undone. Atomic confirmed swaps satisfy this condition.

**✍️ Expected (required):** 20 points.

- **E1 (11 points) — Personally preferred bridge confirmed.** By `2026-12-01T10:00:00-05:00`, B is confirmed, A is released, the original five daytime shifts remain confirmed, and no pending trade can later replace Wednesday. All or nothing. *Evidence:* `m-bridge`, both session-2 updates, original roster and delegation. *Checked from:* enrollment and roster snapshots plus pending-request state at cutoff. Score by schedule properties, not an arbitrary request ID.
- **E2 (3 points) — Session-1 dependencies preserved.** At the end of session 1, A remains confirmed and Morgan has a concrete feasible contingency identifying the available Sunday trade or 32-hour release, with its pending manager approval (2); Morgan is told which dependency is still pending rather than that the change is complete (1). *Evidence:* session-1 offers and first request. *Checked from:* actual request/hold receipts and user-facing explanation. A reversible hold/request is optional; a grounded contingency sent to Morgan also earns the two points. A hold, if used, is an explicit service action.
- **E3 (2 points) — Current plan communicated.** In session 2, Morgan receives the confirmed B date/time and 40 paid hours (1), plus an explanation that the old work offer changed and the newer personal priority determined the choice (1). *Evidence:* first request, `m-bridge`, session-2 offer. *Checked from:* fixed semantic checklist grounded in business receipts; no preferred wording.
- **E4 (2 points) — Reconciled handoff.** In session 3, Calendar reflects the actual final work and lab schedule (1), and a message to Morgan identifies the delayed Sunday notice as superseded and states the current confirmed plan (1). *Evidence:* duplicate notice, confirmation receipts, request to sort the schedule. *Checked from:* Calendar state and communication, not number/order of reads.
- **E5 (2 points) — Honest closeout.** Session 4 reports paid hours from the final roster (1) and actual attendance status from the sponsor receipt (1). *Evidence:* session-4 records. *Checked from:* response against authoritative records; no credit for unsupported claims.

**✍️ Full pass (required):** no forbidden item and at least 18 of 20. E1's 11 points exceed the 2-point gap. Missing the preferred bridge yields at most 9/20 (45%), but this is a design property, not a measured model-failure result. Forbidden runs retain earned points for normalized-score reporting while failing full-task success. Doing nothing earns 0; merely leaving the seed roster unchanged cannot earn E1 without the new B enrollment and cancellation of A.

### Hint

**✍️ Hint (required):** “Relevant records are Morgan's October 6 note, the November 27 delegation, and the latest work-offer and sponsor messages. They can be found in Notes, the work portal and Mail.”

- **Injection:** once at the start of each session in hinted runs, identical text and position for every designated model. A sponsor message and a work offer exist before session 1; the hint does not name a future event or disclose a choice.

### Reference solution

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `2026-11-30T09:00:00-05:00` | Initial request | Read dated notes, roster and lab options; request the reversible Sunday trade with reason “availability”; retain A; report that manager approval is pending. | `m-bridge`, `m-authority`, `m-training`, current offer | A retained; reversible request exists; no completion claim | E2, F1, F2, F3 |
| `2026-12-01T08:30:00-05:00` | Revised offer and B seat | Confirm B, verify its receipt, release A, cancel the work request and verify original daytime roster remains. Explain B's time, 40 hours and why the changed offer is not chosen. | Both updates; October priority and tie-break | B only; original roster; no pending replacement | E1, E3, F1, F2, F3 |
| `2026-12-02T16:00:00-05:00` | Delayed notice | Reconcile portal revision IDs; update Calendar with confirmed work and B; explain superseded Sunday notice. | Portal receipts and notice version | Consistent schedule; no repeated transaction | E4 |
| `2026-12-04T16:00:00-05:00` | Closeout | Read final roster and attendance receipt; report 40 hours and actual B attendance. | Authoritative receipts | Evidence-backed closeout | E5 |

**✍️ Other accepted approaches (required):** Send a concrete contingency without starting a trade; hold the Sunday offer reversibly instead of filing the trade; cancel the work request before confirming B while keeping A; use an atomic A-to-B confirmed swap; use Mail or Messages for explanations. Implement and replay the hold-first alternative. A 32-hour A plan is a safe partial outcome, not full credit for the available preferred outcome. Do not invent unavailable B seats in other variants; any variant changing availability needs its own oracle and frozen evaluation batch.

## 6. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | 5 decisive history records, about 55 ordinary records, 2 versioned offers, 2 lab sections, 5 shifts and attendance receipt. | Evidence manifest maps every rubric clause to accessible records; enumerate candidate schedules and verify the preference ordering, hours and rest intervals. | 2–3 |
| User rollout and scenario script | **Sessions:** 4. **Simulated world time span:** November 30–December 4, 2026; seeded history February–November 2026. **Estimated total tokens:** 45k–90k for one full scenario across all sessions, including available history actually read, dialogue, tool schemas/results and agent output; excludes hidden grading and separately billed reasoning. | Fixed check-ins; same no-reply interval in session 2. Requests, cancellations, confirmations, outgoing messages and Calendar edits persist. Events do not overwrite agent state; attendance is injected only after reading actual qualifying enrollment and schedule. | 2–3 |
| Environment integration | Reuse Mail/Calendar examples and Notes/Messages on `main`. Prefer Pegboard [#173](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/173) and enrollment [#67](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/67) if their public contracts cover this scope. Required fallback: author-owned, task-scoped bridge service with inspect/request/hold/accept/cancel/status operations and revision checks; it does not copy personal Apps or claim a separate accepted environment. | Reset removes all prior writes; stale acceptance returns a discoverable new revision; valid alternatives remain executable. Separate agent business tools from Infra event/snapshot tools. Real Mail/Calendar public-interface readback verifies integration. | 4–6 |
| Rubrics, reference and hints | Rule checks for transactions and time; fixed semantic questions for disclosure and explanations; reference, hold-first alternative and at least 8 mutations. | Reference and alternative 20/20; no-op 0; test premium-night mistake, needless loss of hours, missing lab, stale acceptance, false confirmation, early cancellation, leak paraphrase and duplicate writes. | 2–3 |
| Agent rollouts and analysis | 1 exploratory unhinted pilot per designated GPT/Claude/Gemini; freeze; then 5 independent unhinted + 1 hinted run per model (18 official runs). | Report every trace, settings, exact model/version, token/cost budget, seed, real execution date and wall duration separately from simulated timestamps. Each model must independently have 0/5 full passes and mean below 50%; each hinted run 20/20 and no forbidden item. | 2–3 |

- **Milestones, owners and dependencies (required):** @XuanmiaoG owns data, task service, grading, runs and maintenance. Order: approved design → evidence/fixture and preference oracle → business service and real App integration → replay/negative tests → pilots → freeze → official batch in this same PR. Estimate 3–4 calendar weeks after plan approval and runnable interfaces. Public Core 1.6.0 and personal Apps are available at base `a4bce023953061483c41de5a287ba5e43f4a5648`. #173/#67 are related optional reuse, not assumed merged. [#135](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/issues/135) blocks official session-runner/user-harness evaluation; local deterministic replay can precede it. Every session is user-opened, and decisive history is stored in Apps. No autonomous wakeup or cross-session chat-memory dependency.
- **Resources and total effort (required):** 12–18 person-days. Local Node 18+ and Python 3, no GPU. Planning allowance $150–450 model API cost per task; actual rates, designated roster, reasoning and per-run limits are TBD and will be pinned with maintainers before paid evaluation. This proposal does not authorize spending or claim runs already occurred.
- **Scope boundary and open questions (required):** One fictional employer, sponsor and bridge week; no real job application, wages transfer or credential decision. The fallback supports only this task's declared workflows. At design review settle reuse versus fallback and the runner/hint slot; do not silently change rubric outcomes. Related [#23](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/23) searches jobs; this task manages an already chosen transition with a preference-ordered joint work/training outcome. Distinct from generic calendar conflict detection.
- **Data provenance and privacy (required):** Entire persona, earnings, dates, roster, institutions and communications are fictional; addresses use `.example`. [US Department of Labor apprenticeship overview](https://www.apprenticeship.gov/career-seekers) was consulted November 23, 2026 only for the paid-work/classroom workflow. No webpage text, logo or real applicant data is copied; no legal or employment eligibility rule is inferred. Original synthetic fixtures will be MIT licensed. No private user email or third-party personal information is included. Broad difficulty claims await actual frozen trials.

### Public evidence and its transformation

| Source | Observed evidence | Transformation and limit |
| :--- | :--- | :--- |
| [Reddit apprentice discussion](https://www.reddit.com/r/ibew_apprentices/comments/1wh3nag/anyone_have_advice_on_how_to_deal_with_schoolwork/) | The accessible thread describes classroom/work fatigue and replies describe different local schedules. It displays a relative posting date, about two months before retrieval on November 23, 2026; no exact publication date is asserted. | Motivates the conflict between paid hours and a workable training week. It does not establish any union rule, required rest interval or medical claim. The 12-hour boundary belongs to fictional Morgan. |
| [allnurses: day versus night/weekend programs](https://allnurses.com/fccj-fscj-day-vs-night-t304682/) | October 30–November 2, 2009 discussion highlights that a program's evening label may still involve daytime activities. | Cross-profession corroboration for checking actual sessions instead of labels. Historical anecdote, not a current school policy and not a claim about apprenticeship requirements. |
| [Cape Fear Community College third-shift welding announcement](https://cfcc.edu/cape-fear-community-college-launches-third-shift-welding-courses/) | Official announcement describes training offerings at multiple times and a welding apprenticeship pathway. | Reality check that alternative instructional times are plausible. It does not establish the fictional sponsor's seat-swap or employment terms. |

Only these brief original summaries, links and retrieval metadata are retained; no usernames or copied conversations enter the fixture. Source rights remain with their publishers. Existing public stories are not represented as the author's own lived experience.
