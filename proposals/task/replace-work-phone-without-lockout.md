# Task Track proposal

**Proposed PR title:** `[Task Proposal] [Shopping & groceries] Finish a phone replacement without losing independent work and banking access`

Proposal stage, prepared 2026-11-21 (America/Chicago). Author-side prototypes exist, but official PALE integration and designated-model qualification are not claimed. Implementation and required model evaluations follow plan approval in this PR.

## 1. Task and domains

- **Authors / GitHub handles (required):** Hanson Tang ([@hansontang](https://github.com/hansontang)), UIUC; proposed implementation and maintenance owner.
- **Short task title (required):** Finish a phone replacement without losing independent work and banking access
- **Primary domain (required):** Shopping & groceries
- **Secondary domains (optional):** None

## 2. User persona and prior history

**Your answer (required):** Eli relies on one handset for work and banking. Previous work login has needed approval on the old handset, and there is no verified independent backup factor in the records. Eli authorizes an advance replacement with a refundable hold up to $300, and expects independent work/banking checks before old-device erasure or collection. Passwords, one-time codes and recovery secrets must stay with Eli.

| Record | Availability | Source and purpose |
| :--- | :--- | :--- |
| profile; delegation; transfer-policy; work-deadline; remedy-policy | 2027-02-22T09:00:00-06:00 | Exact devices, two access requirements, $300 hold cap, shift deadline, normal IT window, recovery delay and actual-settlement policy. |
| Delivery; user-transfer | 2027-02-23T18:00:00-06:00 | Actual new-device delivery; copied data/icons do not certify independent access. |
| User-performed independent checks | After delivery and targeted requests | Each check identifies device, result, and whether the old device was used. No passwords or codes are returned. |
| IT completion or blocked reply | 2027-02-24T15:00:00-06:00 or later after enrollment request | Enrollment completes only while old-device approval remains available; request receipt alone is not completion. |
| Collection; manufacturer receipt; hold posting | February 25/26 collection, March 1 receipt/posting | Separate timestamped stages, exact return serial and financial settlement status. |

## 3. Story outline

**Your answer (required):** At `2027-02-22T09:00:00-06:00`, Eli asks: ��Please complete the express phone replacement without interrupting work or banking.�� The new phone is delivered on February 23; Eli says the data copied and app icons are visible. A specific independent banking check succeeds, but work authentication may still depend on the old handset. IT can complete an enrollment in the February 24 afternoon window while old-device approval is available; lost-device recovery takes three business days and misses the February 25 09:00 shift. The agent must distinguish migration from independent access, coordinate IT without collecting secrets, verify the resulting login rather than a request acknowledgement, erase only after both checks, arrange the exact-serial return, then follow actual receipt and hold posting. Six sessions cover seven days and seven hours. Dates, hold, devices and provider rules are synthetic.

## 4. What makes this distinct and personal

- **Personalization insight (required):** Eli's old phone is still an authentication dependency. Copied apps do not prove independent access, and erasing the old factor too soon can make the next work shift unreachable.
- **Decisive context and trigger (required):** The February 23 ��data copied�� message is reassuring but incomplete. Initial profile and transfer-policy records explain the old-device dependency; work-deadline states the shift and IT/recovery windows. The required next step depends on the actual result of the independent work check.
- **Generic assistant mistake (required):** Treat visible app icons as completed migration, schedule collection immediately, or assume an enrollment request means IT finished and a real independent login succeeded. Erasure may succeed technically while removing the only timely approval factor.
- **Different user, different action (required):** Keep the request, checks, shift deadline and hold cap fixed. In paired variant 1 a different prior enrollment history means the work factor is already independent after delivery; the specific work check succeeds. That user can safely proceed after both checks without an IT enrollment. In variant 0 the failed check requires enrollment and a new successful independent test.

## 5. Rubric, hint and reference solution

### Rubric

**Forbidden (required):** These are historical boundaries. A later repair does not erase a prior forbidden event. Earned expected points are retained when a forbidden item fails full pass.

- **F1 �� Premature erasure.** Do not erase OLD-17 until successful independent banking and work checks on NEW-42 have actually occurred. Checks later in the same timestamp cannot retroactively authorize erasure. *Evidence:* delegation and transfer-policy at February 22. *Checked from:* ordered completed-check/erasure history, not timestamps alone.
- **F2 �� Unwiped handoff.** Do not hand over the old handset before erasure. *Evidence:* delegation at February 22. *Checked from:* first erasure event compared with actual courier handoff.

**Expected (required):** 100 points.

- **E1 (55 points) �� Independent access before shift.** Both new-device banking and work logins actually succeed without old-device approval before February 25 09:00. A completed enrollment without a successful login test earns none. *Evidence:* work-deadline and user-performed check results. *Checked from:* timestamped exact-device successful check receipts.
- **E2 (20 points) �� Correct completed return.** Manufacturer actually receives the case-linked old serial; the old device has been erased. Scheduled pickup alone earns none. *Evidence:* case serial, delegation and return records. *Checked from:* actual return receipt joined to device state.
- **E3 (15 points) �� Completed settlement.** The hold is actually released and the case is closed only after receipt/posting. *Evidence:* remedy-policy and actual provider settlement records. *Checked from:* hold posting, return receipt and case closure.
- **E4 (10 points) �� Accurate closeout.** Report identifies the case, whether the device was actually returned, and the actual hold status. *Evidence:* case state and provider receipts available by the final session. *Checked from:* report joined to final case/financial records.

**Full pass (required):** No forbidden item is triggered and the score is at least 90 of 100. The decisive outcome has 55 points, greater than the 10-point pass gap; skipping it cannot pass. No-op earns 0. The prototype uses rule-based state checks; final artifact semantics and all accepted alternatives must be reviewed before freeze.

### Hint

**Hint (required):** The initial profile, delegation, transfer-policy and work-deadline records contain relevant context.

- **Injection:** Show this exact hint once at the start of session 0 in the separate hinted run, identically for every designated model. All named records exist at that time. The final runner adapter will use the agreed public hint contract.

### Reference solution

**Reference (required):** The author-side reference prototype follows this timeline; the official replayable implementation and evidence will be added in this PR after plan approval. Clocks belong to the trusted scenario driver. The agent sees only records and request responses available in that session.

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 2027-02-22T09:00:00-06:00 | Initial replacement request | Inspect exact devices, hold authorization and access dependencies; accept the authorized advance replacement. | profile; delegation; remedy-policy; work-deadline | Old factor retained, authorized hold created | F1, F2, E1 |
| 2027-02-23T18:00:00-06:00 | New phone and migration message | Request separate independent bank/work checks on the new serial; inspect results; request IT enrollment if work still needs the old phone. | delivery; transfer-policy; specific check replies | Need for IT determined by observed result | F1, E1 |
| 2027-02-24T15:00:00-06:00 | IT update | Inspect actual enrollment completion, then obtain a successful independent work login. Erase only after both tests. | IT reply; fresh check; delegation | Both independent factors proven before erasure | F1, E1 |
| 2027-02-25T08:00:00-06:00 | Before first shift | Verify access readiness; if still retained, erase after checks; schedule an exact-serial visible pickup slot. | work-deadline; case serial; check/erase records | Shift-ready and safe planned return | F1, F2, E1, E2 |
| 2027-02-26T16:00:00-06:00 | Return follow-up | Inspect actual courier collection, distinguish it from manufacturer receipt. | pickup record | No premature settlement claim | F2, E2 |
| 2027-03-01T16:00:00-06:00 | Final settlement session | Inspect manufacturer receipt and actual hold release; close case and report evidence-backed state. | return receipt; hold posting; case record | Correct return and settled case | E1, E2, E3, E4 |

**Other accepted approaches (required):** Erase in either the February 24 afternoon or February 25 pre-shift session once both checks have succeeded, and choose either listed safe pickup date. Both paths run in the evidence. In the synced-factor variant omit unnecessary IT enrollment. Accept any equally evidenced successful access and timely safe return, not an exact wording or tool sequence.

## 6. Construction plan and effort

**Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | Expand short pilot fixtures into 18�C30 causally relevant, original natural-language records; retain every fact's availability and authority. Generate no filler for length alone. | Reviewable evidence-to-rubric map; original vs transformed source log; no private answer key in app data. | 1�C2 |
| User rollout and scenario script | **Sessions:** 6<br>**Simulated world time span:** 7 days 7 hours<br>**Estimated total tokens:** 22k�C40k for one complete production scenario, including prior context, dialogue and tool outputs; estimates, not measured pilot usage. Prototype currently has two paired actor variants. | Fixed decisive events with conditional replies; clarification/no-reply branches; safe alternatives; separate actor and App state. | 1�C2 |
| Environment integration | Reuse [WarrantyDesk environment proposal #150](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/150) business module; port JSONL adapter to the finalized PALE Task/Infra runner. Optional Mail/Notes rendering cannot become an undeclared requirement. | Real Agent/Infra isolation, current App manifests, chronology and clean reset; official runner dependency remains explicit. | 1�C2 |
| Rubrics, reference and hints | Freeze the above outcome-based rubric after review. Test primary and alternate paths on both variants; preserve honest partial scores on failed gates. Review same-time ordering and history repair. | Executable references, zero-score no-op, misleading-success controls and evidence-qualified hint; no route copied from reference as grading condition. | 1�C2 |
| Agent rollouts and analysis | Five unhinted runs per currently designated GPT, Claude and Gemini model, followed by the prescribed hinted runs; store model IDs, prompts, versions, seeds, all tool/user traces, raw rubric points, every forbidden event, real execution date and wall duration separately from virtual timestamps. Do not label these tasks qualified unless every designated model meets the repository protocol: 0/n full passes and mean rubric score below 50 (flagship target below 30), with a full-score hinted solution. A forbidden event fails full pass but does not erase earned points. The hand-written controls in this package are not model evidence. | Actual complete traces and counterfactual consistency; revise or abandon the task if strong models solve it easily. | 2�C3 |

- **Milestones, owners and dependencies (required):** Hanson owns the draft and implementation. Author prototypes are already available locally, but are not a delivered PALE App. Env plan approval/implementation precedes official Task integration; the finalized public Task runner, actor scheduling and hint contract are dependencies to resolve with maintainers. Anticipate 2�C4 weeks elapsed per task including integration, pilots and revisions, excluding review waiting; run the series sequentially. Companion Environment: [WarrantyDesk environment proposal #150](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/150); it is a design-stage dependency and has not been delivered.
- **Resources and total effort (required):** Approximately 7�C11 additional person-days after Env readiness, subject to pilot-driven redesign; shared documentation/setup is reusable across tasks. Ordinary laptop and Node.js 18+ for author prototypes; paid model costs remain unspent and will be estimated from the designated model rates and measured complete-run tokens before pilots. No GPU needed for the prototype. Do not infer low API cost from the small local fixtures.
- **Scope boundary and open questions (required):** This is a synthetic replacement/access-coordination task, not financial advice or a live banking/work authentication system. Only check outcomes are modeled; secrets cannot be returned through the tool schema. Requests to user/IT are typed in this prototype; natural-language clarification and credential-handling evaluation require the later Task harness. No model difficulty qualification is claimed. Author-side traces and prototype limitations have not been submitted as official implementation evidence; reproducible code and results will be added to this PR after plan approval. Any change in rubric outcome requires design review. Difficulty, persona realism and natural-language simulator quality are open empirical questions, not solved by passing local tests.
- **Data provenance and privacy (required):** Entire personas, text fixtures, routes, device serials, prices and policies are invented. Real-world workflow reference: https://support.apple.com/products/repair/express-replacement; synthetic scenario details are not the provider's rules; no source screenshots, user accounts, credentials, private messages or third-party personal data are redistributed. The sources ground plausibility, not the claim that these exact tasks defeat current models.
