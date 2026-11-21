# Environment Track proposal

**Proposed PR title:** `[Environment Proposal] [Learning & research] SubmissionDesk`

Proposal stage, prepared 2026-11-21 (America/Chicago). An author-side business prototype exists; it is not a complete PALE App package or official runtime validation. Implementation and verification evidence will be added in this PR after scope approval.

## 1. App and domains

- **Authors / GitHub handles (required):** Hanson Tang ([@hansontang](https://github.com/hansontang)), UIUC; proposed implementation and maintenance owner.
- **Reference app or website / URL (required):** OpenReview (https://openreview.net/), interaction reference only.
- **Primary domain (required):** Learning & research
- **Secondary domains (optional):** None

## 2. What you plan to build

**Your answer (required):** A scholarly release portal that separates immutable source artifacts, public bundles, abstract registrations and received submission snapshots from participant approval. Participants can clarify a purpose or approve a precise scope/bundle, while the portal only enforces structural eligibility and deadlines.

Workflows: Inspect policy/materials �� derive a public artifact �� build an immutable bundle �� register the matching abstract �� preview/commit �� inspect actual receipt. Independently request scoped reviews and observe their exact-bundle replies; changing content never silently transfers approval.

Entities: paper ID, immutable section material, derived-material provenance, ordered authors, bundle digest, venue/policy/cutoffs, abstract receipt, scoped request/reply, active receipt and append-only receipt history.

Business rules: A material cannot be overwritten and a different paper cannot be attached. A preview binds the current content/policy; exact cutoff is closed. Portal acceptance does not certify scientific, authorship or external-release approval. Private scope judgments and reviewer availability belong to task actors. A published restricted item remains in historical receipts after a safe replacement.

Reusable value: A venue-policy correction task, public-release redaction task, or author-order coordination task can reuse these objects without the Alder story. No rubric or preferred venue lives in the Env.

Related work: Research Library #4 and Personal Records #33 cover bibliography/extraction; the distinct scope here is abstract and submission actions plus content-bound release receipts. The proposal-index was checked again on November 21 for related work; overlap does not imply exclusive ownership. Companion Task, submitted separately: Coordinate a corrected scholarly release before a partner becomes unavailable. The App has no dependency on its grader or actor script.

## 3. Potential app connections

- **Internal personal apps (required):** No required cross-App dependency in the first App delivery. Optional Task assembly may use public Mail/Notes for correspondence/context, with separately authorized reads; it must not read another App's private state. The local prototype has ordinary App record reads for fixtures, not a claimed Mail integration. Concrete Messaging delivery, sender identity and receive receipts are excluded until a public contract and acceptance tests are declared.
- **Other apps and websites (required):** None at run time. User/provider actions arrive through validated Infra events. The Task owns simulated actors and event timing. No real accounts, remote APIs or live financial services.

### Integration details

- **Operations and access (required):** Agent-facing prototype surface: `records.list/get`, `venues.list`, `materials.list`, `requests.list`, `submissions.list`, `artifact.derive`, `bundle.create`, `approval.request`, `abstract.register`, `submission.preview/commit`, `report.write`, `state.summary` (14 entry points). Trusted setup management is separate: seed/reset/snapshot, monotonic clock and provider event injection. Agent management calls are rejected in local tests. These local names are not registered PALE tools yet. Port to the [public runtime](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/61b637164e4abddf81536bb48935cdb688a69ff1/runtime/README.md), baseline runtime 1.6.0/Core API 1.2.0 at `61b637164e4abddf81536bb48935cdb688a69ff1`, refreshing the pin before integration. The final Core supplies trusted identity, tool schemas, transport, state ownership and audit. MCP-only first scope needs maintainer agreement; no GUI/CUA implementation is claimed.
- **State and lifecycle (required):** Local instances clone their seeds; write failures roll back, public reads do not mutate, request IDs support identical replay/conflict rejection, expected versions reject stale writes, and virtual time cannot go backward. Business snapshots and ordered history preserve the effects needed for review. The local role argument is an author testing boundary, not a security sandbox. Production acceptance additionally requires Core-enforced account/run ownership, concurrent writers, fresh history loading, separate identities, reset and actual transport tests. Do not give an evaluated agent filesystem access to the private scenario harness or grader. The Task's private intent/state is outside the App class and becomes observable only through performed external actions/replies.
- **Events and notifications (required):** Current declared families: `record.add`, `material.add`, `approval.reply`. Author envelope `{id, at, type, payload}` validates event identity/time and business prerequisites; duplicate IDs have no duplicate business effect, changed replay fails, and rejected events roll back clock/state. The final envelope will map to the runtime's published schema. Event times have explicit UTC offsets; no machine-clock scheduling. App records are directly inspectable status evidence. No outgoing Mail/Calendar delivery is claimed. Task/Infra decides when replies, provider outcomes and physical effects happen; the App never decides when the user will reply or manufactures their consent.
- **Shared data and dependencies (required):** Node.js 18+ and built-in modules for local prototype; no npm install required. Core helper shared only inside this author package. Proposed final folder `apps/submissiondesk/` owns plugin/tool manifests, typed seed/state/event schemas, domain code, fixtures and runtime tests, depending only on the declared public Core. Pilot seeds are small readable synthetic objects, with two actor-side paired situations; final App fixtures will include 3 independent sample accounts and 12�C25 business objects with referentially consistent records. No external App implementation imports, Task answer key, password, code, real identity or scraped asset. The final package must pass standalone launch/reset tests without importing this author's Task harness.

## 4. Construction plan and effort

**Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Web / app construction | Port tested domain subset to a real MCP App; tool manifests, validation, account/run ownership and domain responses; no GUI initially | Public-runtime happy and failure flows; receipts and state match observable responses | 2.5�C3.5 |
| Data and image collection | No data/image scraping; read official workflow guidance for plausibility only | Source log, no copied product assets or private account data | N/A |
| Synthetic data and assets | 3 sample accounts, 12�C25 original business objects, causal history and varied statuses; actual text, identity links and explicit times | Consistency, chronology, content independence and provenance review | 1�C1.5 |
| App integrations | Core MCP and trusted Infra events; no undeclared cross-App delivery | Real transport and separate identities; inspectable provider status | 1�C1.5 |
| Validation and reset | Business paths plus real runtime permissions, boundary time, invalid events, retries/conflicts, multiple accounts/runs, atomicity, load history and reset | Exact pinned versions, commands and resulting object histories; independent reproduction | 2�C2.5 |
| Review and maintenance preparation | Scope/evidence map and limitations; document deferred v1 behavior | Reviewer-ready minimal package; maintain accepted behavior through paper release | 0.5�C1 |

- **Milestones, owners and dependencies (required):** Hanson owns delivery. Scope review first; then Materials/bundles, abstract and received snapshot flow, exact-content review requests/replies, and a runnable MCP adapter with seed/reset and failure evidence. Submit runnable v1 within 14 calendar days of first plan approval, as required by the repository; that is an initial runnable submission milestone, not a claim that all final acceptance work is already complete. The three Environment proposals are ready for parallel design review. Implementation scheduling must respect the 14-day runnable-v1 deadline triggered by each proposal's first plan approval. Final delivery estimated 3�C5 weeks per App including revision but excluding reviewer waiting. No model-validation deadline is inferred from the Env rule.
- **Resources and total effort (required):** 7�C10 additional person-days after scope agreement, including integration/review; reusable setup reduces series overhead but not to zero. Laptop/Node.js and small text fixtures; no GPU or live service costs. All three sequential Apps total approximately 22�C33 person-days, before Task integration and model pilots. GUI, if required, must be rescoped and estimated before approval.
- **Scope boundary and open questions (required):** Working-draft editing, explicit withdrawal, policy/access-change events and multi-account permissions remain planned or deferred; they are not implemented in this author prototype. No claims of OpenReview API equivalence, actual venue submission, research verification or automatic advisor approval. Final tool naming, MCP-only suitability and missing cancel/modify paths must be resolved in scope review rather than hidden as implementation details. Full Task/user harness and model rollouts are separate dependencies; this App is testable without them. The scope limitations above remain explicit; author-side prototype checks do not certify official acceptance.
- **License and external dependencies (required):** Proposed MIT for original code and wholly invented fixtures, subject to upstream contribution terms. No copied source data/images or real account credentials. No hosted component. Real sources establish workflow plausibility only; invented provider rules are prominently labeled.

Before final acceptance, require a positive and negative trace for each declared workflow/event, relevant modify/cancel paths agreed in scope review, history/receipt consistency, reset reproduction, actual MCP launch, denied management access, separate account/run tests, stale/concurrent/retry checks, and independent reviewer execution. Current local tests cover only the author module layer.

Related proposal: [Companion Task proposal #151](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/151). This Environment can run independently of that Task; the Task depends on this Environment's validated delivery.
