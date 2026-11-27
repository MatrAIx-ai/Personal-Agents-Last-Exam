# Environment Track proposal: BrightFold

**Proposed PR title:** `[Environment Proposal] [Home & utilities] BrightFold Laundry Pickup & Delivery`

**Status:** Local proposal draft. Implementation, approval and validation are planned work; none is claimed as complete.

## 1. App and domains

- **Authors / GitHub handles (required):** @JunbinLu2000.
- **Reference app or website / URL (required):** BrightFold is an independently branded, synthetic laundry and dry-cleaning pickup/delivery service. [Rinse's public FAQs](https://www.rinse.com/faqs/) inform the general workflow of selecting a service, arranging pickup, tracking cleaning and arranging return delivery. Reference material informs interaction design only; BrightFold's prices, deadlines, accounts, text and business policies are fictional and explicitly documented.
- **Primary domain (required):** Home & utilities
- **Secondary domains (optional):** None. Quotes and simulated invoices support the laundry workflow; v1 does not implement a separate banking or payment service.

### Domain names

The primary domain uses the exact name in the [canonical domain list](../../README.md#environment-domains).

## 2. What you plan to build

**✍️ Your answer (required):** Build a resettable laundry-service App, seen from one customer's account, with four complete workflows: compare services and obtain quotes; book pickup and return delivery; amend or cancel orders; and follow order progress, delivery changes and itemized invoices. A business Web interface and MCP tools will operate on the same persisted state. Task authors can supply different customer histories, preferences, appointments and provider events without changing the App's business code.

The environment supports decisions that depend on the person: a garment may be needed before a particular date, a customer may avoid scented detergent, and a household may be unavailable during an otherwise valid pickup window. The App exposes the relevant options, records and consequences. It validates service rules, but does not decide the user's priorities or automatically select the task's correct answer.

| Workflow | Planned behavior | Observable outcome and control case |
| :--- | :--- | :--- |
| W1: Services and quotes | Read the customer's saved detergent preference, then compare service types, garment categories, supported care options, prices and available windows. Create a stored quote with itemized amounts, turnaround time and cancellation terms. | The quote response shows the selected service, address, windows, amount and expiry. The quote records its owner, intended action and applicable pricebook revision. Unsupported care options are rejected. A quote does not hold a slot. |
| W2: Booking | Review a quote and explicitly confirm an order, customer address, pickup slot and return slot. Recheck quote validity, service compatibility and both slots' capacity when committing. | One order, accepted-price snapshot, slot reservations and confirmation notice are persisted. Expired quotes, changed prices or exhausted capacity cannot silently create a different booking. |
| W3: Amendment and cancellation | Before the pickup cutoff, quote and confirm changes to service, care or pickup time. Before dispatch, quote and confirm a change to the return window. Cancel an uncollected order after reviewing the quoted fee. A provider-closed pickup window can be rebooked or cancelled for free, including after the ordinary cutoff. | A time-only change preserves the accepted service price. A successful amendment updates the order history and affected reservations together. Cancellation releases any remaining reservations once. A failed amendment preserves any reservations that are still valid. |
| W4: Progress and completion | Read order status, notices and history. When the provider disrupts a return window before dispatch, select and confirm a new eligible window. View an itemized simulated invoice after delivery or a fee record after cancellation. | The original window remains in history and the order shows that rebooking is required. Dispatch waits for a valid confirmed return reservation. Delivery generates one simulated invoice based on the accepted order and amendments. |

For example, a Task could ask an Agent to arrange a shirt's cleaning before an interview, with an earlier fragrance-free preference and a later provider delay. Other Tasks could use the same App for a routine household pickup, a changed pickup window or avoiding a duplicate booking. These are reuse examples, not a fixed Task, rubric or embedded answer.

## 3. Potential app connections

- **Internal personal apps (required):** None in v1. All four workflows expose confirmations, delays and invoices through BrightFold's own records and notices. Task assemblies may separately provide Mail or Calendar context for the Agent to read, but this App neither requires those packages nor updates them. A future optional Mail integration could publish order notices using Mail 1.3.0's [receive declaration](../../examples/apps/mail/contribution/contribution.json), [email payload](../../examples/apps/mail/schemas/email-payload.schema.json) and [wire schema](../../examples/apps/mail/schemas/router-message.schema.json). That extension requires a separate scope decision, account binding and real receiver-side validation; it is outside v1 deliverables. Calendar has no Messaging receiver in the current checkout, so automatic Calendar updates are not assumed.
- **Other apps and websites (required):** None at runtime. Rinse is a public workflow reference, not a live dependency. Service availability, prices, provider progress and invoices are supplied by local synthetic records and permitted scenario events.

### Integration details

- **Operations and access (required):** Deliver `apps/brightfold/` with an App-owned Web page/controller, business implementation, schemas, fixtures and documented examples. Proposed Agent reads are `brightfold.catalog.get`, `brightfold.slots.list`, `brightfold.account.get`, `brightfold.orders.list`, `brightfold.orders.get` and `brightfold.notices.list`. The account tool returns the current customer's saved detergent preference and booking addresses. The catalog shows which care options each service supports. Proposed writes are `brightfold.quotes.create`, `brightfold.orders.create`, `brightfold.orders.update` and `brightfold.orders.cancel`. Quote creation returns a quote ID and the full terms for review. The quote binds the customer's proposed choices and action, plus the order ID and revision for amendments or cancellations. Confirmation checks those terms, current eligibility and affected slot capacity, then consumes the quote on a successful commit. If any material term changes, confirmation fails and the caller must obtain a new quote. The Web interface uses the same authorized tools. A separate Infra connection provides `env.load_seed`, `env.reset`, `env.snapshot`, `env.apply_event` and `env.advance_time`. [Public Web Host](../../runtime/web/README.md)
- **State and lifecycle (required):** Core isolates App/run state; customer-owned records and policy bindings restrict account access. V1 has one active customer account per run, with separate-account/run cases for authorization tests. Store accounts, addresses, service rules, pricebooks, slots, quotes, orders, notices and invoice/history records. Core owns persistence, version checks and request/event deduplication. Business writes use `expected_version` and `request_id`: retrying an unchanged accepted request returns its original receipt; reusing its ID for different input fails. Booking, reservation changes and notices commit within the same App transaction. Rejected operations preserve business data; Core may retain denial audit records. GUI forms retain their observed version and show conflicts rather than silently overwriting. Reset returns to the loaded synthetic baseline, including its initial clock. Snapshots provide inspection evidence; general snapshot restore is not promised. Deadlines and quote expiry use `ctx.virtual_now`, following the [time contract](../../docs/runtime-time.md), rather than wall-clock time.
- **Events and notifications (required):** Task authors set event content and ordering. Infra injects the three operations below. Each affected order receives a history entry and an in-App notice. Advancing the virtual clock changes time-based eligibility. Physical progress and provider notices require events.
  - `brightfold.order.progress` follows `scheduled -> picked_up -> cleaning -> ready -> dispatched -> delivered`. Pickup requires an active pickup reservation and occurs within its window. Dispatch requires a confirmed return reservation that is still valid. Delivery occurs within that reservation's window and creates the simulated invoice. Skipped or backward transitions are rejected.
  - `brightfold.order.delay` applies after pickup and before dispatch. It updates the earliest return time and records the reason. If the reserved return slot starts before the new earliest time, it is released and marked disrupted in the order history. The order keeps its physical progress status and requires a new confirmed return slot before dispatch.
  - `brightfold.slot.close` closes a future slot before pickup or dispatch. It releases affected reservations and marks them as needing rebooking. A pickup closure gives a scheduled order the option to rebook or cancel without a fee, even after its ordinary cutoff. A return closure requires a new return reservation before dispatch. An event that would close a slot reserved by an already dispatched order is rejected without changing any reservations. Post-dispatch disruptions are outside v1.
- **Shared data and dependencies (required):** Use stable synthetic customer, account, address, garment, slot, quote and order IDs scoped to the permitted run and account. Task seeds may set the account's preferred detergent to `fragrance_free`, `standard` or unset, and load past orders. The preference is visible independently of the care selected on a particular order. When it is unset, the account tool reports no saved preference and quoting still accepts any supported choice. Quotes and invoices reference their originating order or action, and notices link to their business object. Pricebook revisions have effective timestamps so Tasks can model changes with virtual time. Accepted order prices remain recorded. Data uses UTF-8 JSON and plain text, offset-bearing timestamps and integer-cent amounts. V1 uses text and structured records only. The package runs with Node.js 18+, its own files and the public runtime 1.6.0, Core API 1.2.0 and contribution revision 0.4.0. Record the exact compatible runtime commit with implementation evidence. Browser acceptance uses the repository's Playwright and Chromium setup. A package-local example registry assembles BrightFold with the shared runtime.

### Proposed business rules

The initial fixtures use the following synthetic values. Reviewers can adjust them before scope approval.

| Rule | Proposed behavior |
| :--- | :--- |
| Services and prices | One service per order. Wash and Fold costs $18 per bag and takes 24 hours. Dry Cleaning starts at $9 for a shirt and takes 48 hours. The earliest return slot starts at or after the pickup window end plus the service turnaround, subject to a later provider estimate. Wash and Fold supports standard and fragrance-free detergent at the same price. Dry Cleaning takes no detergent selection. |
| Quote lifetime | A quote is valid for 15 minutes of virtual time. At exactly `expires_at` it is expired. A $18 quote created at 10:00 can be accepted at 10:14 if its terms and slots are still valid. At 10:15 it requires a new quote. |
| Amendments | A time-only change or a change to a supported care option preserves the accepted service price. A service or quantity change before the pickup cutoff uses the current catalog prices. A time-only change that shifts pickup must also preserve an eligible return slot or select a replacement in the same amendment. |
| Cancellation and cutoff | The ordinary pickup cutoff is two hours before the pickup window starts. For an 18:00 pickup, cancellation is free before 16:00 and costs $5 at or after 16:00 while the order is still uncollected. If the provider closes the pickup slot, cancellation remains free and time-only rebooking stays available after the original cutoff. A confirmed replacement establishes its own cutoff. Cancellation is unavailable after pickup. |

### Example provider events

In this example, `order-004` is a Wash and Fold order with pickup on November 25 from 18:00 to 20:00 and return on November 26 from 20:00 to 22:00. Times are local to the fixture (`-08:00`).

```json
{
  "event_id": "brightfold-pickup-004",
  "at": "2026-11-25T19:00:00-08:00",
  "operation": "brightfold.order.progress",
  "payload": { "order_id": "order-004", "status": "picked_up" }
}
```

The order becomes `picked_up`, the pickup reservation is marked fulfilled, and the customer sees a pickup notice.

```json
{
  "event_id": "brightfold-delay-004",
  "at": "2026-11-26T10:00:00-08:00",
  "operation": "brightfold.order.delay",
  "payload": {
    "order_id": "order-004",
    "earliest_return_at": "2026-11-27T18:00:00-08:00",
    "reason": "provider_delay"
  }
}
```

The November 26 return reservation is released, kept in history and marked disrupted. The customer sees a delay notice and can confirm an eligible replacement, such as `return-1127-1800`, the November 27 window from 18:00 to 20:00.

```json
{
  "event_id": "brightfold-close-1127-1800",
  "at": "2026-11-27T12:00:00-08:00",
  "operation": "brightfold.slot.close",
  "payload": { "slot_id": "return-1127-1800", "reason": "provider_closure" }
}
```

If the customer confirmed the 18:00 replacement and the order has yet to be dispatched, this event closes that slot and releases the reservation. The order shows that a new slot is required, and the customer receives a closure notice. The customer can confirm the available November 27 window from 20:00 to 22:00 at the original service price. The provider can then finish the order through the normal progress events.

## 4. Construction plan and effort

The estimates below are a proposed budget for one contributor, not time already spent. V1 includes both the Web and MCP workflows above.

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Web / app construction | One App package with four business views: service/quote builder, booking confirmation, order list/detail with amendment/cancellation controls, and notices/history/invoice. Implement the ten proposed business tools and three event operations, reusing public Core and Web Host interfaces. | Runnable business UI and MCP entry points for W1-W4; shared persisted state; explicit price/slot/cutoff validation; visible failures, conflicts and retry outcomes. | 5-6 |
| Data and image collection | Manually inspect the linked public FAQ for workflow structure and record source/reuse decisions. No crawling, production-account collection or copied product imagery. | Dataset/provenance declaration distinguishes public workflow references from original synthetic rules and text; zero third-party media assets. | 0.25 |
| Synthetic data and assets | Create three replaceable fixture sets, each with one customer, two service types, six garment categories, two detergent choices and 24 pickup/return windows. Plan six historical/active orders per fixture, with consistent line items, notices and invoice records where applicable. Cover an ordinary booking, a delayed return with a saved fragrance-free preference, and cutoff/capacity cases including a provider-closed pickup. | Validate the seed schema, references, IDs, timestamps, totals and state transitions. The account tool shows the preference loaded by the scenario, and replacement histories load without business-code changes. | 0.75-1 |
| App integrations | No cross-App integration in v1. Document the package boundary and the future Mail extension separately. | Standalone execution succeeds without Mail/Calendar; manifests and examples declare no sibling-App dependency or outbound publish capability. | 0; boundary documentation is included above |
| Validation and reset | Add App-local business tests, a runnable walkthrough, public-runtime verifier inputs and real-browser workflow checks. Exercise fresh runs, loaded history, reset, events, time boundaries, permissions, concurrency and retry behavior. | Versioned reports and workflow-to-check mapping; exact commands and commit/runtime versions; independent base-validator compatibility when available. Browser evidence verifies actual controls and backend state, not screenshots alone. | 2-2.5 |

Planned acceptance evidence:

| Check | Required observation |
| :--- | :--- |
| Booking and price agreement | A confirmed valid quote creates one order and reserves both windows; invoice arithmetic uses integer cents and the accepted price snapshot. |
| Quote validity and care options | An expired, consumed, wrong-account or wrong-action quote is rejected. A price change that changes the quoted terms requires a new quote. A fragrance-free Wash and Fold quote is valid, and a detergent selection for Dry Cleaning is rejected. Failed confirmations preserve orders and reservations. |
| Amendment and cancellation | A time-only change to an $18 order keeps that price after a pricebook update. A quantity or service change uses current rates. A customer can cancel a provider-disrupted pickup for $0 or confirm a replacement at the accepted service price even after the original cutoff. Ordinary late cancellation records only the confirmed fee. |
| Last-slot contention | Two requests competing for the final unit of capacity cannot both succeed; the rejected request leaves no partial order or reservation. |
| Retry and conflict handling | A lost-response retry with the same ID/input creates no duplicate order, fee or notice. Different input with that ID fails. A stale browser form cannot overwrite an MCP amendment. |
| Provider events and recovery | Run the three example events with a rebooking between the delay and closure. Verify that released reservations remain in history, a failed rebooking leaves no new reservation, and a successful final rebooking permits dispatch and delivery with exactly one invoice. Reject skipped or backward transitions and closure of a slot reserved by a dispatched order. Event retries do not repeat changes or notices. |
| Time boundaries | Test quote expiry and the pickup cutoff immediately before, exactly at, and after the documented boundary. A cancellation quote that crosses the ordinary cutoff requires reconfirmation at the newly quoted fee. Clock advancement alone does not advance physical progress. |
| GUI/MCP consistency | Browser booking, amendment and cancellation are visible through MCP and survive reload. An independent MCP change or Infra event appears after refreshing the browser. |
| Isolation and lifecycle | Foreign-account IDs and guessed management calls are denied. Separate runs do not share records; loading alternative history and resetting restores the documented baseline without retaining the previous run's orders or notices. |
| Reuse and grading support | A fresh task-specific seed drives the same operations. Final orders, accepted quotes, notices and invoices provide inspectable outcomes; a simulated invoice is not represented as evidence of a real bank payment. |

Business tests and examples will run from the App directory using its documented `npm test` and example command. Full-checkout evidence will include `npm run app:verify -- --app apps/brightfold --output .artifacts/brightfold.json`, the applicable shared regression/contract checks and a BrightFold browser walkthrough. These are planned implementation checks; no BrightFold package or passing report exists at proposal time.

- **Milestones, owners and dependencies (required):** @JunbinLu2000 owns the App, fixtures, documentation and evidence. Confirm the business rules and fixtures, implement and test MCP workflows and events, connect the Web interface to the same state, then run fresh-checkout verification and browser checks. Allow approximately 8–10 working days and target submission within 14 calendar days of the first plan approval. The required dependencies are the public App/Core contracts and Web Host. Home Repair Slots shares quoting, rebooking and cancellation. BrightFold adds garment-care choices, separate pickup and return reservations, and recovery from delays during cleaning. [Related proposal: Home Repair Slots #5](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/5)
- **Resources and total effort (required):** Approximately 8-9.75 person-days across the table above. A local Node.js process and ordinary browser-test resources are sufficient; seed data should remain under 1 MiB. Planned dataset/model/service costs are zero because records are original synthetic JSON and local verification requires no paid API. Browser-test dependency downloads require network access during setup; App execution and business tests run locally without it. Actual hosting or review costs are not estimated as delivered work.
- **Scope boundary and open questions (required):** V1 covers one fictional provider, one active customer per run, the four declared workflows and the two cleaning services. Task authors supply user goals, permissions and provider events. The package simulates collection, cleaning and delivery. Driver assignment, routing, disruption after dispatch, real payments, subscriptions, live provider integration, image processing, external notifications, production hosting and simulator or model adapters are outside this scope. Before plan approval, confirm the proposed fixture values, exact runtime revision, Web Host compatibility and the author's availability. Record agreed prices, turnaround times and policy boundaries in the fixtures and README. Any future Mail integration needs its own scope decision and receiving App evidence.
- **License and external dependencies (required):** Proposed original App code, documentation and generated fixtures use the repository's MIT license. Customer names, addresses, garments, orders, notices and policies are invented; no private messages, real account data or third-party personal information are included. Public Rinse pages are linked as workflow references only; their branding, text, images, code and actual pricing are not redistributed. Use an original BrightFold wordmark rendered as text. No hosted service is required or bundled. Node/public runtime and test-only browser dependencies will be documented with exact versions and their existing licenses; any additional dependency requires a declared purpose and reproducible local setup.

After plan approval, add implementation and verification evidence against these deliverables in the same PR, following the [contribution guide](../../CONTRIBUTING.md#review-and-implementation). This draft does not claim plan approval, implementation acceptance or a completed benchmark Task.
