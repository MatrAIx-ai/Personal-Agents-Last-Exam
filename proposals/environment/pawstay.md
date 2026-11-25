# Environment Track proposal

**Proposed PR title:** `[Environment Proposal] [Health & care] PawStay pet boarding and care-plan handoffs`

Prepared on 2026-11-22. This document proposes planned deliverables; it does not claim an implementation, successful validation or acceptance.

## 1. App and domains

- **Authors / GitHub handles (required):** [@QYechang](https://github.com/QYechang), proposal author and proposed implementation/maintenance owner. Prepared with AI assistance. A non-author reviewer will be asked to reproduce the implementation.
- **Reference app or website / URL (required):** PawStay, an independently branded synthetic overnight pet-boarding service. Public workflow references: Rover's [pet profile management](https://support.rover.com/hc/en-us/articles/206195383-How-do-I-add-edit-or-delete-a-pet-profile) and [sitter search and booking](https://support.rover.com/hc/en-us/articles/203062280-How-do-I-find-a-sitter-or-dog-walker-for-my-pet). They inform care profiles, provider selection and mutual booking acceptance. Version-specific care acknowledgment, inventory rules, prices and event behavior below are PawStay's synthetic contract, not representations of Rover's implementation or current terms.
- **Primary domain (required):** Health & care
- **Secondary domains (optional):** None

### Domain names

This proposal uses the official `Health & care` domain for animal-care arrangements. A user's travel can motivate a task, but human travel reservations are not part of the App.

## 2. What you plan to build

**✍️ Your answer (required):** A resettable browser App and MCP business interface for overnight dog boarding in one fictional city. One household has two dog profiles and can choose among six providers. The App separates a confirmed reservation, the exact care instructions accepted by the provider, and actual provider-recorded service. An agent can preserve valid care while arranging a change rather than mistaking an unanswered request for a commitment.

| Workflow | First-version behavior | Observable outcome and control path |
| :--- | :--- | :--- |
| Pet profiles and care instructions | Inspect/update dog profiles and create versioned instructions covering feeding, exercise, time alone and separation from other animals. | Profile changes do not silently replace instructions accepted for an existing stay. Prior versions remain identifiable. |
| Compatible provider selection and booking | Search dates/capabilities; inspect terms; request a stay; inspect provider offers; confirm or decline an offer. | Capacity, pet compatibility, exact dates, cost and accepted care version are checked at confirmation. An unanswered request is not a reservation. |
| Care-plan acknowledgment | Propose updated instructions for a booking and inspect acceptance/rejection of that revision. | The current proposal, last accepted instructions and any unresolved requirement remain distinct. Provider acceptance must reference the exact revision. |
| Stay changes and fulfillment | Request an extension or future replacement; cancel valid future bookings; inspect handover, care updates, checkout and notices. | Pending changes preserve the existing booking. Actual service comes from provider events; requests and receipts alone do not prove care occurred. |

**First-version scale.** One city, one household, two dogs, six synthetic providers, fourteen days of availability and six fixture snapshots. Four main browser views support these workflows. Only overnight boarding is offered; providers have explicit capacities and a small structured capability catalog. Task authors can replace profiles, provider history and event timelines through the seed schema.

**Business contract.**

- Profiles record household ownership and non-clinical care requirements. A care-plan revision belongs to a specified dog and booking; a multi-dog booking identifies each dog and its applicable revision. Provider capability records expose capacity, whether resident/other guest dogs are present, supported separation arrangements, exercise options and maximum unattended time. Compatibility rules and all required information are visible; remembered preference for a provider does not override current needs.
- A request progresses through `requested`, `offered`, then `confirmed`, with rejection, withdrawal and expiry paths. A provider offer identifies the pets, service interval, price, care revisions and acceptance deadline. An effective offer reserves inventory until its deadline. The household must explicitly confirm while the offer is valid; confirmation rechecks capacity and compatibility atomically. It returns one reservation receipt, never a second booking on an identical retry.
- Define service intervals as half-open timestamp ranges in one documented city timezone, with a visible nightly charging rule. Confirmed reservations consume capacity until cancellation or checkout. Other households' inventory usage appears only as aggregate availability. Concurrent confirmations cannot allocate the last place twice. Search results are observations, not capacity guarantees.
- Saving a profile does not change a stay's accepted instructions. Publishing a revised booking care plan creates a pending proposal while retaining the previously accepted revision. A provider response identifies the proposal revision it accepts or rejects. The App shows an unresolved-care flag when a new required condition has not been accepted or conflicts with the provider's capability. Existing reservation history is preserved; a green booking status cannot hide the unresolved requirement.
- Extension requests identify the additional interval and terms; the original reservation remains effective while the request is pending or rejected. An accepted extension offer must be confirmed and rechecked just like a new booking. Future replacement bookings are separate reservations. The agent may secure one and then explicitly cancel the unwanted future reservation; the App neither performs an invisible cross-booking swap nor guarantees that two actions will both succeed. Display any overlap, resulting cost and uncovered interval.
- Owner cancellation is allowed before check-in, with a documented synthetic cancellation fee preview. Withdrawing an unconfirmed request/offer releases any effective hold without cancelling another reservation. In-progress boarding cannot be ended by editing the reservation; checkout requires a provider event. Actual handovers between providers are external facts supplied by the scenario, not inferred from adjacent bookings. Provider cancellation is a separate event that exposes the affected interval and unresolved coverage. Care notes are provider assertions, not proof of physical-world behavior beyond the simulated event contract.
- Use previews and explicit confirmation for paid commitments, cancellation and care-plan publication. Include targets, revisions, service dates and full simulated costs. Abandonment has no requested effect. A stale observation fails without overwriting newer state. Identical accepted request IDs replay the original result; conflicting reuse is rejected. Use Core's version/commit mechanisms and compatible SDK helpers rather than inventing another transaction service.

**Value for personal-agent tasks.** A familiar sitter may no longer fit a dog's current need for separation from other animals. A delayed return can create a care gap even when the original stay is confirmed. A new feeding instruction may be saved in the profile but remain unaccepted for the stay. Tasks can combine these conditions to assess whether an agent updates stale assumptions, protects existing coverage and verifies the precise service commitment. The App contains reusable rules and evidence, not a preferred provider, hidden user preferences or a fixed Task solution.

**Related proposals and added value.** [Brightwire #86](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/86) mentions a pet sitter in a smart-home access scenario, but owns devices and guest permissions. [StayReady #44](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/44) owns human hotel service arrangements. PawStay instead owns pet-specific care compatibility, provider inventory, accepted instruction revisions and boarding fulfillment. It will not reproduce home access or a generic human hotel portal. These are related proposals, not package dependencies. The 2026-11-24 review of public PRs also identified [CloverVet #184](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/184). CloverVet checks veterinary eligibility over a proposed boarding interval and can issue a clearance certificate. PawStay manages the provider's available places, reservation, accepted care instructions and actual check-in/out. Veterinary clearance stays outside v1. The review found no dedicated environment for these boarding-provider workflows.

## 3. Potential app connections

- **Internal personal apps (required):** None required in v1. Optional future Mail notifications or agent-managed Calendar entries would use the receiving Apps' public contracts after a separate scope review. The booking timeline and in-App notices remain domain records; PawStay does not implement a general inbox or calendar.
- **Other apps and websites (required):** None in v1. Rover is a public design reference, not a service dependency. Human travel changes may arrive through Task context; there is no automatic airline/hotel integration, smart-lock connection or real payment service.

### Integration details

- **Operations and access (required):** Propose `apps/pawstay/`, subject to maintainer review. MCP reads cover authorized pets, care versions, provider capabilities/availability, offers, reservations, coverage intervals, provider updates, charges and receipts. Writes cover profile updates and previews/confirmation/withdrawal of booking, care revision, extension and cancellation actions. Separate Infra-only management handles seed/history loading, provider events, reset and snapshots. Agents cannot accept on behalf of a provider, post provider care notes or mark their own service complete. Use lowercase `pawstay.<name>` tool names and require `request_id` and `expected_version` on every write. The seed identifies the acting person and role. The policy allow-list restricts available tools. The [shared Web Host](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/main/runtime/web/README.md) serves the App's page and controller over a fixed Agent MCP connection. Use its shared stylesheet and consult Infra if additional styles are needed.
- **State and lifecycle (required):** Separate fixed capability/pricing rules from household records, per-run inventory, requests/offers, bookings, care versions and provider-event history. Validate ownership and foreign IDs on every operation. Provider-facing updates enter through trusted synthetic events; the agent session remains the household actor. Core owns persistence, policy checks and revisions. Denied actions preserve business data while ordinary audit may be recorded. Runs are isolated. Reset reconstructs the loaded baseline, including virtual time, capacity usage, accepted revisions, offers and simulated charges. Reset clears Core receipts and audit. Export evidence first. An administrative snapshot is inspection evidence, not a promise of arbitrary restoration.
- **Events and notifications (required):** Declare provider-offer/decision, care-revision response, provider cancellation, availability/capability update, handover/check-in, care update and checkout events. Infra advances `ctx.virtual_now` through `env.advance_time`. The Task orders simultaneous events. Reads derive offer expiry and available places from hold deadlines at the current virtual time. Clock advancement and reads leave business records unchanged. The next successful write or event evaluates the same boundaries and commits any due effects and notices once. Actual arrival or departure requires a provider event. Notices link to the originating record. All notifications stay in the App. [Runtime time contract](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/main/docs/runtime-time.md)

  ```json
  {
    "event_id": "pawstay-1",
    "at": "2026-11-02T14:00:00Z",
    "operation": "pawstay.care_response",
    "payload": {
      "provider_id": "provider-02",
      "booking_id": "stay-03",
      "pet_id": "pet-01",
      "care_revision_id": "care-08",
      "decision": "accepted"
    }
  }
  ```

  Records the booked provider's acceptance of this dog's pending care revision. A later revision still needs its own acknowledgment.

  ```json
  {
    "event_id": "pawstay-2",
    "at": "2026-11-02T18:00:00Z",
    "operation": "pawstay.check_in",
    "payload": {
      "provider_id": "provider-02",
      "booking_id": "stay-03",
      "pet_id": "pet-01"
    }
  }
  ```

  Given a confirmed stay whose arrival window includes the event time, records this dog's arrival with the booked provider. Duplicate delivery leaves one check-in.

- **Shared data and dependencies (required):** Use synthetic person/account, pet, provider, booking, request/offer, care-revision and event IDs with a binding fixture. Seeds/history use UTF-8 JSON. Accessible HTML/text and the shared Host stylesheet require no photographs, maps, veterinary documents or other attachments. Required platform dependency: public Core with Infra clock advancement, currently documented in runtime 1.6.0. M1 pins an exact repository revision and compatible contracts; runtime checks use that fixed baseline. Follow the [delivery guide](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/main/docs/app-contribution.md) and [architecture boundaries](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/main/docs/environment-architecture.md). Reuse shared schemas/SDK helpers; do not copy another App or create a replacement Core. No other App package is required.

## 4. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Web / app construction | Build four browser views and matching MCP operations; implement care revisions, compatibility, six-provider inventory, offer/confirmation, extension/cancellation and provider fulfillment records. Use a small Node.js package, lightweight HTML/CSS/JavaScript and compatible runtime helpers. | All four workflows function through the shared Web Host and MCP, including modify/withdraw/cancel, provider rejection, stale offers and failures without partial mutation. | 5-6 |
| Data and image collection | Review the two linked official help pages; document source/access dates and modeled interaction patterns. No crawling, provider reviews, photographs or customer data. | Provenance/reuse manifest and no broken external-media requirement. | 0.5 |
| Synthetic data and assets | Author two dog profiles, six provider profiles, fourteen days of capacity and synthetic stay and care-plan history; six snapshots: routine booking, incompatible repeat provider, unaccepted care revision, extension rejection, provider cancellation and last-slot contention. | Consistent IDs, dates, capacities, prices and accepted versions; fixture expectations and reproducible generation/validation. Generate history beginning on 2025-01-01 UTC. Start the Task timeline on 2026-01-01 UTC. Check that the earliest historical record is dated 2025-01-01 and that each snapshot includes only history preceding its seed time. Later snapshots can cover roughly two years of activity. | 1.5-2 |
| App integrations | Package the App, declarations, policies, binding/event examples and the Web Host page and controller declaration against one pinned public runtime. No external App integration. | Real Agent/Infra MCP calls, compatible time behavior, seed/event loading and GUI/MCP state parity. App-only tests run independently of other Apps. | 1.5-2 |
| Validation and reset | Domain, concurrency, retry, event, replay/reset and browser tests; public verifier; fresh-checkout reproduction and two Agent smoke trials. | Evidence tied to the cases below, all four GUI workflows, deterministic replay, clock-boundary checks and independent reviewer reproduction. Results remain planned until run. Supply an authorized read in `tests/cases.json` and a state-changing event in `examples/scenario.json`. Verify identical replay and changed-payload conflict. Exercise real clicks, visible errors, MCP agreement after reload and denial of management access. | 3.5-4.5 |

- **Milestones, owners and dependencies (required):** M1: @QYechang and the assigned reviewer agree on capability matching, care revision semantics, service intervals/pricing, inventory holds, cancellation rules, provider authority and exact runtime baseline (approximately 1-2 working days, included above). M2: implement all four workflows as a vertical slice with one representative fixture and the shared Web Host. M3: submit the first runnable version within **14 calendar days of first plan approval**, under the [official lifecycle](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/main/docs/review/proposal-lifecycle.md), including core workflows, representative fixtures, key tests, reset and reproduction evidence. M4: complete six-fixture coverage, independent reproduction, Agent smoke trials and corrections. The author owns construction and maintenance; non-author reviewer/reproducer is TBD through maintainers. Full delivery is estimated at three working weeks. Before approval, coordinate sequencing with other implementation commitments; separate approvals do not extend either delivery deadline.
- **Resources and total effort (required):** Estimated **12-15 person-days**, summed above. Target 2 CPU cores and 4 GB RAM; synthetic business data under 1 MB and App-owned source/data under 20 MB excluding dependencies and browser tooling. No paid data, image generation, service account or payment processing is needed. Optional Agent smoke trials: provisional USD 10-25, dependent on model/token choices and separately authorized spending. Record actual sizes, costs and versions with implementation evidence.
- **Scope boundary and open questions (required):** Included: overnight dog boarding in one city; two household pets; six providers; structured non-clinical care requirements; finite inventory; versioned instructions; requests/offers/confirmations; extensions, future cancellations, provider events, synthetic costs, local UI/MCP and reset. Excluded: home visits, dog walking, medical diagnosis or treatment advice, medication administration, veterinary integration, insurance, reviews/reputation modeling, real payments, messaging negotiation, door codes, maps and human travel bookings. No in-progress provider-transfer coordinator is built; Tasks can supply real handover events and agents can inspect resulting coverage. M1 resolves price/cancellation values, hold duration, timezone and boundary handling, separation-capability rules, ordering of effects within a single commit and browser acceptance. Missing or unaccepted information remains visible rather than being replaced by a hidden default.

  **Acceptance evidence:** A compatible accepted offer can become exactly one confirmed booking; incompatible requirements or an expired offer fail without a charge or partial reservation. Two concurrent confirmations cannot take the same last slot. Profile edits must not silently change accepted stay instructions. Acceptance of an older care revision must not mark a newer one accepted. A rejected/pending extension preserves the original dates, while an accepted and confirmed extension adds only its stated interval and cost. A replacement request must not cancel current coverage. Cancellation previews must expose resulting costs and uncovered intervals. Only valid provider events record check-in, care updates and checkout. Verify identical retries, conflicting IDs, foreign-account access, provider capability changes, read-only clock expiry, isolated runs and exact reset/replay. GUI and MCP must agree on authoritative records/receipts. Grading can join App records, Core audit and supplied execution traces; private expected answers remain outside Agent-visible state. Environment smoke trials do not claim Task Track difficulty qualification.
- **License and external dependencies (required):** Proposed source and wholly synthetic fixtures: MIT, subject to dependency-license review. Redistribute source, fixtures and tests locally; no hosted-only service. Pin and document runtime/UI/test packages and their licenses. Do not collect real pets' records, owner identities, provider profiles, reviews, credentials or proprietary images. Reference sites are cited for research only; versioned fixtures and controlled events provide replayable service behavior.

After approval, add implementation and validation links against the agreed plan in the same PR. Substantial changes require another design review; final validated acceptance and merge are separate from proposal approval.
