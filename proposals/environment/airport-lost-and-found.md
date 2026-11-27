# Environment Track proposal: GateReturn

**Proposed PR title:** `[Environment Proposal] [Travel & commuting] GateReturn Airport Lost and Found Claims and Return`

## 1. App and domains

- **Authors / GitHub handles (required):** @JunbinLu2000.
- **Reference app or website / URL (required):** GateReturn is a synthetic lost property service for one fictional airport and one airline. SFO's public guidance informs the division of responsibility between the airport and the airline. SEA's public guidance informs report intake, identifying details and return options. GateReturn defines its own desks, eligibility rules, prices and timelines. [SFO Lost & Found](https://www.flysfo.com/lost-and-found) · [SEA Airport Lost and Found](https://www.portseattle.org/services-amenities/lost-and-found)
- **Primary domain (required):** Travel & commuting
- **Secondary domains (optional):** None

## 2. What you plan to build

**✍️ Your answer (required):** Build a resettable App where a traveler can report a lost personal item, respond to a desk's request for proof, and arrange its return after ownership is verified. The airport desk handles terminal losses. The airline desk handles items left on board. The App preserves the distinction between a report, a possible match, an approved claim, and a completed return.

| Workflow | Planned behavior | Observable outcome |
| :--- | :--- | :--- |
| W1. Route and file a report | Read the public desk rules. Preview and submit the last known location, loss window, item category and description. The traveler can correct or withdraw an open report. A desk may refer a misrouted report, and the traveler can confirm a transfer under the original report ID. | The report shows its assigned desk, revisions and latest response. The destination desk receives the report details. Proof already submitted stays with the original desk, and the transfer invalidates earlier candidate references and pending reviews. |
| W2. Verify ownership | A desk may reply with no match, a referral or one or more possible matches. Candidate summaries show basic details such as category and color. For each review, the traveler submits one set of proof for the report, and its current desk compares it with the candidates. | A unique match that is still available is reserved for the claimant. If proof matches several items, the desk requests more evidence. A declined or inconclusive review leaves the report open. |
| W3. Arrange return | Read the available return options after approval. Preview and confirm personal collection, collection by a named delegate, or shipping to a saved domestic address. The traveler can replace or cancel an arrangement while the desk holds the item. | The arrangement records the collector and pickup window, or the address, fee and quoted arrival time. If an arrangement becomes unusable before handoff, the report shows what needs attention and allows a replacement while the hold is active. |
| W4. Confirm custody and close | A desk event records collection or dispatch against the current confirmed arrangement. A carrier event records delivery against the shipment reference set at dispatch. The traveler can inspect the current status, notices and receipts. | Collection or delivery closes the report with a final receipt. Dispatch creates one shipment and one charge. An expired hold closes a verified report if the item is still at the desk. |

A reusable scenario starts when the Agent files a terminal desk report for black headphones using the loss window in the traveler's instructions. A later message identifies the seat pocket. The terminal desk sends a referral, and the Agent confirms transfer to the airline desk. The airline desk finds two similar pairs. The Agent submits the serial number and purchase reference from the traveler's purchase record, and a scheduled review identifies the matching pair. The traveler's saved hotel address is still active, but the quoted arrival is after checkout. The Agent confirms shipping to an eligible address within the user's budget. Scheduled dispatch and delivery events then complete the return. A separate run can use collection instead. Other scenarios can use the same workflows for an umbrella found in the terminal, a revoked pickup authorization or a report that never receives a match. Task authors supply the travel history, user instructions and event timing.

## 3. Potential app connections

- **Internal personal apps (required):** None required in v1. GateReturn supplies its own notices, report history and receipts. Task authors may independently provide purchase records, itinerary changes or authorization in personal App context for the Agent to read.
- **Other apps and websites (required):** None at runtime. The two desks and the carrier are simulated by trusted scenario events.

### Integration details

- **Operations and access (required):** Deliver the `gatereturn` MCP App in `apps/gatereturn/`. The traveler reads the desk directory, their own reports and in-App notices. Core binds the account and role. Infra supplies desk and carrier events through `env.apply_event` on its separate connection, along with `env.load_seed`, `env.snapshot`, `env.reset` and `env.advance_time`. A named collector is represented by a person reference that the desk checks at handoff. [Public runtime](../../runtime/README.md)

| Agent operations | Effect |
| :--- | :--- |
| `gatereturn.desks.list`, `gatereturn.reports.list`, `gatereturn.reports.get`, `gatereturn.notices.list` | Read routing rules, cases, decisions, arrangements and receipts. For a verified claim with an item still held at the desk, `reports.get` also returns `return_options` with pickup windows, available collector references, and the account's saved addresses with validity, fee and arrival estimates. An unavailable option includes a reason. |
| `gatereturn.reports.preview`, `gatereturn.reports.confirm` | Preview and commit submission, amendment, transfer or withdrawal while the report is open. |
| `gatereturn.claims.preview`, `gatereturn.claims.confirm` | Show the proof fields and receiving desk, then submit proof against the current report and candidate set for desk review. |
| `gatereturn.returns.preview`, `gatereturn.returns.confirm` | Preview and commit the method, collector and window or address, and any quoted fee, arrival and deadlines. Use the same pair for changes and cancellation. |

- **State and lifecycle (required):** A run has one active traveler account, two desks, a shared lost item inventory, and account-bound reports, claims and receipts. Agent reads show public rules and the active traveler's records. Candidate summaries are scoped to their report. Intake proof and other claimants' records remain available to Infra for review and validation. A fixture can seed a competing claimant's pending claim in the same inventory and let Infra process it through the normal desk review event. Separate runs exercise account isolation.

Each claim references the assigned desk, report revision and candidate set revision. The desk compares synthetic traveler proof with that candidate set's intake records. For example, a headphone claim supplies a serial number and purchase reference. An umbrella claim supplies a distinctive marking and a corroborating reference. A unique match can be approved only while the item is still held and unreserved. The approval reserves the item and verifies the report in one commit. Multiple matches request more evidence, and zero matches or a unique but unavailable item yield a declined decision. The Agent sees the outcome and a broad reason, with the comparison confined to the desk. Each report can have one pending review. Amending, transferring or withdrawing a report, or replacing its candidate set, supersedes that review and invalidates its preview. Late decisions for the superseded review are rejected.

Previews bind the action, account, relevant record revisions and material terms for ten minutes. Confirmation checks the latest state and applicable deadline. Stale or changed terms require a new preview. Core writes use `expected_version` and `request_id`. An identical retry returns its original receipt without duplicating a report, claim, arrangement or charge. A stale new write fails. Seed bundles can load earlier reports, decisions and shipments. App reset restores the loaded records and clock. Infra snapshots provide inspection evidence. [Time contract](../../docs/runtime-time.md)

- **Events and notifications (required):** Task authors fix event content and timing before the run. Infra passes each event unchanged to `env.apply_event` and supplies the observed Core `expected_version` as a separate argument. GateReturn resolves targets inside its event handler. Each accepted event records its source, time and resulting state. Agent actions and desk or carrier events can create in-App notices for the affected report owner. Advancing virtual time changes eligibility. Desk decisions and transfers of custody require an explicit event.

Events that locate a report, claim or arrangement carry a `report` selector with the fixture's `account_id`, assigned `desk_id`, item `category` and both endpoints of the reported `loss_window`. Match those fields exactly, comparing offset timestamps as instants. For all account-scoped events, the account must be the run's bound traveler or a competing claimant explicitly configured by the fixture for Infra. Selection stays within that account, and Agent reads remain restricted to the bound traveler.

These events also carry a task-authored `target_window`, with inclusive `start` and exclusive `end`, where `start < end <= event.at`. This window covers when the Agent action is expected to occur on the scenario timeline. It is separate from the loss and pickup windows. GateReturn records Core virtual time for each report revision created by filing, amending or transferring, each proof submission and each arrangement confirmation. Historical seed records targeted by events provide the same fields and timestamps. For a claim or return, match the report fields stored at proof submission or arrangement confirmation.

Count all records that match the selector and action window before checking current state, including superseded and cancelled records. Reject zero matches, multiple matches, or a sole match that has been superseded or is otherwise ineligible. This prevents a prewritten event from falling through to a newer record. If the task intends to act on a replacement, schedule its confirmation in a separate virtual-time window and target that window with a separate event. If both confirmations occur in the same target window, the event is ambiguous even when only one is still active.

| App event | Target and effect |
| :--- | :--- |
| `gatereturn.item_received` | Record a found item under the task-defined `item_id` at the stated desk, with its clerk-only intake evidence reference and hold deadline. |
| `gatereturn.desk_replied` | Use the `report` selector and the report revision's commit time in `target_window`. Require the matched revision to be current and the report open. Record `no_match`, `referral` with a destination desk, or `candidates` with task-known item IDs from the assigned desk. |
| `gatereturn.claim_reviewed` | Use the `report` selector and the claim's submission time in `target_window`. Require the claim to be the report's sole pending review, with the stored desk, report revision and candidate set revision still current. Compare the submitted proof with that candidate set and record the decision. |
| `gatereturn.return_progress` | For `collected` and `dispatched`, use the `report` selector and the arrangement version's confirmation time in `target_window`. Require that version to be the currently active arrangement for the verified report, with the correct method and valid terms at `event.at`. Collection checks the named collector and pickup window. Dispatch records a task-defined `shipment_ref` that is unique within the account and stays bound to that shipment. For `delivered`, use `account_id` and that same `shipment_ref`, and require the matching shipment to be in transit. |

An event with a missing or ambiguous target, invalid state, or expired handoff eligibility fails with `invalid_event` and a reason. Core also rejects an uncommitted event dated before its current virtual clock. Rejections return `applied: false`, with no committed receipt or change to business data, clock or version. This differs from a valid desk reply of `no_match`, which records that the desk found no candidate items. Core returns the original receipt for an identical retry of a committed event ID. Reusing that ID with different content fails.

These examples are individual event envelopes. The Agent files before the referral, transfers during the next window and submits proof after the candidate reply. The fixture already contains `item-08`. Collection and shipping are separate runs, and the shipping run confirms its active arrangement in the later window before dispatch.

```json
[
  {
    "event_id": "terminal-referral", "at": "2027-02-02T08:30:00-08:00", "operation": "gatereturn.desk_replied",
    "payload": {
      "report": {"account_id":"gate-maya","desk_id":"terminal","category":"headphones","loss_window":{"start":"2027-02-01T08:00:00-08:00","end":"2027-02-01T09:00:00-08:00"}},
      "target_window": {"start":"2027-02-02T08:00:00-08:00","end":"2027-02-02T08:30:00-08:00"},
      "outcome": "referral", "destination_desk_id": "airline"
    }
  },
  {
    "event_id": "airline-intake-07", "at": "2027-02-02T08:45:00-08:00", "operation": "gatereturn.item_received",
    "payload": {"item_id":"item-07","desk_id":"airline","category":"headphones","color":"black","hold_until":"2027-02-10T17:00:00-08:00","intake_evidence_id":"proof-07"}
  },
  {
    "event_id": "airline-candidates", "at": "2027-02-02T09:00:00-08:00", "operation": "gatereturn.desk_replied",
    "payload": {
      "report": {"account_id":"gate-maya","desk_id":"airline","category":"headphones","loss_window":{"start":"2027-02-01T08:00:00-08:00","end":"2027-02-01T09:00:00-08:00"}},
      "target_window": {"start":"2027-02-02T08:30:00-08:00","end":"2027-02-02T09:00:00-08:00"},
      "outcome": "candidates", "item_ids": ["item-07","item-08"]
    }
  },
  {
    "event_id": "airline-review", "at": "2027-02-02T11:00:00-08:00", "operation": "gatereturn.claim_reviewed",
    "payload": {
      "report": {"account_id":"gate-maya","desk_id":"airline","category":"headphones","loss_window":{"start":"2027-02-01T08:00:00-08:00","end":"2027-02-01T09:00:00-08:00"}},
      "target_window": {"start":"2027-02-02T09:00:00-08:00","end":"2027-02-02T11:00:00-08:00"}
    }
  },
  {
    "event_id": "airline-collection", "at": "2027-02-02T12:00:00-08:00", "operation": "gatereturn.return_progress",
    "payload": {
      "report": {"account_id":"gate-maya","desk_id":"airline","category":"headphones","loss_window":{"start":"2027-02-01T08:00:00-08:00","end":"2027-02-01T09:00:00-08:00"}},
      "target_window": {"start":"2027-02-02T11:00:00-08:00","end":"2027-02-02T12:00:00-08:00"},
      "stage": "collected", "collector_id": "person-02"
    }
  },
  {
    "event_id": "airline-dispatch", "at": "2027-02-02T13:00:00-08:00", "operation": "gatereturn.return_progress",
    "payload": {
      "report": {"account_id":"gate-maya","desk_id":"airline","category":"headphones","loss_window":{"start":"2027-02-01T08:00:00-08:00","end":"2027-02-01T09:00:00-08:00"}},
      "target_window": {"start":"2027-02-02T12:15:00-08:00","end":"2027-02-02T13:00:00-08:00"},
      "stage": "dispatched", "shipment_ref": "ship-headphones-01"
    }
  },
  {
    "event_id": "carrier-delivery", "at": "2027-02-11T12:00:00-08:00", "operation": "gatereturn.return_progress",
    "payload": {"account_id":"gate-maya","stage":"delivered","shipment_ref":"ship-headphones-01"}
  }
]
```

When the review identifies one available item, the Agent sees `{"report_id":"report-12","claim_id":"claim-04","status":"verified","hold_until":"2027-02-10T17:00:00-08:00"}` in its report view, and the reservation appears in the Infra snapshot. GateReturn generates these report and claim IDs during the run.

One return arrangement is active at a time. Collection requires the named traveler or authorized delegate during a pickup window within the desk's published hours. Replacing or cancelling a pickup invalidates that arrangement's revision and its authorization. Shipping estimates use the desk's dispatch schedule and a fixture transit duration. Confirmation requires a saved address that is currently valid and whose expiry is later than the quoted arrival time. At dispatch, the desk checks the estimate again using the event time. Dispatch requires an arrival estimate within both the accepted quote and the address window. While the item is still held, reads show `needs_action` when the current clock makes the pickup window or shipping quote unusable. The traveler can then confirm a replacement.

An item still at the desk expires at `hold_until`. At or after that timestamp the verified report shows `expired` and the item can no longer be collected or dispatched. Reads derive this status from the Core clock. Collection moves an active arrangement to `collected`. Shipping moves it to `dispatched` and then `delivered` after the carrier confirms the same shipment. An in-transit shipment can be delivered after the desk hold ends. Dispatch records the confirmed destination and fee in one commit. An identical event retry returns the original receipt. A repeated dispatch, collection or delivery with a different event ID is rejected based on the stored custody state, preventing a duplicate shipment, charge or final receipt.

- **Shared data and dependencies (required):** Use stable synthetic IDs for people, addresses, desks, items, reports, claims, return arrangements and shipments. Use UTF-8 JSON, timestamps with offsets and integer USD cents. Sample fees, addresses, proof records and notices are original fixture data. Deploy the package with Node.js 18+ and the public runtime 1.6.0, Core API 1.2.0 and contribution revision 0.4.0. The package runs with its own files and the shared runtime. Record the exact compatible revision for delivery. [App contribution guide](../../docs/app-contribution.md)

### Related proposals

| Proposal | Boundary |
| :--- | :--- |
| [#169 Curbline](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/169) | A ride support case can record a lost-item complaint. GateReturn covers airport and airline desk routing, evidence review and the physical return. |
| [#69 PaleAir](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/69) | PaleAir manages flight bookings and changes. GateReturn uses seeded itinerary references to help identify the desk that handles the loss. |
| [#101 Parcel Delivery Manager](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/101) | Parcel Manager starts with a parcel and known recipient. GateReturn establishes the claimant's entitlement to a found item before authorizing collection or shipment. |

## 4. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Web / app construction | Build the MCP business handlers, schemas and synthetic desk policies for W1–W4. Reuse the public Core for lifecycle and versioning. | Ten MCP operations with a reproducible path from report to return, plus amendment, withdrawal, cancellation and rejected-action behavior. | 3–4 |
| Data and image collection | Review the two public airport references and write original rules, fees and copy. | A source and reuse note in the App README. The fixture set uses original text and JSON. | 0.5 |
| Synthetic data and assets | Create six seeded scenarios with two desks, three item categories and at least eight intake records across the fixture set, including lookalikes and historical cases. | Fixtures cover desk referral, ambiguous or missing matches, owner and delegated collection, expired addresses and shipping. Check timestamps, ownership and item references. | 1–1.5 |
| App integrations | Declare the Core lifecycle and provide a local registry or run instructions for Agent and Infra connections. Personal Apps are optional Task context. | Load history, replay desk and carrier events, and reproduce the workflows from the package and shared runtime. | 0.5 |
| Validation and reset | Run business tests and `npm run app:verify -- --app apps/gatereturn`. Exercise the workflows through public Agent and Infra MCP connections. | Publish the exact revisions, commands, results and example receipts. Record any remaining human reproduction or deployment checks. | 2–2.5 |

### Delivery checks

| Check | Expected evidence |
| :--- | :--- |
| Prewritten event replay | Start without the target report, claim or arrangement. Let the Agent file, transfer, submit proof and confirm a return in the planned windows. Replay the original event envelopes through Infra. The referral, candidate reply and review reach the Agent's records. In separate runs, collection records a handoff and dispatch binds the prewritten shipment reference so delivery closes the case. Compare the generated IDs and outcomes in Agent reads and Infra snapshots. |
| Event targeting controls | Omit the target report or proof submission for a zero-match rejection. File two reports with the same selector in one window for an ambiguous desk reply. An otherwise matching report owned by another account cannot satisfy the selector. Replace or cancel an arrangement before handoff and verify the event targeting the old version fails. A handoff event is ambiguous when two confirmations fall within its target window. A prewritten event for an active replacement confirmed in a separate window succeeds. Verify rejected events have no committed receipt and change neither business state, clock nor version. |
| Referral, correction and withdrawal | A misrouted report can be transferred under the same ID. Its history keeps both desks. The new desk sees the report details and receives proof through a new submission. A reply for an obsolete report revision or a review for a superseded submission at the old desk is rejected, even if the new desk has a pending review. |
| Claim matching and competition | Submit proof once for two visually identical candidates and verify the uniquely matched item. Two matches request more evidence. Zero matches leave the report open. When two claimants submit matching proof for one item, only the first successful review reserves it. A separate account test checks access to another traveler's case and desk proof. |
| Collection, authorization and expiry | The report lists possible collectors and pickup windows. The traveler and a valid delegate can collect in separate scenarios, and the final receipt names the actual collector. A revoked delegate is rejected. At the exact hold deadline, an item still at the desk reads as expired and handoff fails. |
| Shipping and payment | Read and reject an address whose validity ends before the quoted arrival. In a separate case, advance the clock until an existing shipping quote is unusable. The report shows `needs_action`, dispatch fails, and the traveler confirms a replacement. An identical dispatch retry returns its original receipt. A repeated dispatch with a different event ID is rejected, leaving one shipment and one charge. Delivery can close the shipment after the original desk hold expires. |
| Persistence and reset | After reload, the report, claim and receipts match the committed history. Reset reproduces the loaded baseline and clock, including cases that started with historical records. |

- **Milestones, owners and dependencies (required):** @JunbinLu2000 owns scope review, implementation and reproduction instructions. After approval, implement report routing and ownership review first, then collection and shipping, followed by fixture replay and verification. Target the runnable v1, resettable fixtures and evidence within 14 calendar days of first plan approval. Pin the shared runtime commit at implementation. Related PRs are coordination references.
- **Resources and total effort (required):** 7–9 person-days for one contributor. Local CPU and Node.js suffice. Fixtures use original text and JSON, with no expected collection fees or hosted-service costs.
- **Scope boundary and open questions (required):** V1 covers ordinary personal items left in a terminal or on a plane, two desks, and domestic ship-back. Deferred scope includes checked baggage and compensation claims, restricted items, identity document collection, real payment and carrier services, post-dispatch changes and a browser interface. At the start of implementation, record the fictional desk holding periods, acceptable proof by item category and visible evidence fields in a policy table and fixture assertions.
- **License and external dependencies (required):** Use the repository's MIT license for original code, documentation and fixtures. The airport pages serve as workflow references. Default execution is offline with the pinned public runtime.

After approval, add the implementation and reproducible evidence in the same PR. [Contribution guide](../../CONTRIBUTING.md#review-and-implementation)
