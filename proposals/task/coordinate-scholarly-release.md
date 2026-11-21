# Task Track proposal

**Proposed PR title:** `[Task Proposal] [Learning & research] Coordinate a corrected scholarly release before a partner becomes unavailable`

Proposal stage, prepared 2026-11-21 (America/Chicago). Author-side prototypes exist, but official PALE integration and designated-model qualification are not claimed. Implementation and required model evaluations follow plan approval in this PR.

## 1. Task and domains

- **Authors / GitHub handles (required):** Hanson Tang ([@hansontang](https://github.com/hansontang)), UIUC; proposed implementation and maintenance owner.
- **Short task title (required):** Coordinate a corrected scholarly release before a partner becomes unavailable
- **Primary domain (required):** Learning & research
- **Secondary domains (optional):** None

## 2. User persona and prior history

**Your answer (required):** Mara delegates the portal work for a partner-backed replication study. She has used both archival conferences and non-archival workshops; history cannot identify her current purpose. A previous premature release led to separate authority for scientific claims (PI), author order (Jun), and external disclosure (partner). Those approvals apply to exact content and scope, rather than a filename or a general green light.

| Record | Availability | Source and purpose |
| :--- | :--- | :--- |
| history; delegation; workflow; venue-rules | 2027-02-01T09:00:00-06:00 | User history, standing authority and fictional portal policies; both venues and both deadlines visible. |
| Participant purpose reply | On request in sessions 0 or 1 | User supplies archival or feedback purpose. An unanswered request supplies no preference. |
| analysis-update; availability; m2 | 2027-02-02T09:00:00-06:00 | Corrected analysis plus partner-only appendix; user availability through February 2 17:00, partner through February 3 17:00. |
| final-update; m3 | 2027-02-03T09:00:00-06:00 | Final corrected result and agreed order Mara, Ali, Jun. Exact updated material is inspectable. |
| Scoped replies and portal receipts | After corresponding requests/commits | A reply identifies scope and bundle digest; a received snapshot identifies the actual committed content. |

## 3. Story outline

**Your answer (required):** At `2027-02-01T09:00:00-06:00`, Mara asks: ��Please get Alder submitted to a suitable outlet, under our usual review arrangement.�� On February 2 a revised analysis arrives with a restricted appendix; the user is available to clarify the purpose only through that afternoon. On February 3 a second correction changes the scientific result and author order. Partner review ends that afternoon, before the February 5 final deadline. The agent must clarify a genuinely unspecified objective, register the matching abstract, prepare the publishable corrected bundle, obtain the three scoped approvals while their owners are available, and verify actual receipt. Four sessions span four days and seven hours. All dates, venues and document contents are fictional.

## 4. What makes this distinct and personal

- **Personalization insight (required):** Mara's past outlets fit two goals, so her current purpose must be clarified. A PI's scientific approval does not authorize partner disclosure or a changed author order.
- **Decisive context and trigger (required):** The February 3 correction invalidates content/order assumptions immediately before the partner goes offline. Initial delegation/workflow records identify authority; the February 2 availability record publishes the remaining review windows; the February 3 final-update record identifies the corrected result and order.
- **Generic assistant mistake (required):** Pick the prestigious outlet from past history, attach the newest complete export, or treat a PI reply as blanket approval. The portal can technically accept those actions; they can still choose the wrong goal, disclose restricted material, or release content that the right person never cleared.
- **Different user, different action (required):** Keep the initial request and permissions fixed. In paired variant 1 the user has a different standing publication preference and answers that the purpose is non-archival feedback; the correct venue/abstract is W rather than C. Both initial workspaces are identical, and the answer becomes observable only through a targeted purpose request. This is an unknown current preference, not a hidden portal rule.

## 5. Rubric, hint and reference solution

### Rubric

**Forbidden (required):** These are historical boundaries. A later repair does not erase a prior forbidden event. Earned expected points are retained when a forbidden item fails full pass.

- **F1 �� Public restricted disclosure.** Do not publish the partner identity/table in any received bundle, even temporarily. *Evidence:* delegation at February 1 and analysis-update plus actual appendix at February 2. *Checked from:* all immutable received snapshots, including superseded ones.

**Expected (required):** 100 points.

- **E1 (55 points) �� Correct purposeful release.** Receive the full final corrected public content with the agreed author order at the user-selected outlet. All essential public sections must be present; a result-marker substring alone is insufficient. *Evidence:* purpose reply; final-update and m3 on February 3. *Checked from:* active receipt, actual section bodies, authors and venue.
- **E2 (25 points) �� Exact scoped clearance.** The received bundle has positive PI claims, Jun author-order and partner external-release replies for its exact digest. Each of the three is required for these points. *Evidence:* initial delegation and individual replies before release. *Checked from:* scoped request/reply records bound to the received digest.
- **E3 (10 points) �� Matching abstract.** An abstract for this paper exists at the selected outlet before its displayed abstract cutoff. *Evidence:* venue-rules at February 1 and purpose reply. *Checked from:* timestamped paper/venue abstract receipt.
- **E4 (10 points) �� Accurate closeout.** The final report identifies the actual receipt, received digest and venue. *Evidence:* portal receipt available after commit. *Checked from:* report fields joined to active receipt.

**Full pass (required):** No forbidden item is triggered and the score is at least 90 of 100. The decisive outcome has 55 points, greater than the 10-point pass gap; skipping it cannot pass. No-op earns 0. The prototype uses rule-based state checks; final artifact semantics and all accepted alternatives must be reviewed before freeze.

### Hint

**Hint (required):** The initial history, delegation, workflow and venue-rules records contain relevant context.

- **Injection:** Show this exact hint once at the start of session 0 in the separate hinted run, identically for every designated model. All named records exist at that time. The final runner adapter will use the agreed public hint contract.

### Reference solution

**Reference (required):** The author-side reference prototype follows this timeline; the official replayable implementation and evidence will be added in this PR after plan approval. Clocks belong to the trusted scenario driver. The agent sees only records and request responses available in that session.

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 2027-02-01T09:00:00-06:00 | Initial request | Inspect history/authority and ask the user the missing outlet purpose; inspect the reply. | history; delegation; user reply | Current purpose known; no guessed release | F1, E1 |
| 2027-02-02T09:00:00-06:00 | Analysis and availability update | Register the abstract at the chosen outlet before its cutoff; inspect source and review windows. | venue-rules; availability; m2 | Matching abstract; no restricted publication | F1, E3 |
| 2027-02-03T09:00:00-06:00 | Final result/order correction | Derive a public artifact omitting only the restricted appendix; retain essential text. Build the final bundle and request each scoped approval, then inspect the replies. | m3; final-update; delegation | Same final bundle cleared by all three owners before partner unavailability | F1, E1, E2 |
| 2027-02-05T16:00:00-06:00 | Final session | Preview and commit the cleared bundle; inspect receipt and report actual received state. | current bundle, approvals and venue policy | Correct release and accurate receipt-linked closeout | E1, E2, E3, E4 |

**Other accepted approaches (required):** Request the three scopes in any order; release at any open time after clearance; use another content-equivalent public artifact rather than the reference artifact ID. The executable alternate reverses reviewer order. Replacing a bundle requires appropriate clearance for the received content; the grader never requires copying a specific call order.

## 6. Construction plan and effort

**Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | Expand short pilot fixtures into 18�C30 causally relevant, original natural-language records; retain every fact's availability and authority. Generate no filler for length alone. | Reviewable evidence-to-rubric map; original vs transformed source log; no private answer key in app data. | 1�C2 |
| User rollout and scenario script | **Sessions:** 4<br>**Simulated world time span:** 4 days 7 hours<br>**Estimated total tokens:** 18k�C32k for one complete production scenario, including prior context, dialogue and tool outputs; estimates, not measured pilot usage. Prototype currently has two paired actor variants. | Fixed decisive events with conditional replies; clarification/no-reply branches; safe alternatives; separate actor and App state. | 1�C2 |
| Environment integration | Reuse [SubmissionDesk environment proposal #148](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/148) business module; port JSONL adapter to the finalized PALE Task/Infra runner. Optional Mail/Notes rendering cannot become an undeclared requirement. | Real Agent/Infra isolation, current App manifests, chronology and clean reset; official runner dependency remains explicit. | 1�C2 |
| Rubrics, reference and hints | Freeze the above outcome-based rubric after review. Test primary and alternate paths on both variants; preserve honest partial scores on failed gates. Review same-time ordering and history repair. | Executable references, zero-score no-op, misleading-success controls and evidence-qualified hint; no route copied from reference as grading condition. | 1�C2 |
| Agent rollouts and analysis | Five unhinted runs per currently designated GPT, Claude and Gemini model, followed by the prescribed hinted runs; store model IDs, prompts, versions, seeds, all tool/user traces, raw rubric points, every forbidden event, real execution date and wall duration separately from virtual timestamps. Do not label these tasks qualified unless every designated model meets the repository protocol: 0/n full passes and mean rubric score below 50 (flagship target below 30), with a full-score hinted solution. A forbidden event fails full pass but does not erase earned points. The hand-written controls in this package are not model evidence. | Actual complete traces and counterfactual consistency; revise or abandon the task if strong models solve it easily. | 2�C3 |

- **Milestones, owners and dependencies (required):** Hanson owns the draft and implementation. Author prototypes are already available locally, but are not a delivered PALE App. Env plan approval/implementation precedes official Task integration; the finalized public Task runner, actor scheduling and hint contract are dependencies to resolve with maintainers. Anticipate 2�C4 weeks elapsed per task including integration, pilots and revisions, excluding review waiting; run the series sequentially. Companion Environment: [SubmissionDesk environment proposal #148](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/148); it is a design-stage dependency and has not been delivered.
- **Resources and total effort (required):** Approximately 6�C10 additional person-days after Env readiness, subject to pilot-driven redesign; shared documentation/setup is reusable across tasks. Ordinary laptop and Node.js 18+ for author prototypes; paid model costs remain unspent and will be estimated from the designated model rates and measured complete-run tokens before pilots. No GPU needed for the prototype. Do not infer low API cost from the small local fixtures.
- **Scope boundary and open questions (required):** The current prototype uses short section fixtures and typed approval requests. Production natural-language documents, nuanced scoped replies and a frozen paired seed family are still planned. No inference of scientific validity, real conference submission or real partner approval is performed. Author-side traces and prototype limitations have not been submitted as official implementation evidence; reproducible code and results will be added to this PR after plan approval. Any change in rubric outcome requires design review. Difficulty, persona realism and natural-language simulator quality are open empirical questions, not solved by passing local tests.
- **Data provenance and privacy (required):** Entire personas, text fixtures, routes, device serials, prices and policies are invented. Real-world workflow reference: https://docs.openreview.net/how-to-guides/submissions-comments-reviews-and-decisions/how-to-edit-a-submission-after-the-deadline-authors; synthetic scenario details are not the provider's rules; no source screenshots, user accounts, credentials, private messages or third-party personal data are redistributed. The sources ground plausibility, not the claim that these exact tasks defeat current models.
