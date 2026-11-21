# Environment Track proposal

**Proposed PR title:** `[Environment Proposal] [Travel & commuting] TransitWallet`

Proposal stage, prepared 2026-11-21 (America/Chicago). An author-side business prototype exists; it is not a complete PALE App package or official runtime validation. Implementation and verification evidence will be added in this PR after scope approval.

## 1. App and domains

- **Authors / GitHub handles (required):** Hanson Tang ([@hansontang](https://github.com/hansontang)), UIUC; proposed implementation and maintenance owner.
- **Reference app or website / URL (required):** TfL accessibility guidance (https://tfl.gov.uk/transport-accessibility/), workflow reference only; all fares, routes and time rules are invented.
- **Primary domain (required):** Travel & commuting
- **Secondary domains (optional):** None

## 2. What you plan to build

**Your answer (required):** A reservation and assistance module for personal travel: free holds, paid confirmations, cancellations, equipment verification, provider assistance replies, designated journeys and actual physical travel outcomes. A booking, staff confirmation and successful boarding are distinct facts.

Workflows: Inspect routes/windows �� hold a feasible option �� request current equipment verification and route-specific assistance �� confirm/designate a journey �� adapt after service/readiness changes �� cancel unused paid bookings �� reconcile actual travel and ledger.

Entities: route version, capacity dimensions, explicit reservation/confirmation/cancellation windows, booking, measured equipment request, provider reply, selected physical itinerary, actual trip outcome, wallet and append-only spending ledger.

Business rules: A held slot is not paid or confirmed assistance. Provider confirmation describes the declared dimensions; it cannot magically know a user is using stale measurements. Actual travel checks current equipment, service, readiness and matching assistance at departure. Budget authority is a task/user rule, separate from technical balance. Cancellation preserves financial history. Late outbound reservations cannot be manufactured after an outage.

Reusable value: Airport assistance with changed baggage, school transport after a vehicle substitution, and time-sensitive accessible appointments can reuse the reservation/physical outcome model. Route IDs and event schedules are fixture data, not business-code answers.

Related work: Generic travel itinerary and fare tasks do not supply this separate equipment/assistance/physical outcome lifecycle. This is a changed module scope; refresh the proposal-index overlap search before final review rather than claim exclusive ownership. The proposal-index was checked again on November 21 for related work; overlap does not imply exclusive ownership. Companion Task, submitted separately: Preserve an assisted interview journey after equipment and service changes. The App has no dependency on its grader or actor script.

## 3. Potential app connections

- **Internal personal apps (required):** No required cross-App dependency in the first App delivery. Optional Task assembly may use public Mail/Notes for correspondence/context, with separately authorized reads; it must not read another App's private state. The local prototype has ordinary App record reads for fixtures, not a claimed Mail integration. Concrete Messaging delivery, sender identity and receive receipts are excluded until a public contract and acceptance tests are declared.
- **Other apps and websites (required):** None at run time. User/provider actions arrive through validated Infra events. The Task owns simulated actors and event timing. No real accounts, remote APIs or live financial services.

### Integration details

- **Operations and access (required):** Agent-facing prototype surface: `records.list/get`, `routes.list`, `bookings.list`, `requests.list`, `journeys.list`, `verification.request`, `route.hold/commit/cancel`, `assistance.request`, `journey.plan`, `wallet.get`, `report.write`, `state.summary` (15 entry points). Trusted setup management is separate: seed/reset/snapshot, monotonic clock and provider event injection. Agent management calls are rejected in local tests. These local names are not registered PALE tools yet. Port to the [public runtime](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/61b637164e4abddf81536bb48935cdb688a69ff1/runtime/README.md), baseline runtime 1.6.0/Core API 1.2.0 at `61b637164e4abddf81536bb48935cdb688a69ff1`, refreshing the pin before integration. The final Core supplies trusted identity, tool schemas, transport, state ownership and audit. MCP-only first scope needs maintainer agreement; no GUI/CUA implementation is claimed.
- **State and lifecycle (required):** Local instances clone their seeds; write failures roll back, public reads do not mutate, request IDs support identical replay/conflict rejection, expected versions reject stale writes, and virtual time cannot go backward. Business snapshots and ordered history preserve the effects needed for review. The local role argument is an author testing boundary, not a security sandbox. Production acceptance additionally requires Core-enforced account/run ownership, concurrent writers, fresh history loading, separate identities, reset and actual transport tests. Do not give an evaluated agent filesystem access to the private scenario harness or grader. The Task's private intent/state is outside the App class and becomes observable only through performed external actions/replies.
- **Events and notifications (required):** Current declared families: `record.add`, `route.update`, `verification.reply`, `journey.perform`. Author envelope `{id, at, type, payload}` validates event identity/time and business prerequisites; duplicate IDs have no duplicate business effect, changed replay fails, and rejected events roll back clock/state. The final envelope will map to the runtime's published schema. Event times have explicit UTC offsets; no machine-clock scheduling. App records are directly inspectable status evidence. No outgoing Mail/Calendar delivery is claimed. Task/Infra decides when replies, provider outcomes and physical effects happen; the App never decides when the user will reply or manufactures their consent.
- **Shared data and dependencies (required):** Node.js 18+ and built-in modules for local prototype; no npm install required. Core helper shared only inside this author package. Proposed final folder `apps/transitwallet/` owns plugin/tool manifests, typed seed/state/event schemas, domain code, fixtures and runtime tests, depending only on the declared public Core. Pilot seeds are small readable synthetic objects, with two actor-side paired situations; final App fixtures will include 3 independent sample accounts and 12�C25 business objects with referentially consistent records. No external App implementation imports, Task answer key, password, code, real identity or scraped asset. The final package must pass standalone launch/reset tests without importing this author's Task harness.

## 4. Construction plan and effort

**Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Web / app construction | Port tested domain subset to a real MCP App; tool manifests, validation, account/run ownership and domain responses; no GUI initially | Public-runtime happy and failure flows; receipts and state match observable responses | 3�C4 |
| Data and image collection | No data/image scraping; read official workflow guidance for plausibility only | Source log, no copied product assets or private account data | N/A |
| Synthetic data and assets | 3 sample accounts, 12�C25 original business objects, causal history and varied statuses; actual text, identity links and explicit times | Consistency, chronology, content independence and provenance review | 1�C1.5 |
| App integrations | Core MCP and trusted Infra events; no undeclared cross-App delivery | Real transport and separate identities; inspectable provider status | 1�C1.5 |
| Validation and reset | Business paths plus real runtime permissions, boundary time, invalid events, retries/conflicts, multiple accounts/runs, atomicity, load history and reset | Exact pinned versions, commands and resulting object histories; independent reproduction | 1.5�C3 |
| Review and maintenance preparation | Scope/evidence map and limitations; document deferred v1 behavior | Reviewer-ready minimal package; maintain accepted behavior through paper release | 0.5�C1 |

- **Milestones, owners and dependencies (required):** Hanson owns delivery. Scope review first; then Holds/confirmations/cancellations, assistance and travel outcome reads/events, actual ledger, and a runnable MCP adapter with boundary/reset evidence. Submit runnable v1 within 14 calendar days of first plan approval, as required by the repository; that is an initial runnable submission milestone, not a claim that all final acceptance work is already complete. Stage the three Env proposals sequentially for capacity, keeping later ones Draft. Final delivery estimated 3�C5 weeks per App including revision but excluding reviewer waiting. No model-validation deadline is inferred from the Env rule.
- **Resources and total effort (required):** 7�C11 additional person-days after scope agreement, including integration/review; reusable setup reduces series overhead but not to zero. Laptop/Node.js and small text fixtures; no GPU or live service costs. All three sequential Apps total approximately 22�C33 person-days, before Task integration and model pilots. GUI, if required, must be rescoped and estimated before approval.
- **Scope boundary and open questions (required):** No live transit, map assets, medical capability judgment, destination disclosure tool or actual payments. Privacy is enforced by the restricted request schema; broader natural-language disclosure testing is deferred. Final tool naming, MCP-only suitability and missing cancel/modify paths must be resolved in scope review rather than hidden as implementation details. Full Task/user harness and model rollouts are separate dependencies; this App is testable without them. The scope limitations above remain explicit; author-side prototype checks do not certify official acceptance.
- **License and external dependencies (required):** Proposed MIT for original code and wholly invented fixtures, subject to upstream contribution terms. No copied source data/images or real account credentials. No hosted component. Real sources establish workflow plausibility only; invented provider rules are prominently labeled.

Before final acceptance, require a positive and negative trace for each declared workflow/event, relevant modify/cancel paths agreed in scope review, history/receipt consistency, reset reproduction, actual MCP launch, denied management access, separate account/run tests, stale/concurrent/retry checks, and independent reviewer execution. Current local tests cover only the author module layer.
