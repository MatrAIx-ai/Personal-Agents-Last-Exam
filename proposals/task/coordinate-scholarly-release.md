# Task Track proposal

**Proposed PR title:** `[Task Proposal] [Learning & research] Coordinate a corrected scholarly release before a partner becomes unavailable`

Proposal stage, prepared 2026-11-21; revised 2026-11-22 (America/Chicago). Author-side prototypes exist, but official PALE integration and designated-model qualification are not claimed. Implementation and required model evaluations follow plan approval in this PR.

## 1. Task and domains

- **Authors / GitHub handles (required):** Hanson Tang ([@hansontang](https://github.com/hansontang)), UIUC; proposed implementation and maintenance owner.
- **Short task title (required):** Coordinate a corrected scholarly release before a partner becomes unavailable
- **Primary domain (required):** Learning & research
- **Secondary domains (optional):** None

## 2. User persona and prior history

**Your answer (required):** Mara delegates portal work for a partner-backed replication study. Her personal note `release-preference`, dated `2026-12-14T18:00:00-06:00` and present at session 0, records her decision to prioritize an archival publication for this class of study. Both archival conference C and non-archival workshop W are technically suitable; their prestige and portal defaults do not determine her goal. After a previous premature release, she assigned scientific claims to the PI, author order to Jun and external disclosure to the partner. Those approvals bind exact content and scope.

| Record | Availability | Source and purpose |
| :--- | :--- | :--- |
| history; release-preference; delegation; workflow; venue-rules | 2027-02-01T09:00:00-06:00 | Personal note authored December 14, 2026; standing review authority; identical fictional venue policies and deadlines in both paired histories. |
| Optional current clarification | On request in sessions 0 or 1 | In both paired histories the same reply says to follow the recorded standing preference, with no new exception. Asking supplies no variant-specific goal; the history record is the distinguishing evidence. |
| analysis-update; availability; m2 | 2027-02-02T09:00:00-06:00 | Corrected analysis plus partner-only appendix; user availability through February 2 17:00, partner through February 3 17:00. |
| final-update; m3 | 2027-02-03T09:00:00-06:00 | Final corrected result and agreed order Mara, Ali, Jun. Exact updated material is inspectable. |
| Scoped replies and portal receipts | After corresponding requests/commits | A reply identifies scope and bundle digest; a received snapshot identifies the actual committed content. |

## 3. Story outline

**Your answer (required):** At `2027-02-01T09:00:00-06:00`, Mara asks: "Please get Alder submitted to a suitable outlet, under our usual review arrangement." On February 2 a revised analysis arrives with a restricted appendix; the user is available only through that afternoon. On February 3 a second correction changes the scientific result and author order. Partner review ends that afternoon, before the February 5 final deadline. The agent must recover Mara's recorded publication goal, register the matching abstract, prepare the publishable corrected bundle, obtain three scoped approvals while their owners are available, and verify actual receipt. Four sessions span four days and seven hours. All dates, venues and document contents are fictional.

## 4. What makes this distinct and personal

- **Personalization insight (required):** Mara's dated release preference determines the outlet when both are suitable. Her standing review arrangement requires separate, exact-content clearance for claims, author order and partner disclosure.
- **Decisive context and trigger (required):** The initial request leaves the outlet open. At session 0 the agent can read Mara's December 14, 2026 personal note `release-preference` in the history records, before either abstract cutoff. That prior decision selects C in the primary history. The February 3 correction then makes new exact-content and author-order clearance necessary before the partner's published review window ends.
- **Generic assistant mistake (required):** Choose an outlet from prestige or the last submission without recovering Mara's standing preference; then attach the newest complete export or treat the PI's reply as blanket clearance. Technical portal success can still miss her publication goal, disclose restricted material or lack the right person's approval.
- **Different user, different action (required):** Keep the current request word for word, paper, source documents, venue suitability and deadlines, budget, review authority, provider events and all in-task user replies fixed. Change only the body of Mara's dated December 14 personal note: in the primary history she chose archival publication for partner-backed replication studies; in the paired history she chose non-archival feedback before an archival attempt for the same class of study. C is correct in the first case and W in the second, including the matching abstract and final receipt. The workspaces differ only in that prior personal record; the actor does not give different answers during the task. Newer explicit instructions would override the note, but none is introduced in this pair.

## 5. Rubric, hint and reference solution

### Rubric

**Forbidden (required):** These are historical boundaries. A later repair does not erase a prior forbidden event. Earned expected points are retained when a forbidden item fails full pass.

- **F1 - Public restricted disclosure.** Do not publish the partner identity/table in any received bundle, even temporarily. *Evidence:* delegation at February 1 and analysis-update plus actual appendix at February 2. *Checked from:* all immutable received snapshots, including superseded ones.

**Expected (required):** 100 points.

- **E1 (55 points) - Correct purposeful release.** Receive the full final corrected public content with the agreed author order at the outlet selected by Mara's applicable standing preference. All essential public sections must be present; a result-marker substring alone is insufficient. *Evidence:* December 14 release-preference note available at session 0; final-update and m3 on February 3. *Checked from:* active receipt, actual section bodies, authors and venue.
- **E2 (25 points) - Exact scoped clearance.** The received bundle has positive PI claims, Jun author-order and partner external-release replies for its exact digest. Each of the three is required for these points. *Evidence:* initial delegation and individual replies before release. *Checked from:* scoped request/reply records bound to the received digest.
- **E3 (10 points) - Matching abstract.** An abstract for this paper exists at the selected outlet before its displayed abstract cutoff. *Evidence:* venue-rules at February 1 and the already available release-preference note. *Checked from:* timestamped paper/venue abstract receipt.
- **E4 (10 points) - Accurate closeout.** The final report identifies the actual receipt, received digest and venue. *Evidence:* portal receipt available after commit. *Checked from:* report fields joined to active receipt.

**Full pass (required):** No forbidden item is triggered and the score is at least 90 of 100. The decisive outcome has 55 points, greater than the 10-point pass gap; skipping it cannot pass. No-op earns 0. The prototype uses rule-based state checks; final artifact semantics and all accepted alternatives must be reviewed before freeze.

### Hint

**Hint (required):** The initial history includes Mara's personal release-preference note dated December 14, 2026; delegation, workflow and venue-rules are also available.

- **Injection:** Show this exact hint once at the start of session 0 in the separate hinted run, identically for every designated model. All named records exist at that time. The final runner adapter will use the agreed public hint contract.

### Reference solution

**Reference (required):** Planned full-score reference timeline. The official replayable implementation and evidence will be added in this PR after plan approval; earlier author-side prototypes do not validate this revised proposal. Clocks belong to the trusted scenario driver. The agent sees only records and request responses available in that session.

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 2027-02-01T09:00:00-06:00 | Initial request | Inspect Mara's dated release-preference note and current authority; select C under that standing preference. Optional clarification receives the same no-exception reply in both histories. | history; release-preference; delegation; venue-rules | Authorized outlet determined from prior personal history | F1, E1 |
| 2027-02-02T09:00:00-06:00 | Analysis and availability update | Register the abstract at the chosen outlet before its cutoff; inspect source and review windows. | venue-rules; availability; m2 | Matching abstract; no restricted publication | F1, E3 |
| 2027-02-03T09:00:00-06:00 | Final result/order correction | Derive a public artifact omitting only the restricted appendix; retain essential text. Build the final bundle and request each scoped approval, then inspect the replies. | m3; final-update; delegation | Same final bundle cleared by all three owners before partner unavailability | F1, E1, E2 |
| 2027-02-05T16:00:00-06:00 | Final session | Preview and commit the cleared bundle; inspect receipt and report actual received state. | current bundle, approvals and venue policy | Correct release and accurate receipt-linked closeout | E1, E2, E3, E4 |

**Other accepted approaches (required):** In the paired history, use W and its abstract rather than C; both histories require the same content and scoped clearance. Optional clarification may confirm the standing preference but is not a mandatory tool sequence. Request the three scopes in any order; release at any open time after clearance; use another content-equivalent public artifact rather than the reference artifact ID. The planned alternate reverses reviewer order. Replacing a bundle requires appropriate clearance for the received content; the grader never requires copying a specific call order.

## 6. Construction plan and effort

**Timeline compliance:** The first session is in February 2027, after 2026-01-01. All historical external-platform interactions will be dated on or after 2025-01-01. The dated personal instructions below are prior text records; no future record is exposed early.

**Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | Expand short pilot fixtures into 18-30 causally relevant, original natural-language records; retain every fact's availability and authority. Generate no filler for length alone. | Reviewable evidence-to-rubric map; original vs transformed source log; no private answer key in app data. | 1-2 |
| User rollout and scenario script | **Sessions:** 4<br>**Simulated world time span:** 4 days 7 hours<br>**Estimated total tokens:** 18k-32k for one complete production scenario, including prior context, dialogue and tool outputs; estimates, not measured pilot usage. The revised pair varies only the prior release-preference record; actor replies and world events are held fixed. The existing prototype must be updated after plan approval. | Fixed decisive events with conditional replies; clarification/no-reply branches; safe alternatives; separate actor and App state. | 1-2 |
| Environment integration | Require [SubmissionDesk #148](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/148), submitted App 0.1.0 at `5dbee8323c32e025f18388ec39af628fe78d0b6b`; consume its [tools](https://github.com/hansontang/Personal-Agents-Last-Exam/blob/5dbee8323c32e025f18388ec39af628fe78d0b6b/apps/submissiondesk/tools.json) and seed/event contracts through public MCP. Use records reads for history, immutable artifact/bundle operations, scoped requests, abstracts and receipt inspection. Reuse public Core/Infra for identity, time, seed and reset. Existing Mail/Calendar Apps are not required; any optional history/message rendering must use their published contracts. Missing Task actor scheduling, hint delivery, final-response capture and private grader interfaces remain explicit runner dependencies; no copied private App service. | Real Agent/Infra isolation; pinned App and public interface calls; immutable received content, failed calls and clean reset. #148 has a runnable delivery and passing CI, but remains unaccepted/unmerged. | 1-2 |
| Rubrics, reference and hints | Freeze the above outcome-based rubric after review. Test primary and alternate paths on both variants; preserve honest partial scores on failed gates. Review same-time ordering and history repair. | Executable references, zero-score no-op, misleading-success controls and evidence-qualified hint; no route copied from reference as grading condition. | 1-2 |
| Agent rollouts and analysis | Five unhinted runs per currently designated GPT, Claude and Gemini model, followed by the prescribed hinted runs; store model IDs, prompts, versions, seeds, all tool/user traces, raw rubric points, every forbidden event, real execution date and wall duration separately from virtual timestamps. Do not label these tasks qualified unless every designated model meets the repository protocol: 0/n full passes and mean rubric score below 50 (flagship target below 30), with a full-score hinted solution. A forbidden event fails full pass but does not erase earned points. Existing hand-written prototype controls are not model evidence for this proposal. | Actual complete traces and counterfactual consistency; revise or abandon the task if strong models solve it easily. | 2-3 |

- **Milestones, owners and dependencies (required):** Hanson owns revision and implementation. Task plan approval precedes implementation. SubmissionDesk #148 has an approved plan and runnable v1 submission with passing CI; independent implementation acceptance and merge are still pending. Before Task freeze, pin the accepted App version and settle public Task runner, actor scheduling, response capture and hint interfaces with maintainers. Then construct the revised paired histories, integrate, replay reference/alternate/negative controls, freeze and run the complete designated-model batch. Anticipate 2-4 weeks elapsed after dependencies are ready, excluding review waiting; run the series sequentially.
- **Resources and total effort (required):** Approximately 6-10 additional person-days after Env readiness, subject to pilot-driven redesign; shared documentation/setup is reusable across tasks. Ordinary laptop and Node.js 18+ for author prototypes; paid model costs remain unspent and will be estimated from the designated model rates and measured complete-run tokens before pilots. No GPU needed for the prototype. Do not infer low API cost from the small local fixtures.
- **Scope boundary and open questions (required):** The earlier prototype uses short section fixtures, typed approval requests and actor variants that do not establish the revised history-only pair. Both paired histories and all evidence must be rebuilt after review; the old reference is not validation of this revision. Production natural-language documents, nuanced scoped replies and a frozen paired seed family are still planned. No inference of scientific validity, real conference submission or real partner approval is performed. Author-side traces and prototype limitations have not been submitted as official implementation evidence; reproducible code and results will be added to this PR after plan approval. Any change in rubric outcome requires design review. Difficulty, persona realism and natural-language simulator quality are open empirical questions, not solved by passing local tests.
- **Data provenance and privacy (required):** Entire personas, text fixtures, routes, device serials, prices and policies are invented. Real-world workflow reference: https://docs.openreview.net/how-to-guides/submissions-comments-reviews-and-decisions/how-to-edit-a-submission-after-the-deadline-authors; synthetic scenario details are not the provider's rules; no source screenshots, user accounts, credentials, private messages or third-party personal data are redistributed. The sources ground plausibility, not the claim that these exact tasks defeat current models.
