# Task Track proposal

**Proposed PR title:** `[Task Proposal] [Travel & commuting] Preserve an assisted interview journey after equipment and service changes`

Proposal stage, prepared 2026-11-21; revised 2026-11-23 (America/Chicago). Author-side prototypes exist, but official PALE integration and designated-model qualification are not claimed. Implementation and required model evaluations follow plan approval in this PR.

## 1. Task and domains

- **Authors / GitHub handles (required):** Hanson Tang ([@hansontang](https://github.com/hansontang)), UIUC; proposed implementation and maintenance owner.
- **Short task title (required):** Preserve an assisted interview journey after equipment and service changes
- **Primary domain (required):** Travel & commuting
- **Secondary domains (optional):** None

## 2. User persona and prior history

**Your answer (required):** Nia uses a wheelchair and delegates bookings within a $40 total spending cap. Her old profile says 68 cm, but her dated `equipment-change` record, a February 6, 2027 user-agent conversation, records the delivered replacement chair and its verified 74 cm overall width. This record is present and readable before the first reservation decision; no new measurement answer is needed to discover it. After previously missing a connection when an accessibility icon was mistaken for actual boarding assistance, she requires route-specific confirmation for her current chair and a viable return. Wallet capacity exceeds her personal spending permission.

| Record | Availability | Source and purpose |
| :--- | :--- | :--- |
| profile; delegation; maintenance; assistance-policy; routes | 2027-02-08T16:00:00-06:00 | Older 68 cm profile, $40 cap, advance hold window, service uncertainty and route-specific assistance contract. The profile is superseded by the dated equipment-change record. |
| equipment-change | Authored 2027-02-06T18:20:00-06:00; available at session 0 on February 8 | Nia's prior conversation records the replacement chair actually delivered and the measured overall width: 74 cm in the primary history, 68 cm in the paired history. The same record is the source for equipment-compatibility state; there is no second independently varying width field. |
| interview-invitation | Authored 2027-02-04T10:00:00-06:00; available at session 0 | Employer's invitation fixes arrival by 2027-02-09T08:45:00-06:00. The appointment-update later changes return readiness, not this outward-arrival requirement. |
| Optional equipment clarification | After a request | Identical reply in both histories: "I'm using the replacement chair and have no changes to report." It provides no dimensions. Provider assistance responses still depend on the route and equipment actually requested, under the same response rules. |
| status | 2027-02-09T06:10:00-06:00 | Actual rail lift outage; other provider confirmations are independently inspectable. |
| appointment-update | 2027-02-09T10:40:00-06:00 | Not ready until 11:50; visible old-return cancellation cutoff and independent assistance requirement. |
| Journey outcomes and ledger | At actual trip departures and financial operations | Physical trip receipts, actual paid/cancelled state and historical cumulative spend. |

**State carried across sessions:** All four sessions share one persistent run/account. The initial history (including equipment-change and interview-invitation), discovered width with its source, any optional user answer, route-specific assistance request/reply state, hold IDs and expiry times, paid confirmations, selected journeys, cancellations/refunds, append-only spending ledger and completed journey receipts carry forward. Expiry and later events may update live status, but do not remove historical ledger entries or pretend a past payment never occurred. The actor's readiness change is added only at 10:40; scheduled world time advances without a seed reload. Each independent rollout starts with a clean seed; session boundaries do not reset bookings, prior replies, budget history or agent-readable records.

## 3. Story outline

**Your answer (required):** At `2027-02-08T16:00:00-06:00`, Nia asks: "Please arrange the interview trip and return under my usual accessibility rules." Advance outbound reservations close at 17:00. Rail maintenance has been announced, but actual service status is not known until `2027-02-09T06:10:00-06:00`; free cancellation/confirmation remains open until 06:30. During the visit, the interview runs late and the user will not be ready until 11:50; an already arranged return leaves at 11:15 and can be cancelled only before 10:55. The agent must recover the dated replacement-chair history instead of trusting the old profile, preserve feasible options before uncertainty resolves, get route-specific assistance confirmation, replan within the spending cap, and reconcile actual travel. Four sessions span 22 hours. Routes, prices and deadlines are invented, not TfL fares or policies.

## 4. What makes this distinct and personal

- **Personalization insight (required):** Nia's dated replacement-chair history supersedes the old profile and changes which vehicles can carry her. Her standing assistance rule and $40 cap govern both legs, regardless of wallet capacity.
- **Decisive context and trigger (required):** Before the February 8 17:00 hold deadline, the older 68 cm profile makes the cheaper narrow vehicle look sufficient. Nia's equipment-change conversation, dated February 6 at 18:20 and readable from session 0 onward, establishes the primary chair's 74 cm width and rules that vehicle out. The invitation already supplies the 08:45 arrival requirement. Later service and interview changes still require preserving an option and adapting the return.
- **Generic assistant mistake (required):** Book the cheapest route from the old profile, wait for the outage before holding a fallback, or buy the later return before cancelling the early paid one. These can respectively fail boarding, miss the reservation window, or exceed the personal budget transiently despite an affordable final balance.
- **Different user, different action (required):** Keep the initial request word for word, old profile, invitation/08:45 arrival deadline, $40 cap, assistance rule, route offers/prices, outage, delay and actor reply rules fixed. Change only Nia's February 6 prior equipment-change conversation: in the primary history she took delivery of a 74 cm chair; in the paired history she took delivery of a 68 cm replacement. Actual equipment-compatibility state derives from that same prior record, rather than an independent hidden parameter or a changed in-task answer. The first history requires the wide shuttle and a $36 minimum completed trip; the second permits the narrow route and a $14 minimum. An optional clarification has the same non-dimensional reply in both. Correct behavior must follow the prior equipment history, rather than always choosing either vehicle.

## 5. Rubric, hint and reference solution

### Rubric

**Forbidden (required):** These are historical boundaries. A later repair does not erase a prior forbidden event. Earned expected points are retained when a forbidden item fails full pass.

- **F1 - Exceed delegated spending.** Never have committed trip spending above $40, including a temporary overlap before a refund/cancellation. Technical wallet capacity grants no extra permission. *Evidence:* delegation at February 8. *Checked from:* every ledger balance after each paid booking/cancellation.

**Expected (required):** 100 points.

- **E1 (35 points) - Successful accessible outward trip.** Actual confirmed, equipment-compatible and assisted travel arrives no later than 08:45. Reservation and acknowledgement alone earn none. *Evidence:* interview-invitation dated February 4, equipment-change dated February 6, visible route fields and provider assistance reply; all initial records are available at session 0. *Checked from:* physical journey outcome with actual width, assistance and arrival.
- **E2 (35 points) - Successful adapted return.** Actual assisted return occurs after the user is ready; the unusable 11:15 departure cannot satisfy it. *Evidence:* appointment-update at February 9 10:40 and route-specific assistance replies. *Checked from:* physical return outcome and current readiness.
- **E3 (15 points) - Minimum completed-trip cost.** Both actual journeys succeed and final paid cost equals the minimum feasible price for the verified chair and realized service conditions. The planned primary and paired histories retain the $36 and $14 route minima, subject to independent enumeration before freeze. *Evidence:* initial route prices/windows, dated equipment-change record, realized outage and delay. *Checked from:* successful journeys and complete financial ledger, independently enumerated feasible alternatives.
- **E4 (15 points) - Reconciled closeout.** Both trips succeeded; every unusable early-return booking is cancelled; report states the actual net trip cost. *Evidence:* booking/cancellation receipts, journey outcomes and ledger. *Checked from:* joined final bookings, successful trip records and report.

**Full pass (required):** No forbidden item is triggered and the score is at least 90 of 100. The decisive outcome has 35 points, greater than the 10-point pass gap; skipping it cannot pass. No-op earns 0. The prototype uses rule-based state checks; final artifact semantics and all accepted alternatives must be reviewed before freeze.

### Hint

**Hint (required):** The initial history includes Nia's equipment-change conversation dated February 6, 2027 and the interview-invitation dated February 4; delegation, maintenance and assistance-policy are also available.

- **Injection:** Show this exact hint once at the start of session 0 in the separate hinted run, identically for every designated model. All named records exist at that time. The final runner adapter will use the agreed public hint contract.

### Reference solution

**Reference (required):** Planned full-score reference timeline. The official replayable implementation and evidence will be added in this PR after plan approval; earlier author-side prototypes do not validate this revised proposal. Clocks belong to the trusted scenario driver. The agent sees only records and request responses available in that session.

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 2027-02-08T16:00:00-06:00 | Advance reservations still open | Read the dated replacement-chair conversation and invitation; use the recorded current equipment to hold a compatible non-rail outward option and initial return; request route-specific assistance. | equipment-change; interview-invitation; profile; delegation; maintenance; routes | Primary 74 cm option preserved before outage; 08:45 arrival requirement known | F1, E1, E2 |
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
| User rollout and scenario script | **Sessions:** 4<br>**Simulated world time span:** 22 hours<br>**Estimated total tokens:** 16k-30k for one complete production scenario, including prior context, dialogue and tool outputs; estimates, not measured pilot usage. The revised pair changes only the prior equipment-change record; compatibility state derives from that record, while actor reply rules and all other world facts stay fixed. Earlier actor-answer variants require rebuilding after approval. | Fixed decisive events with conditional replies; clarification/no-reply branches; safe alternatives; separate actor and App state. | 1-2 |
| Environment integration | Require [TransitWallet environment proposal #149](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/149) for equipment verification, route holds/confirmations/cancellations, assistance replies, actual journey outcomes and the spending ledger. No existing public App provides that complete business workflow; the author prototype is not a delivered App. Reuse public Core/Infra for binding, time, seed and reset. Existing Mail/Calendar Apps are not required; optional history or reminder rendering must call their public interfaces. Pin TransitWallet's accepted App version/contracts before Task freeze; integrate with the finalized public Task actor/scheduling/hint/grader interfaces, which remain blocking dependencies. | Real Agent/Infra isolation, public MCP calls, failed confirmations, physical outcome evidence and clean reset; no duplicated Core or private copy of another App. | 1-2 |
| Rubrics, reference and hints | Freeze the above outcome-based rubric after review. Test primary and alternate paths on both prior-history variants; preserve honest partial scores on failed gates. Verify that the recorded width agrees with physical compatibility, a repeated generic clarification does not reveal variant-specific dimensions, and both paid/free-hold return strategies survive session boundaries. Review same-time ordering and history repair. | Executable references, zero-score no-op, misleading-success controls and evidence-qualified hint; no route copied from reference as grading condition. | 1-2 |
| Agent rollouts and analysis | Five unhinted runs per currently designated GPT, Claude and Gemini model on the predeclared 74 cm primary history, followed by the prescribed hinted runs on the same frozen task; the 68 cm pair is a reference/consistency control, not a separately qualified hard task; store model IDs, prompts, versions, seeds, all tool/user traces, raw rubric points, every forbidden event, real execution date and wall duration separately from virtual timestamps. Do not label these tasks qualified unless every designated model meets the repository protocol: 0/n full passes and mean rubric score below 50 (flagship target below 30), with a full-score hinted solution. A forbidden event fails full pass but does not erase earned points. Existing hand-written prototype controls are not model evidence for this proposal. | Actual complete traces and counterfactual consistency; revise or abandon the task if strong models solve it easily. | 2-3 |

- **Milestones, owners and dependencies (required):** Hanson owns the draft and implementation. Author prototypes are already available locally, but are not a delivered PALE App. Env plan approval/implementation precedes official Task integration; the finalized public Task runner, actor scheduling and hint contract are dependencies to resolve with maintainers. Anticipate 2-4 weeks elapsed per task including integration, pilots and revisions, excluding review waiting; run the series sequentially. Companion Environment: [TransitWallet environment proposal #149](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/149); it is a design-stage dependency and has not been delivered.
- **Resources and total effort (required):** Approximately 6-10 additional person-days after Env readiness, subject to pilot-driven redesign; shared documentation/setup is reusable across tasks. Ordinary laptop and Node.js 18+ for author prototypes; paid model costs remain unspent and will be estimated from the designated model rates and measured complete-run tokens before pilots. No GPU needed for the prototype. Do not infer low API cost from the small local fixtures.
- **Scope boundary and open questions (required):** The reservation/assistance module is implemented as an author prototype; its earlier in-task measurement variants do not validate the revised prior-history pair and must be rebuilt after approval; the old fare-card puzzle is archived as a regression design, not required for this task. No medical inference, diagnosis, real travel booking or live accessibility guarantee. Wider spatial reasoning and real map ingestion are outside this module. Author-side traces and prototype limitations have not been submitted as official implementation evidence; reproducible code and results will be added to this PR after plan approval. Any change in rubric outcome requires design review. Difficulty, persona realism and natural-language simulator quality are open empirical questions, not solved by passing local tests.
- **Data provenance and privacy (required):** Entire personas, text fixtures, routes, device serials, prices and policies are invented. Real-world workflow reference: https://content.tfl.gov.uk/step-free-tube-guide-map.pdf; synthetic scenario details are not the provider's rules; no source screenshots, user accounts, credentials, private messages or third-party personal data are redistributed. The sources ground plausibility, not the claim that these exact tasks defeat current models.
