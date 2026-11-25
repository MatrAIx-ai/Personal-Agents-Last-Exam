# Environment Track proposal

Proposed PR title: `[Environment Proposal] [Media & entertainment] Seatline live-event tickets and transfers`

## 1. App and domains

- **Authors / GitHub handles (required):** Genglin Liu ([@genglinliu](https://github.com/genglinliu)).
- **Reference app or website / URL (required):** Seatline, an independently branded synthetic live-event ticketing app. [Ticketmaster](https://www.ticketmaster.com/), its [Ticket Transfer guide](https://help.ticketmaster.com/hc/en-us/articles/9786975926673-How-does-Ticket-Transfer-work) and [event-update help](https://help.ticketmaster.com/hc/en-us/articles/9784889055889-What-happens-if-my-event-is-rescheduled-or-moved) are public workflow references. Seatline uses original venue maps, events, prices and explicitly documented synthetic policies.
- **Primary domain (required):** Media & entertainment
- **Secondary domains (optional):** None

## 2. What you plan to build

**✍️ Your answer (required):** A resettable live-event ticket app with inspectable seat inventory, time-limited holds, price/fee previews, purchases, delivery status, ticket ownership, person-to-person transfers, event changes and refunds. The environment records who bought a ticket, who currently holds it, whether an invitation was accepted, which admission credential is valid, and where any refund goes. Agents choose suitable seats and maintain the user's plans; the app supplies business operations and consequences without choosing a preferred outcome.

Initial workflows:

1. **Events and original seat maps.** Search dated events and inspect venue sections, row/seat identifiers, adjacency, view restrictions, accessible/companion-seat attributes, age restrictions and event-specific purchase/transfer/refund rules. The GUI seat map and public structured observations share the same inventory. An agent cannot infer suitability from price or seat availability alone. All task-relevant attributes are discoverable.
2. **Hold, preview and purchase.** Select explicit seats, acquire an expiring hold, preview ticket price, fees, extras, currency and final total, then confirm or discard within current authority. Recheck the hold, inventory, price and applicable policy version at confirmation. Failed purchase has no new charge or ticket. A repeated request ID returns the original order/receipt; uncertain effects must be reconciled before another purchase.
3. **Order, ticket delivery and admission status.** Inspect order lines and individual tickets. Distinguish purchased, delivery-pending, active, transferred, refunded, voided and used records. Credential release may be delayed under a visible event policy. A platform-operated synthetic admission event validates the current credential and ticket status; it does not simulate real barcodes or venue security. An order confirmation alone does not prove that a ticket is ready for entry.
4. **Person-to-person transfers.** Preview the selected ticket IDs and recipient, send an invitation, inspect sent/pending/accepted status, cancel an unaccepted transfer or request a transfer back from the current holder. Recipient acceptance is a separate actor/scenario operation. Acceptance creates a new valid synthetic credential for the recipient and invalidates the sender's prior credential; the sender cannot unilaterally undo an accepted transfer. Public receipts and delivery history retain those effects.
5. **Event changes and refund closeout.** Read cancellation/postponement/reschedule/venue-change notices and each event's current options/deadline. Preview and request an allowed refund for the correct ticket/order lines or keep the valid tickets. Configurable synthetic policies specify partial versus whole-order eligibility, transfer-back requirements, extras and original-payment destination. Requested, approved, processing and actually paid refunds remain distinct. Never infer a universal refund right from a date change; rules are printed on the event and preview. Duplicate requests cannot refund twice.

Illustrative downstream task: a user buys three adjoining seats and transfers one to a friend. The event moves to a date that conflicts with that friend's Calendar, while the other two attendees still want to go. The agent must inspect the actual holder/acceptance state, current event rules, permitted return/refund options and remaining seat configuration before acting. The environment can check the final ticket holders and usable credentials, actual messages and financial records, together with earlier mistakes visible in the trace. The executable personal story and model-difficulty evidence belong to a separate Task proposal.

Ticketmaster's public transfer and refund help informs the interaction boundaries; Seatline's accepted rule set will be frozen and visible. No claim of complete Ticketmaster compatibility or identical policies is made. Related [Beam #11](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/11) concerns game licenses/gifts/refunds; Seatline adds reserved physical seats, admission credentials, event rescheduling and per-attendee ticket rights.

## 3. Potential app connections

- **Internal personal apps (required):** Mail 1.3.0 is required for the connected notice workflow. Calendar 1.3.0 is required for the downstream calendar workflow: the Agent uses `calendar.list`, `calendar.get`, `calendar.create` and `calendar.update`, or Task/Infra supplies initial entries in the shared Calendar instance. Seatline cannot update Calendar by sending a notice. A friend's calendar needs a separate authorized account binding; absent access stays explicit. Contacts 1.0.0 is an optional Agent-side lookup through `contacts.list` and `contacts.get`. Task data maps a contact to a recipient ID already in Seatline's seed. A contact name or email grants no transfer authority. Inbox/calendar fixtures are initial data for the shared Apps, not copies inside Seatline.
- **Other apps and websites (required):** None required. A small local charge/refund ledger supplies deterministic payment outcomes. [Finance #6](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/6) is an optional later transaction link. Live ticketing, payment, resale and venue systems are excluded.

### Integration details

- **Operations and access (required):** The GUI and public MCP use the same Agent business operations below. All names start with `seatline.`. Writes require a retry-stable `request_id` and observed Core `expected_version`. Purchase, transfer and refund use preview + confirm/request. A preview states the actor, objects, amounts, policy version and expiry; it grants no authority. Confirmation checks the current App-scoped permission supplied by trusted seed/Infra, fixed caller account, current versions and expiry. The public Host has no native user-confirmation mechanism.

| Access | Planned Agent operations |
| :--- | :--- |
| Read | `seatline.events.search`, `seatline.events.get`, `seatline.seats.list`, `seatline.policies.get` |
| Read | `seatline.holds.get`, `seatline.orders.list`, `seatline.orders.get`, `seatline.tickets.list`, `seatline.tickets.get`, `seatline.notices.list` |
| Read | `seatline.transfers.list`, `seatline.transfers.get`, `seatline.refunds.list`, `seatline.refunds.get` |
| Write | `seatline.holds.create`, `seatline.holds.release`, `seatline.purchases.preview`, `seatline.purchases.confirm` |
| Write | `seatline.transfers.preview`, `seatline.transfers.send`, `seatline.transfers.cancel`, `seatline.returns.preview`, `seatline.returns.request` |
| Write | `seatline.refunds.preview`, `seatline.refunds.request` |

Returning a ticket requires the current holder's separate acceptance; the purchaser's return request alone changes no holder. Recipient acceptance, organizer changes, credential release, refund posting and admission checks are trusted Infra events, never purchaser tools. Core provides `env.load_seed`, `env.snapshot`, `env.apply_event`, `env.event_status`, `env.advance_time` and `env.reset` on the Infra connection; caller role/run/account cannot be supplied as business arguments.

- **State and lifecycle (required):** Separate versioned event/venue/policy definitions, account/payment/recipient references and isolated run state: seats, holds, previews, orders/lines, ticket/credential lineage, transfers, notices and refunds. Core owns persistence, versions, retry receipts and event deduplication. Failed/stale writes preserve valid earlier business state. Load prior history/assets with `env.load_seed`; reset restores that loaded App baseline and its clock. Reset affects only Seatline, including its synthetic charge/refund ledger and ticket-delivery records. Mail/Calendar retain their own committed records until separately reset by Infra. Restart resumes persisted state; no coordinated cross-App restore is promised. Future event schedules and evaluator state remain Task/Infra-owned.

- **Events and notifications (required):** Task/Infra supplies `{event_id, at, operation, payload}` using public runtime 1.6.0 / Core API 1.2.0 and the [time contract](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/7a05aa958c824143ab9eee1aa21c2dfacd8be31a/docs/runtime-time.md). Operations cover inventory/price changes, credential release, recipient acceptance, event changes, refund approval/processing/payment and admission checks. Runtime-created targets use the matching contract below. Seatline does not schedule future events or choose the appropriate reminder or attendee response.

### Events targeting records created during a run

The first version represents recipient decisions with deterministic Task/Infra events. A rule can say that Alex accepts an eligible invitation at a supplied virtual time. The App provides the matching and acceptance operation; Task/Infra chooses the recipient's response and time. An LLM-based recipient is not required for this version. A later recipient simulator can use actual invitation IDs through the same trusted event path, with its own account authorization and runner.

An input `event_id` identifies one scenario event for Core retry/deduplication. A `show_id` identifies the concert, and a `transfer_id` identifies an invitation created during execution. These IDs have separate purposes. The Task knows seeded show, seat, sender and recipient IDs; it does not predict generated transfer/order/refund IDs.

Each targeted event accepts exactly one `target`: either `{"id":"<actual-business-id>"}` from a real receipt/readback, or `{"match":{...}}` with the fields below. The operation determines the object type and eligible state; the caller cannot override that state filter. Matching is an App business operation under Core's existing commit lock, not a new Core API or resolver service.

| Target | Required exact match fields | Eligible records |
| :--- | :--- | :--- |
| Order, for delayed delivery | `purchaser_account_id`, `show_id`, `seat_ids` | An uncancelled order with relevant tickets still awaiting delivery |
| Transfer, for acceptance or rejection | `sender_account_id`, `recipient_id`, `show_id`, `seat_ids` | A pending, unexpired invitation whose sender still holds all specified transferable tickets |
| Refund, for approval/processing/payment | `purchaser_account_id`, `show_id`, `seat_ids` | A request at the preceding required stage: requested, approved or processing respectively |
| Ticket, for admission checks | `purchaser_account_id`, `show_id`, `seat_id` | The ticket in the current uncancelled order; credential/holder validity is checked separately |

`seat_ids` is an unordered exact set, without duplicates or subset matching. Optional `created_from` / `created_before` bounds can narrow a selector when a Task needs them; they form a half-open interval over order/transfer `created_at`, refund `requested_at`, or the ticket's originating order time. Bounds have explicit UTC offsets and `from < before`. Matching stays within the current run/account, with the epoch checked by Core `expected_version`; payload fields cannot choose another run or epoch.

For transfer decisions, cancelled, accepted, rejected and expired invitations remain in history but do not compete with current pending invitations. Cancelling and resending is therefore supported. The App also prevents two live pending invitations for the same ticket; a seed/import violating that invariant is invalid. Matching still checks cardinality rather than assuming uniqueness.

Exactly one eligible match is required. Zero matches return `target_not_found`; multiple matches return `ambiguous_target`. Neither creates an acceptance, credential, refund or successful event receipt, and business state/clock stay unchanged. Never select the first/latest record or create a missing target. A Task expecting conditional acceptance can record zero matches as “no eligible invitation, no acceptance”; it may then explicitly continue its timeline without this acceptance. Multiple matches are a fixture/invariant error to inspect before continuing. There is no implicit waiting, retry or rescheduling inside the App.

After resolution, validate actor evidence and the transition in the same commit. Recipient acceptance must carry the matching seeded recipient ID and trusted decision source. The purchaser cannot submit that decision through Agent tools. Credential release acts only on the matched order's relevant tickets. Refund posting uses the matched request's approved amounts and original payment destination. Admission checks validate the supplied credential ID, current holder and credential revision. Infra obtains runtime credential IDs from actual receipts or same-run trusted readback, including retained old credentials for negative checks; it cannot invent them.

**Minimal scenario:** Maya already holds two tickets, A11 and A12, for the winter show. At `2026-12-01T18:00:00-08:00`, the user asks the Agent to keep A11 and transfer A12 to Alex. The Agent sends an invitation; its generated ID might be `transfer-37`. At the supplied `18:10` boundary, Task/Infra submits the rule-based acceptance below. Its fields identify the actual eligible invitation without assuming its ID:

```json
{
  "event_id": "alex-accepts-seat-a12",
  "at": "2026-12-01T18:10:00-08:00",
  "operation": "seatline.transfer_accepted",
  "payload": {
    "target": {
      "match": {
        "sender_account_id": "seatline-maya",
        "recipient_id": "recipient-alex",
        "show_id": "event-winter-show",
        "seat_ids": ["seat-a12"]
      }
    },
    "recipient_id": "recipient-alex",
    "decision_source_ref": "task-alex-decision-1"
  }
}
```

If one eligible invitation exists, acceptance records its actual transfer/ticket IDs, changes the holder, issues the recipient's credential and invalidates the sender's credential in one App commit. The notice names the actual IDs. If Maya cancelled an earlier invitation and resent it, only the current eligible invitation matches. If the Agent never sent one, acceptance does not occur. Two eligible matches produce no effect and an explicit ambiguity error.

For an identical committed `event_id`, Core returns the original receipt before matching again. A retry after acceptance, even if another invitation now exists, cannot change the selected target or create new effects. Changed-content reuse fails. A genuinely separate recipient decision needs its own event ID and fresh validation; it must not masquerade as a retry. Exact-ID calls to closed records also fail without new effects. App transition history records the source event ID, selector, actual resolved IDs and outcome through authorized business reads. Join that history with Core receipts in run evidence; no new domain fields in Core receipts are assumed. Planned checks include generated IDs, zero/two eligible matches, wrong account/recipient, cancellation/resend, expiry, stale epoch, exact retries and no repeated credential/refund effects.

### Time boundaries, notices and dependencies

- **Holds:** a hold is effective only while `virtual_now < expires_at`. At the deadline, reads show it expired and the seat available unless another valid claim exists. Reads change no stored records. Purchase confirmation applies the same strict check; no cleanup event is needed to free an expired hold.
- **Ticket delivery:** passing a published release time alone leaves the ticket delivery-pending. Only an explicit Task/Infra credential-release event can issue it, and only at/after that time. If the event is absent, reads retain pending status. Inventory, transfer acceptance and refund progress also require their defined writes/events.
- **Refund deadlines:** eligibility is derived from `virtual_now < refund_deadline`; at the deadline, reads show the window closed and a new request fails. An on-time committed request can progress through approved/processing/paid events afterward. `env.advance_time` invokes none of these handlers. Task/Infra controls same-time ordering and cross-App clock barriers.
- **Refund policy variants:** a partial-refund policy allows explicitly selected unused lines held by the purchaser or returned before the request deadline. A whole-order policy requires all eligible lines together. Accepted transfers must be returned by their current holders when the printed policy requires it. Each preview itemizes refundable face value, fees/extras and retained nonrefundable amounts in integer cents. Payment goes to the original payment reference, not automatically to the current ticket holder.

**Mail, required send-only connection.** Use Mail 1.3.0 [text wire v2](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/7a05aa958c824143ab9eee1aa21c2dfacd8be31a/examples/apps/mail/schemas/router-message.schema.json): `channel.email`, schema `urn:pale:email-message:2`, payload `urn:pale:email-payload:1`, receiver `mail.receive_notification`. There is no incoming Messaging direction in this release. For example, a notice produced after the acceptance above includes the actual generated IDs; the IDs below illustrate one possible resulting commit, not IDs hard-coded in the Task:

```json
{"specversion":"1.0","id":"notice-transfer-37-accepted","source":"urn:pale:app:seatline:account:seatline-maya","type":"org.pale.mail.notification.v1","time":"2026-12-01T18:10:00-08:00","datacontenttype":"application/json","dataschema":"urn:pale:email-payload:1","data":{"channel":"channel.email","recipient":{"kind":"person_ref","id":"person-maya"},"source_object":{"app_id":"seatline","account_id":"seatline-maya","object_type":"transfer","object_id":"transfer-37"},"content":{"title":"Transfer transfer-37 accepted","body":{"format":"text/plain","text":"Alex accepted ticket ticket-24 for event-winter-show, seat-a12, order order-18. The sender's old credential is invalid."},"asset_ids":[]},"extensions":[]}}
```

The business commit retains a stable notice ID; Infra publishes it separately through public Messaging. A Mail rejection or unknown acknowledgement does not roll back the purchase, accepted transfer or refund. Retrying the business request returns its original result and does not send another notice. A permitted delivery retry retains the same CloudEvents source/ID and identical payload. For unknown acknowledgements, halt and reconcile Mail's actual receipt/record using the original event identity under the Messaging protocol; do not invent a replacement ID or resume a halted router blindly. Validation checks actual Mail text/references, receipts, refused delivery with unchanged Mail, retries and committed-but-unconfirmed delivery.

- **Shared data and dependencies (required):** Stable event, venue, seat, account, recipient and payment references link runtime-generated hold/order/line/ticket/credential/transfer/refund IDs. Use exact cents/currency, offset timestamps and IANA event time zones. Generate original PNG seat maps from the same seat topology as observations. Per loaded fixture, budget two maps at most 192 KiB each and other assets at most 384 KiB: at most 48 assets / 768 KiB in total, including peak imported receipts/history, within the platform's 64-asset / 1-MiB limit. Load the three scenes separately. Over-budget imports fail atomically and preserve prior originals. Synthetic text receipts suffice; no real barcodes or personal credentials.

The App package runs with only Node.js 18+, public runtime 1.6.0 / Core API 1.2.0 and its declared dependencies. Mail 1.3.0, Calendar 1.3.0 and optional Contacts 1.0.0 are public run-assembly connections. All reused helpers/research components must be redistributed inside the package with compatible licenses; no undeclared repository files, copied receiving Apps or private services are required.

## 4. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Web / app construction | Event list/detail, seat map, hold/checkout, ticket wallet, transfer and refund/history views implementing all five workflows. Reuse licensed original money/date/UI helpers. | End-to-end purchase, delivery, transfer and event-change closeout; GUI/tools agree on seat topology, current holder, credential validity and financial status. | 5–6 |
| Data and image collection | Inventory references/reuse and dependency licenses. Original PNG maps, fictional events and text assets eliminate event/venue scraping. | Provenance manifest, original assets and offline runtime; no copied brand media or customer records. | 1 |
| Synthetic data and assets | Three reset fixtures spanning six events in total, with two original 40–80-seat venue maps per fixture, three recipient identities, published policy variants and 10–15 event inputs. Historical platform records are dated on/after 2025-01-01; task sessions start on/after 2026-01-01, with explicit timestamp offsets. | Valid seat adjacency/attributes, consistent orders/holder lineage, cent totals and feasible transfer/refund reference paths. | 3–4 |
| App integrations | Bind public tools, Mail/Calendar, purchaser/recipient roles, current confirmations and public clock/event/seed/reset operations; local payments first, Finance optional. | Reproduce a held-seat race, accepted transfer and rescheduled-event refund using selectors resolved to actual IDs and permitted actor operations; reject missing/ambiguous targets and preserve exact retry results. | 4–6 |
| Validation and reset | Local business, error, authorization, idempotency and concurrency tests; fixtures/expected outcomes, independent fresh-state reproduction and platform review. | Cover expired holds, changed prices, wrong recipients, pending/accepted transfers, invalid old credentials, event-specific partial/whole refunds, refund destination, duplicate effects, zero/multiple event matches, deadline reads without events and App-local reset with Mail/Calendar retained. Preserve erroneous attempts/intermediate disclosures in evidence. | 5–7 |

- **Milestones, owners and dependencies (required):** @genglinliu owns M0 scope/interface/license agreement, M1 first runnable scene with purchase, a selector-targeted acceptance, GUI/MCP and Mail readback, M2 remaining scenes and full integration/error coverage, and M3 independent validation evidence. Submit M1 within 14 calendar days of first plan approval; keep remaining scope explicit in that submission. Estimate 18–24 person-days of contributor work, about 4–5 working weeks, excluding infrastructure and external-review waits. App-scoped authority and recipient decisions follow the boundaries above; agree the independent reviewer and any model-trial budget with maintainers. Other open apps are optional reuse candidates, not assumed accepted dependencies.
- **Resources and total effort (required):** 18–24 person-days. Local CPU backend/browser, at most 48 assets / 768 KiB per loaded fixture, including peak receipts/history, no paid collection or generation service. Record exact dependency versions and source hashes. Model-trial count/cost and independent reviewer are TBD with maintainers before paid validation; local mechanics alone do not establish agent performance.
- **Scope boundary and open questions (required):** Primary ticket sales, person-to-person transfers and organizer-policy refunds. Exclude live purchases, queue/CAPTCHA bypass, automated bulk acquisition, secondary-market selling, real credential generation and real payment processing. Previewed recipient/seat/fee changes need current authority. The printed synthetic policies, public Calendar tools, scoped App permissions, selector-targeted events and App-local reset above define the implementation boundary. The app checks business validity; task-specific seat suitability and personal trade-offs remain the agent's work.
- **License and external dependencies (required):** Original code MIT; original synthetic fixtures/maps CC0-1.0. Reused research components require an explicit compatible-license inventory and notices before inclusion. No Ticketmaster code, brand assets, live catalog or actual tickets are copied. Redistribute all baseline components; no hosted-only or live third-party dependency.

After design approval, add implementation and reproducible validation evidence against these deliverables in the same PR. Return substantial scope changes for review.
