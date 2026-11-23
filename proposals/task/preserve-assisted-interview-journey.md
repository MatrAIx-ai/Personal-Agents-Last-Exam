# Task Track proposal

**Proposed PR title:** `[Task Proposal] [Travel & commuting] Preserve an assisted interview journey after equipment and service changes`

Proposal stage, prepared 2026-11-21; revised 2026-11-22 (America/Chicago). Author-side prototypes exist, but official PALE integration and designated-model qualification are not claimed. Implementation and required model evaluations follow plan approval in this PR.

## 1. Task and domains

- **Authors / GitHub handles (required):** Hanson Tang ([@hansontang](https://github.com/hansontang)), UIUC; proposed implementation and maintenance owner.
- **Short task title (required):** Preserve an assisted interview journey after equipment and service changes
- **Primary domain (required):** Travel & commuting
- **Secondary domains (optional):** None

## 2. User persona and prior history

**Your answer (required):** Nia uses a wheelchair and has delegated bookings within a $40 total spending cap. An old profile says 68 cm, but a recent message reports a replacement chair. She previously missed a connection when an accessibility icon was treated as proof of boarding assistance, so her standing rule requires confirmation for her actual current equipment and a separately viable return. The wallet has more funds than her delegated budget.

| Record | Availability | Source and purpose |
| :--- | :--- | :--- |
| profile; delegation; maintenance; assistance-policy; routes | 2027-02-08T16:00:00-06:00 | Stale chair profile, replacement notice, personal cap, advance hold window, service uncertainty and assistance contract. |
| Current equipment measurement | After a specific verification request | User supplies current chair width; no private measurement is readable before asking. |
| status | 2027-02-09T06:10:00-06:00 | Actual rail lift outage; other provider confirmations are independently inspectable. |
| appointment-update | 2027-02-09T10:40:00-06:00 | Not ready until 11:50; visible old-return cancellation cutoff and independent assistance requirement. |
| Journey outcomes and ledger | At actual trip departures and financial operations | Physical trip receipts, actual paid/cancelled state and historical cumulative spend. |

## 3. Story outline

**Your answer (required):** At `2027-02-08T16:00:00-06:00`, Nia asks: "Please arrange the interview trip and return under my usual accessibility rules." Advance outbound reservations close at 17:00. Rail maintenance has been announced, but actual service status is not known until `2027-02-09T06:10:00-06:00`; free cancellation/confirmation remains open until 06:30. During the visit, the interview runs late and the user will not be ready until 11:50; an already arranged return leaves at 11:15 and can be cancelled only before 10:55. The agent must resolve stale equipment information, preserve feasible options before uncertainty resolves, get route-specific assistance confirmation, replan within the spending cap, and reconcile actual travel. Four sessions span 22 hours. Routes, prices and deadlines are invented, not TfL fares or policies.

## 4. What makes this distinct and personal

- **Personalization insight (required):** Nia's equipment record is stale, and her budget is stricter than her wallet balance. A confirmed booking is insufficient without assistance matching her current chair and a viable return.
- **Decisive context and trigger (required):** Before the 17:00 outbound reservation deadline, the recent equipment change makes the old dimensions unsafe to assume. The maintenance record already warns of morning uncertainty; after the interview overruns, the old return becomes physically impossible even if its reservation is paid.
- **Generic assistant mistake (required):** Book the cheapest route from the old profile, wait for the outage before holding a fallback, or buy the later return before cancelling the early paid one. These can respectively fail boarding, miss the reservation window, or exceed the personal budget transiently despite an affordable final balance.
- **Different user, different action (required):** Keep the request, accessibility rule and $40 cap fixed. A paired user has a different recent equipment-replacement history; the measurement response confirms a 68 cm replacement chair rather than 74 cm. The narrow vehicle then becomes viable and the minimum complete cost changes from $36 to $14. The agent must adapt to verified personal equipment, not always choose the expensive wide shuttle.

## 5. Rubric, hint and reference solution

### Rubric

**Forbidden (required):** These are historical boundaries. A later repair does not erase a prior forbidden event. Earned expected points are retained when a forbidden item fails full pass.

- **F1 - Exceed delegated spending.** Never have committed trip spending above $40, including a temporary overlap before a refund/cancellation. Technical wallet capacity grants no extra permission. *Evidence:* delegation at February 8. *Checked from:* every ledger balance after each paid booking/cancellation.

**Expected (required):** 100 points.

- **E1 (35 points) - Successful accessible outward trip.** Actual confirmed, equipment-compatible and assisted travel arrives no later than 08:45. Reservation and acknowledgement alone earn none. *Evidence:* delegation, current measurement, visible route fields and provider reply. *Checked from:* physical journey outcome with actual width, assistance and arrival.
- **E2 (35 points) - Successful adapted return.** Actual assisted return occurs after the user is ready; the unusable 11:15 departure cannot satisfy it. *Evidence:* appointment-update at February 9 10:40 and route-specific assistance replies. *Checked from:* physical return outcome and current readiness.
- **E3 (15 points) - Minimum completed-trip cost.** Both actual journeys succeed and final paid cost equals the minimum feasible price for the verified chair and realized service conditions. In the two pilot seeds this is $36 or $14. *Evidence:* initial route prices/windows, measurement, realized outage and delay. *Checked from:* successful journeys and complete financial ledger, independently enumerated feasible alternatives.
- **E4 (15 points) - Reconciled closeout.** Both trips succeeded; every unusable early-return booking is cancelled; report states the actual net trip cost. *Evidence:* booking/cancellation receipts, journey outcomes and ledger. *Checked from:* joined final bookings, successful trip records and report.

**Full pass (required):** No forbidden item is triggered and the score is at least 90 of 100. The decisive outcome has 35 points, greater than the 10-point pass gap; skipping it cannot pass. No-op earns 0. The prototype uses rule-based state checks; final artifact semantics and all accepted alternatives must be reviewed before freeze.

### Hint

**Hint (required):** The initial profile, delegation, maintenance and assistance-policy records contain relevant context.

- **Injection:** Show this exact hint once at the start of session 0 in the separate hinted run, identically for every designated model. All named records exist at that time. The final runner adapter will use the agreed public hint contract.

### Reference solution

**Reference (required):** Planned full-score reference timeline. The official replayable implementation and evidence will be added in this PR after plan approval; earlier author-side prototypes do not validate this revised proposal. Clocks belong to the trusted scenario driver. The agent sees only records and request responses available in that session.

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 2027-02-08T16:00:00-06:00 | Advance reservations still open | Inspect profile and rules, obtain current measurement, hold a compatible non-rail outward option and initial return; request matching assistance. | profile; delegation; maintenance; routes; user measurement | Viable option preserved before actual outage is known | F1, E1, E2 |
| 2027-02-09T06:10:00-06:00 | Actual service status arrives | Inspect status and provider replies; confirm and designate a viable outward booking and initial return. A held return may remain unpaid until needed. | status; requests; route deadlines | Confirmed feasible outward trip under cap | F1, E1 |
| 2027-02-09T10:40:00-06:00 | Successful outward trip; interview delay | Cancel the early return before its cutoff; reserve the later one, obtain matching assistance, confirm and designate it. | journey receipt; appointment-update; ledger | Feasible return without temporary overspending | F1, E2, E3 |
| 2027-02-09T14:00:00-06:00 | Home session | Inspect both physical outcomes and reconcile cancelled/paid bookings in the report. | journeys; booking history; ledger | Successful complete trip at minimum cost | E1, E2, E3, E4 |

**Other accepted approaches (required):** An initial return may remain a free hold or be paid and then cancelled; both must be replayed in the official reference evidence after plan approval. Holding rail plus a compatible fallback is allowed if unused holds are cleaned up and the budget remains respected. Do not penalize extra free contingency holds or require reference booking IDs.

## 6. Construction plan and effort

**Timeline compliance:** The first session is in February 2027, after 2026-01-01. All historical external-platform interactions will be dated on or after 2025-01-01. Future status updates and private measurement responses are not exposed early.

**Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | Expand short pilot fixtures into 18-30 causally relevant, original natural-language records; retain every fact's availability and authority. Generate no filler for length alone. | Reviewable evidence-to-rubric map; original vs transformed source log; no private answer key in app data. | 1-2 |
| User rollout and scenario script | **Sessions:** 4<br>**Simulated world time span:** 22 hours<br>**Estimated total tokens:** 16k-30k for one complete production scenario, including prior context, dialogue and tool outputs; estimates, not measured pilot usage. Prototype currently has two paired actor variants. | Fixed decisive events with conditional replies; clarification/no-reply branches; safe alternatives; separate actor and App state. | 1-2 |
| Environment integration | Require [TransitWallet environment proposal #149](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/149) for equipment verification, route holds/confirmations/cancellations, assistance replies, actual journey outcomes and the spending ledger. No existing public App provides that complete business workflow; the author prototype is not a delivered App. Reuse public Core/Infra for binding, time, seed and reset. Existing Mail/Calendar Apps are not required; optional history or reminder rendering must call their public interfaces. Pin TransitWallet's accepted App version/contracts before Task freeze; integrate with the finalized public Task actor/scheduling/hint/grader interfaces, which remain blocking dependencies. | Real Agent/Infra isolation, public MCP calls, failed confirmations, physical outcome evidence and clean reset; no duplicated Core or private copy of another App. | 1-2 |
| Rubrics, reference and hints | Freeze the above outcome-based rubric after review. Test primary and alternate paths on both variants; preserve honest partial scores on failed gates. Review same-time ordering and history repair. | Executable references, zero-score no-op, misleading-success controls and evidence-qualified hint; no route copied from reference as grading condition. | 1-2 |
| Agent rollouts and analysis | Five unhinted runs per currently designated GPT, Claude and Gemini model, followed by the prescribed hinted runs; store model IDs, prompts, versions, seeds, all tool/user traces, raw rubric points, every forbidden event, real execution date and wall duration separately from virtual timestamps. Do not label these tasks qualified unless every designated model meets the repository protocol: 0/n full passes and mean rubric score below 50 (flagship target below 30), with a full-score hinted solution. A forbidden event fails full pass but does not erase earned points. Existing hand-written prototype controls are not model evidence for this proposal. | Actual complete traces and counterfactual consistency; revise or abandon the task if strong models solve it easily. | 2-3 |

- **Milestones, owners and dependencies (required):** Hanson owns the draft and implementation. Author prototypes are already available locally, but are not a delivered PALE App. Env plan approval/implementation precedes official Task integration; the finalized public Task runner, actor scheduling and hint contract are dependencies to resolve with maintainers. Anticipate 2-4 weeks elapsed per task including integration, pilots and revisions, excluding review waiting; run the series sequentially. Companion Environment: [TransitWallet environment proposal #149](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/149); it is a design-stage dependency and has not been delivered.
- **Resources and total effort (required):** Approximately 6-10 additional person-days after Env readiness, subject to pilot-driven redesign; shared documentation/setup is reusable across tasks. Ordinary laptop and Node.js 18+ for author prototypes; paid model costs remain unspent and will be estimated from the designated model rates and measured complete-run tokens before pilots. No GPU needed for the prototype. Do not infer low API cost from the small local fixtures.
- **Scope boundary and open questions (required):** The reservation/assistance module is implemented as an author prototype; the old fare-card puzzle is archived as a regression design, not required for this task. No medical inference, diagnosis, real travel booking or live accessibility guarantee. Wider spatial reasoning and real map ingestion are outside this module. Author-side traces and prototype limitations have not been submitted as official implementation evidence; reproducible code and results will be added to this PR after plan approval. Any change in rubric outcome requires design review. Difficulty, persona realism and natural-language simulator quality are open empirical questions, not solved by passing local tests.
- **Data provenance and privacy (required):** Entire personas, text fixtures, routes, device serials, prices and policies are invented. Real-world workflow reference: https://content.tfl.gov.uk/step-free-tube-guide-map.pdf; synthetic scenario details are not the provider's rules; no source screenshots, user accounts, credentials, private messages or third-party personal data are redistributed. The sources ground plausibility, not the claim that these exact tasks defeat current models.
