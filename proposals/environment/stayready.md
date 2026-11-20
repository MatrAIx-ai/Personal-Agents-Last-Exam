# Environment Track proposal

**PR title format:** `[Environment Proposal] [<Domain>] <App or website name>`

**Proposed PR title:** `[Environment Proposal] [Travel & commuting] StayReady — hotel arrival, access and breakfast arrangements`

Proposal-stage design; no implementation or validation results claimed. The local MVP is estimated at **6–7 person-days**. Official platform adaptation and final validation are separately scoped below.

## 1. App and domains

- **Authors / GitHub handles (required):** Ruilin Yao ([@Mr-Bigworth](https://github.com/Mr-Bigworth)), responsible for implementation, validation artifacts and maintenance.
- **Reference app or website / URL (required):** StayReady, an independently branded synthetic hotel guest portal. [Booking.com's official FAQ](https://secure.booking.com/faq.en-gb.html?aid=330843) describes requests after booking, property communication and the need to check arrangements such as arrival outside normal check-in hours. The reference informs the workflow only; StayReady's policies, records and service-state rules are original simulation designs.
- **Primary domain (required):** Travel & commuting
- **Secondary domains (optional):** None. Breakfast and access requirements are services for this booked stay, not separate restaurant or clinical-care workflows.

### Domain names

Use the exact [canonical domain names](../../README.md#environment-domains). Classify this contribution by the accommodation/travel workflow.

## 2. What you plan to build

**✍️ Your answer (required):** A resettable guest portal for maintaining late-arrival, step-free access and breakfast arrangements for an already-booked stay. The agent must connect current personal context to the hotel's actual service commitments: who each arrangement covers, for which stay or morning, through which entrance or access route, and under what conditions. A valid room reservation, a sent request, a hotel acknowledgment and a confirmed service arrangement are distinct records. Useful existing arrangements must survive unrelated edits; changing or cancelling a confirmed service requires a real hotel response.

**Bounded first release:** one fictional property, one fixed two-night reservation for two people per run, a pool of three synthetic people for same-headcount companion substitution, three need types and three GUI views: booking/people/policies; needs/request preview; replies/arrangements/history. Booking dates, occupancy, price and room category remain fixed. Service-context edits do not change the legal booking or perform guest registration. Increasing guest count, changing nights or obtaining another room is outside this release and must not be required by its reference scenarios.

| Service | Public observations and request data | What a hotel commitment records |
| --- | --- | --- |
| Late arrival | Reception hours, dated arrival time, available arrival-instruction descriptions | Explicit arrival window, entrance/meeting point and access method for this stay; fictional instructions only |
| Step-free access | Named traveler and declared functional need; two fixed entrance-to-lodging route descriptions, including steps, lift use and route operating windows | The specific route and applicable stay/time window; a generic “lift available” listing is not a route confirmation |
| Breakfast | Named traveler, breakfast date(s), explicitly declared meal/ingredient request and dated source | Exact supported request and covered mornings, or refusal/clarification; neither a generic menu label nor a reply for another guest establishes coverage |

Route records are structured text, not maps, navigation or room-allocation simulation. No diagnosis or dietary recommendation is inferred. A hotel statement records what was promised; it is not proof that a physical service occurred or a medical-safety guarantee.

**Four complete workflows**

1. **Inspect the stay:** read the reservation, public policies, route details, authorized personal records and actual service history. Source timestamps and provider terms are visible; private future events and grading artifacts are not.
2. **Maintain individual needs:** edit arrival or a person's service requirement, or substitute a companion within the fixed headcount. Keep unknown information unknown and link the relevant source. Changes to breakfast do not automatically invalidate late-arrival or access arrangements.
3. **Request, change or cancel an arrangement:** preview exact property, person, dates, requested action and disclosed fields; submit or discard. Withdraw an unanswered request, request a change to an existing commitment, or request its cancellation. Failed changes preserve the earlier request/commitment. Removing a local need is not confirmation that the hotel stopped preparing a service.
4. **Follow up and verify:** inspect item-specific receipt, acknowledgment, clarification, refusal and confirmation. Check explicit conditions against the current plan, keep still-useful commitments, and address gaps or an unavailable service. The agent cannot manufacture a hotel reply or silently cancel the room booking.

**Personalization and temporal cases**

- A journey delay moves arrival from 21:30 to 00:20 on the next calendar date. The existing late-arrival instructions use an entrance with steps, while the traveler's current note requires step-free passage. A lift amenity alone does not establish that both arrangements work together at that time. Breakfast is unchanged.
- A companion is replaced at the same booked headcount. Their breakfast request and permitted disclosure differ. The previous person's hotel commitment remains a historical and potentially still-active arrangement until an explicit change/cancellation succeeds.
- The hotel already promised a suitable route and arrival window. An unrelated breakfast edit needs follow-up, but resending all requests or disclosing private background again is unnecessary. Conversely, a later notice that the confirmed route is unavailable must remain visible even though the room reservation is still valid.

These are reusable task opportunities, not a fixed script or model-difficulty claim. Tasks choose user history, event timing, permitted actions and success criteria. The app supplies observations and business consequences; it does not select the correct traveler, infer what the user needs, schedule the right next step or produce an overall “stay ready” verdict. Hotel-event fixtures bind to actual submitted request IDs and business references at runtime, not to a single reference execution's assumed request IDs.

**Relationship to existing proposals, checked 2026-11-16**

| Related work | Shared scope | StayReady's proposed increment |
| --- | --- | --- |
| [Switchback #25](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/25) | Personal needs, stale companions, accommodation restrictions, late-arrival notices and facility disruptions | Existing hotel-service commitments with concrete night-entry instructions and entrance-to-lodging route conditions, maintained per person and stay |
| [Lintel #39](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/39) | Requesting and recording non-default accommodation terms | Short-stay operational arrangements rather than rental search, leases, renewals or notices to vacate |
| [Tablewise #40](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/40) | Named people, dietary requests, partial venue acknowledgment, scoped disclosure and preserved commitments | Hotel arrival/access conditions and stay/morning-specific services; breakfast is a supporting workflow, not the novelty claim |
| [Sitting #41](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/41) | Personal plans, time-dependent business state and receipts | No release racing, waitlist, primary/backup bookings, deposits or cancellation fees |

These are adjacent open designs, not accepted implementations or dependencies. Request/confirmation/version mechanisms are shared; the incremental value above needs maintainer design review. No exclusivity or distinct-contribution credit is presumed.

## 3. Potential app connections

- **Internal personal apps (required):** Local fixtures supply authorized Contacts-style person references, dated Notes-style needs and a Calendar-style stay record. The in-app inbox contains hotel replies. Future official adapters could read granted Contacts/Notes, associate the stay with Calendar and deliver hotel notices through Mail. The local MVP includes reference mappings and example notification data, not live connectors or replacement personal apps; actual adapter work and platform evidence are a later milestone.
- **Other apps and websites (required):** None at runtime. An eventual itinerary or flight environment could supply an authorized arrival-change notice, but the baseline uses a task-controlled fixture. No live Booking.com, airline, hotel account or other open environment PR is required.

### Integration details

- **Operations and access (required):** Browser GUI and one shared business layer for reads, need edits, action preview/confirmation, unanswered-request withdrawal and history. Intended action families are read booking/policy/route/person/arrangement, save need, preview/submit arrange-change-cancel, and withdraw pending request. Service cancellation and pending-message withdrawal are different actions. Trusted controls separately load/reset fixtures, snapshot/restore, advance time and inject source/hotel events. They are unavailable to the tested agent. Host-facing transport, identity and permission hooks will follow the first official infrastructure release; there is no claimed PALE API or second standalone MCP implementation in the local budget.
- **State and lifecycle (required):** Separate static property definitions, owner-scoped booking/people/sources, and isolated run state: individual needs, request versions, provider commitments, disclosure receipts, event/request results and clock. Each immutable request binds one need, the target property, affected traveler/stay or morning, selected fields and relevant source versions. At most one pending request exists per need; replacement is transactional. Previews bind those values, relevant record revisions and the current disclosure permission; confirmation rechecks them. Identical IDs and payloads return the original result; conflicting reuse fails without mutation. Snapshots include payload fingerprints/original results, deterministic ID counters and permission versions. All business timestamps use a monotonic simulated clock, with a stable sequence number for equal-time inputs. Restore/reset is the only way to rewind.
- **Events and notifications (required):** Three event families: a dated personal-source update; a hotel reply to a named request; and a hotel notice making a named commitment unavailable, with reason/effective time. A reply may acknowledge receipt, ask for clarification, decline, confirm service terms or confirm cancellation. For example, an arrival reply can confirm an explicitly dated window plus an entrance/access-method reference. A route-unavailable notice changes that commitment's current service state while retaining the original promise. Events carry stable IDs and expected referenced versions; contradictory replies and unknown references are rejected atomically. Tasks choose order, timing and silence; adapters never choose a favorable reply. In-app notices include their source and affected IDs. No actual email is sent and an app receipt does not imply that a human read it.
- **Shared data and dependencies (required):** Stable booking, person, source, need, request, route, commitment and receipt IDs; typed UTC instants, explicit property timezone and morning dates; plain UTF-8/JSON. Baseline fixtures use UTC to avoid a separate DST-conversion feature while still representing after-midnight arrival explicitly. Each personal field records readability and permission to disclose to this property. A readable private background note is not automatically shareable; outgoing records contain exactly the previewed permitted service fields, not entire profiles or diagnosis narratives. Past disclosure records cannot be erased by later edits. Proposed stack: Python, a small web framework, SQLite and server-rendered HTML; versions/licenses are locked during implementation. No scans, images, real identity verification or external runtime service.

**Request, commitment and applicability rules**

- A request progresses through submitted/acknowledged/needs-clarification to confirmed or declined, or is withdrawn/superseded while pending. Final replies are immutable; identical repeats are harmless, conflicting final replies are rejected. A stale reply for a withdrawn/superseded attempt is retained as history and cannot overwrite the current attempt.
- A service commitment is independently active, cancelled, superseded or unavailable. Submitting a change/cancellation does not remove the active commitment. Hotel-confirmed change atomically installs the replacement and supersedes the referenced commitment; confirmed cancellation marks only its referenced commitment cancelled. Rejection, silence or failed writes leave earlier commitments intact.
- Applicability is **per service**, using traveler/stay, service parameters, covered dates/windows and route conditions. There is no global plan-version rule that revokes all arrangements. Unrelated edits preserve existing requests and promises. Updating a source records what changed and flags only linked needs for review; it does not itself cancel a service.
- A reply to a still-pending request records the terms the hotel actually confirmed, even if the traveler has since changed their plan. That historical fact must not be presented as confirmation of the new requirement. An existing promise may remain useful if its explicit coverage still fits; the app exposes those conditions without deciding the user's preferences.
- Only pending requests can be withdrawn directly. Cancelling an already-confirmed service uses a separate provider-acknowledged cancellation request. A later service-unavailable event references the commitment rather than rewriting its original reply. None of these operations cancels the room reservation.
- Same-headcount substitutions are supported; duplicate/unknown people, invalid dates, out-of-stay breakfast dates, dangling sources, unauthorized disclosure and stale relevant versions fail without partial effects. Room-date/headcount changes are visibly unsupported and are excluded from required reference paths.

## 4. Construction plan and effort

One experienced Python/basic-Web developer, approximately eight hours per person-day. Estimates cover the local implementation and evidence below; all counts/results are planned.

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Web / app construction | Three views and four workflows; per-need request/commitment core, disclosure preview, local trusted events and lifecycle. One property, fixed stay, two route descriptions; reuse framework forms and SQLite transactions. | **D1:** complete read/edit/arrange/change/cancel/withdraw flows; visible typed errors; failed change preserves prior state; unrelated needs retain their commitments. | 3.00–3.50 |
| Data and image collection | Review public interaction references and dependency reuse. No hotel scraping, photography or map assets. | **D2:** provenance/license manifest; images N/A for text-only views. | 0.25 |
| Synthetic data and assets | One baseline plus six small fixture variants; three people, two staying at a time; three need categories, 2–4 short request/reply histories and 4–8 event inputs per variant. Hand-author dated context and explicit hotel terms. | **D3:** linked JSON fixtures, readable text, fixed expected outcomes and both feasible/refused/unknown paths; no answer labels in public records. | 0.75–1.00 |
| App integrations | Local source/reference mapping, sample event and notification I/O, and a documented thin adapter boundary; no live shared-app implementation. | **D4:** documented agent/platform operation separation and consistent person/stay IDs. Official transport and shared-app tests are a later milestone, not claimed locally. | 0.25 |
| Validation and reset | Business/permission/race checks, browser smoke tests, deterministic reset/restore, clean local reproduction and recorded reference/incorrect/control executions. | **D5:** evidence matrix below; **D6:** setup/dependency instructions, inputs, expected outputs and failure analysis ready for later platform replay. | 1.75–2.00 |
| **Local MVP total** | **Implementation plus local evidence, without booking commerce or real connectors** | **D1–D6; no claim of final platform acceptance** | **6.00–7.00** |

**Six fixture-based verification groups**

| Fixture | Business result to verify | Controls and observable evidence |
| --- | --- | --- |
| F1: overnight arrival/access | Changed arrival is reconciled with the confirmed entrance/route windows; original room booking stays valid | Reference sequence obtains matching arrangements or accurately leaves a provider refusal unresolved. No action/using “lift available” as proof leaves the mismatch. Save actual terms and receipts, not merely a count of reads. |
| F2: companion substitution | Current person's dated breakfast/access need is addressed; former person's unwanted service is explicitly handled | A reply for another person/morning cannot stand for current coverage. Check cancellation pending versus hotel-confirmed cancellation. Private background omitted from the permitted request. |
| F3: independent arrangements | Update only an affected need; retain already-suitable late-arrival/access commitments | An unchanged, already-covered case requires no new request. Resending/disclosing everything is not required for a pass; ordinary record edits cannot erase the old arrangements. |
| F4: partial replies/change/cancel | Received, unanswered, clarification, refusal and commitment remain distinct; failed change or declined cancellation preserves the previous service | Only a valid hotel confirmation creates/replaces/cancels a commitment. A late answer to earlier terms cannot prove that new terms were accepted; superseded replies cannot corrupt the current attempt. |
| F5: changed source/service/authority | A relevant update is traceable; a named route-unavailable event changes only its commitment; disclosure permissions are rechecked at send | Reject stale previews or newly forbidden fields. Retain the original hotel statement and actual disclosure history; do not revoke unrelated services or silently restore an unavailable route. |
| F6: replay/isolation/races | Duplicates, conflicts, simultaneous change/reply orderings and independent runs behave deterministically | Same input ID/payload returns original result; changed payload fails. Snapshot/restore reproduces business state, counters and retry results; agent cannot inject hotel decisions, read another run or obtain future schedules. |

For each relevant business fixture, provide a valid reference execution, no-action control and at least one representative incorrect execution with an explicitly failing outcome check. F3 additionally includes a case where no new external action is correct. Accept alternative valid sequences; do not grade a fixed call order. These are environment checks, not claims of Task Track difficulty.

Evidence records fixture/schema version, seed, initial canonical state hash, ordered actions/events, receipts, final state, check results and concise failure analysis. Canonical state includes lifecycle/deduplication state and excludes wall-clock/log-format noise. Full snapshots and hidden Task rubrics remain evaluation-side. A fresh local instance must reproduce the supplied sequences; actual platform reproduction and Agent trials remain later evidence.

- **Milestones, owners and dependencies (required):** Ruilin Yao (@Mr-Bigworth) owns D1–D6 and maintenance. M0: design review of incremental scope, service semantics and interface assumptions. M1, days 1–2 after approval: rules, fixtures and transactional core. M2, days 3–4: three views and workflow/error paths. M3, days 5–7: verification matrix, browser checks and clean local reproduction. Review/infrastructure waiting is additional. M4: after official interfaces/access are available, implement the required platform adapter, validate declared integration behavior, provide fresh-platform reproduction and Agent trials/failure analysis; agree its effort/resources and an independent reproducer before that work. No adjacent PR blocks local development.
- **Resources and total effort (required):** 6–7 local person-days, on a normal CPU laptop with 8 GB RAM; target text fixtures below 1 MB and local state/logs below 100 MB excluding dependencies. No GPU, paid data collection, generation or model service is required for D1–D6; expected incremental paid-service cost is zero. Official integration/independent validation and later model-run cost are TBD at M4 because contracts and runtime access are not yet published. Thus 6–7 days is not a promise for the complete accepted contribution. Re-review scope if this cap is exceeded.
- **Scope boundary and open questions (required):** Exclude discovery, new reservations, room-date/headcount changes, room assignment, prices/payments/refunds, physical access control, actual guest registration, real communications and clinical conclusions. The local baseline records simulated hotel service commitments, not physical delivery. No reference task may require an excluded action to succeed. Resolve with maintainers whether this hotel-specific scope adds sufficient value relative to #25/#39/#40, and which public host contracts support the operation/permission/lifecycle boundary. Those are design-review questions, not assertions that adoption is already agreed. Stable slug: `stayready`; planned initial artifact version 0.1.0, to be confirmed before merge.
- **License and external dependencies (required):** Original code and synthetic fixtures will use MIT, with recorded dependency versions/licenses and notices. Public product pages inform workflow only; no commercial code, photographs, copied hotel policies, real names, health records, credentials or identity documents are collected. Redistribute the baseline package and fixtures; no hosted-only component or external evaluation-time service. Fixed inputs, explicit time and ordered events provide controlled replay.

After plan approval, add implementation and evidence for D1–D6 and M4 to the same PR. Material scope changes require another design review. Final acceptance requires the validated merge under [CONTRIBUTING](../../CONTRIBUTING.md#review-and-implementation); a proposal, local fixture run or copied interface example is not platform validation.
